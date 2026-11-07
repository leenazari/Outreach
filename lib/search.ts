import { buildActorPlans, INDEED_ACTOR, POST_ACTOR, PROFILE_ACTOR } from "./actors";
import { createApifyRunner, type ActorRunner, SourceFailure } from "./apify";
import { normaliseItems } from "./normalise";
import { salaryLabel } from "./parse";
import { rankCandidates } from "./rank";
import { buildSampleCandidates } from "./sample";
import type { ParsedSpec, RawCandidate, SearchResponse, SourceId, SourceNotice } from "./types";

const SOURCE_BY_ACTOR: Record<string, SourceId> = {
  [PROFILE_ACTOR]: "linkedin-profile",
  [POST_ACTOR]: "linkedin-post",
  [INDEED_ACTOR]: "indeed-resume",
};

function emptyMessage(source: SourceId): string {
  if (source === "indeed-resume") {
    return "Indeed resume search returned nothing. resumes.indeed.com often needs an employer login, so this source is best effort.";
  }
  if (source === "linkedin-post") {
    return "LinkedIn post search returned no usable posts for those phrases.";
  }
  return "LinkedIn profile search returned no usable profiles for this title and location.";
}

function failureMessage(source: SourceId, detail: string): string {
  if (source === "indeed-resume") {
    return `Indeed resume search failed: ${detail} The other sources are still included. This actor is unreliable and resumes.indeed.com may require an employer login.`;
  }
  if (source === "linkedin-post") return `LinkedIn post search failed: ${detail}`;
  return `LinkedIn profile search failed: ${detail}`;
}

function describeActorError(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "the run timed out before it returned dataset items.";
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "the actor returned an error.";
}

async function runSource(
  source: SourceId,
  actor: string,
  input: Record<string, unknown>,
  runActor: ActorRunner,
): Promise<{ source: SourceId; items: unknown[] }> {
  try {
    const items = await runActor(actor, input);
    return { source, items };
  } catch (error) {
    if (error instanceof SourceFailure) throw error;
    throw new SourceFailure(source, `${actor}: ${describeActorError(error)}`);
  }
}

function responseFor(
  spec: ParsedSpec,
  mode: SearchResponse["mode"],
  tokenConfigured: boolean,
  raw: RawCandidate[],
  notices: SourceNotice[],
): SearchResponse {
  const ranked = rankCandidates(raw, spec);
  return {
    mode,
    tokenConfigured,
    candidates: ranked.candidates,
    notices,
    plannedRuns: buildActorPlans(spec),
    stats: {
      collected: raw.length,
      afterDedupe: ranked.afterDedupe,
      droppedForMustHave: ranked.droppedForMustHave,
      matched: ranked.matched,
      returned: ranked.candidates.length,
    },
    spec: {
      jobTitle: spec.jobTitle,
      location: spec.location,
      salaryLabel: salaryLabel(spec),
      mustHave: spec.mustHave,
      niceToHave: spec.niceToHave,
      watchPhrases: spec.watchPhrases,
    },
  };
}

export async function searchCandidates(
  spec: ParsedSpec,
  options: { token: string | undefined; runActor?: ActorRunner },
): Promise<SearchResponse> {
  const token = options.token?.trim() ?? "";
  const tokenConfigured = token.length > 0;
  const notices: SourceNotice[] = [];
  const plans = buildActorPlans(spec);

  if (spec.useSampleData || !tokenConfigured) {
    if (!tokenConfigured && !spec.useSampleData) {
      notices.push({
        source: "apify",
        level: "warning",
        message: "APIFY_TOKEN is not set, so this run used sample data instead of live Apify actors.",
      });
    } else {
      notices.push({
        source: "apify",
        level: "info",
        message: "Sample data is on. No Apify actors were called and no one was contacted.",
      });
    }
    if (spec.watchPhrases.length === 0) {
      notices.push({
        source: "linkedin-post",
        level: "info",
        message: "LinkedIn post search would be skipped because no competitor or complaint phrases were given.",
      });
    }
    return responseFor(spec, "sample", tokenConfigured, buildSampleCandidates(spec), notices);
  }

  const runActor = options.runActor ?? createApifyRunner(token);
  const jobs: Promise<{ source: SourceId; items: unknown[] }>[] = [];

  for (const plan of plans) {
    const source = SOURCE_BY_ACTOR[plan.actor];
    if (!source) continue;
    if (plan.skipped || !plan.input) {
      notices.push({
        source,
        level: "info",
        message: "LinkedIn post search was skipped because no competitor or complaint phrases were given.",
      });
      continue;
    }
    jobs.push(runSource(source, plan.actor, plan.input, runActor));
  }

  const settled = await Promise.allSettled(jobs);
  const raw: RawCandidate[] = [];

  for (const result of settled) {
    if (result.status === "rejected") {
      const reason: unknown = result.reason;
      if (reason instanceof SourceFailure) {
        notices.push({
          source: reason.source,
          level: "warning",
          message: failureMessage(reason.source, reason.message),
        });
      } else {
        notices.push({
          source: "apify",
          level: "warning",
          message: "One source failed before it could be identified. The others are still included.",
        });
      }
      continue;
    }

    const normalised = normaliseItems(result.value.source, result.value.items, spec.watchPhrases);
    if (normalised.length === 0) {
      notices.push({
        source: result.value.source,
        level: "warning",
        message: emptyMessage(result.value.source),
      });
    }
    raw.push(...normalised);
  }

  return responseFor(spec, "live", tokenConfigured, raw, notices);
}
