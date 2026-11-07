import { randomUUID } from "node:crypto";
import {
  actorLabel,
  buildActorPlans,
  buildEnrichInput,
  ENRICH_ACTOR,
  INDEED_ACTOR,
  linkedinProfileUrls,
  POST_ACTOR,
  PROFILE_ACTOR,
} from "./actors";
import { buildSearchSpend, sampleSpend, type SpendRunInput } from "./attribute";
import { createApifyRunner, saveSearchGroup, SourceFailure, type ActorRunner, type ActorRunResult } from "./apify";
import type { ActorRunSnapshot } from "./charge";
import { normaliseIndeedResume, normaliseLinkedInPost, normaliseLinkedInProfile } from "./normalise";
import { salaryLabel } from "./parse";
import { rankCandidates } from "./rank";
import { buildSampleCandidates } from "./sample";
import { canonicalName, canonicalProfileUrl } from "./text";
import type { ParsedSpec, RawCandidate, SearchResponse, SourceId, SourceNotice, WorkRole } from "./types";

const SOURCE_BY_ACTOR: Record<string, SourceId> = {
  [PROFILE_ACTOR]: "linkedin-profile",
  [POST_ACTOR]: "linkedin-post",
  [INDEED_ACTOR]: "indeed-resume",
};

const FAILED_STATUS = new Set(["FAILED", "ABORTED", "TIMED-OUT"]);
const SEARCH_BUDGET_MS = 270_000;

export class MissingApifyTokenError extends Error {
  constructor() {
    super("APIFY_TOKEN is not set, so a live search cannot run.");
    this.name = "MissingApifyTokenError";
  }
}

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

function responseFor(
  spec: ParsedSpec,
  mode: SearchResponse["mode"],
  tokenConfigured: boolean,
  raw: RawCandidate[],
  notices: SourceNotice[],
  runs: SpendRunInput[],
  searchId: string | null,
): SearchResponse {
  const ranked = rankCandidates(raw, spec);
  const spend =
    mode === "sample"
      ? sampleSpend(buildActorPlans(spec))
      : buildSearchSpend({
          mode,
          searchId,
          runs,
          records: raw,
          returnedIds: new Set(ranked.candidates.map((candidate) => candidate.id)),
        });
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
    spend,
  };
}

function stamp(
  source: SourceId | "linkedin-detail",
  actor: string,
  run: ActorRunSnapshot | null,
  items: unknown[],
  watchPhrases: string[],
): RawCandidate[] {
  const people: RawCandidate[] = [];
  items.forEach((item, itemIndex) => {
    const candidate =
      source === "indeed-resume"
        ? normaliseIndeedResume(item)
        : source === "linkedin-post"
          ? normaliseLinkedInPost(item, watchPhrases)
          : normaliseLinkedInProfile(item);
    if (!candidate) return;
    if (source === "linkedin-detail") {
      candidate.experience = (candidate.experience ?? []).map(
        (role): WorkRole => ({ ...role, source: "linkedin-detail" }),
      );
    }
    candidate.origins = [
      {
        runId: run?.id ?? null,
        actor,
        source,
        itemIndex,
        hasExperience: (candidate.experience?.length ?? 0) > 0,
      },
    ];
    people.push(candidate);
  });
  return people;
}

function applyEnrichment(records: RawCandidate[], enriched: RawCandidate[]): void {
  for (const extra of enriched) {
    const url = canonicalProfileUrl(extra.profileUrl);
    const name = canonicalName(extra.name);
    const target = records.find((record) => {
      const recordUrl = canonicalProfileUrl(record.profileUrl);
      if (url && recordUrl && url === recordUrl) return true;
      const recordName = canonicalName(record.name);
      return Boolean(name && recordName && name === recordName && recordName !== "name not published");
    });
    if (!target) continue;
    if ((extra.experience?.length ?? 0) > 0) {
      target.experience = [
        ...(target.experience ?? []).filter((role) => role.source === "indeed-resume"),
        ...(extra.experience ?? []),
      ];
    }
    if (typeof extra.connections === "number") target.connections = extra.connections;
    target.haystack = `${target.haystack}\n${extra.haystack}`;
    target.origins = [...(target.origins ?? []), ...(extra.origins ?? [])];
  }
}

export async function searchCandidates(
  spec: ParsedSpec,
  options: { token: string | undefined; runActor?: ActorRunner; demo?: boolean },
): Promise<SearchResponse> {
  const token = options.token?.trim() ?? "";
  const tokenConfigured = token.length > 0;
  const notices: SourceNotice[] = [];
  const plans = buildActorPlans(spec);

  if (options.demo) {
    notices.push({
      source: "apify",
      level: "info",
      message: "Offline demo. These profiles are fictional, no Apify actors ran, and this search costs $0.",
    });
    if (spec.watchPhrases.length === 0) {
      notices.push({
        source: "linkedin-post",
        level: "info",
        message: "LinkedIn post search would be skipped because no competitor or complaint phrases were given.",
      });
    }
    return responseFor(spec, "sample", tokenConfigured, buildSampleCandidates(spec), notices, [], null);
  }

  if (!tokenConfigured) throw new MissingApifyTokenError();

  const runActor = options.runActor ?? createApifyRunner(token);
  const usingLiveClient = options.runActor === undefined;
  const searchId = randomUUID();
  const startedAt = new Date().toISOString();
  const budgetStart = Date.now();
  const raw: RawCandidate[] = [];
  const runs: SpendRunInput[] = [];

  const jobs = plans
    .filter((plan) => {
      const source = SOURCE_BY_ACTOR[plan.actor];
      if (!source) return false;
      if (plan.skipped || !plan.input) {
        notices.push({
          source,
          level: "info",
          message:
            plan.actor === INDEED_ACTOR
              ? "Indeed resume search was skipped because Include Indeed is off."
              : "LinkedIn post search was skipped because no competitor or complaint phrases were given.",
        });
        return false;
      }
      return true;
    })
    .map(async (plan) => {
      const source = SOURCE_BY_ACTOR[plan.actor] ?? "linkedin-profile";
      let result: ActorRunResult;
      try {
        result = await runActor(plan.actor, plan.input ?? {});
      } catch (error) {
        const run = error instanceof SourceFailure ? error.run : null;
        runs.push({ actor: plan.actor, items: [], run });
        notices.push({
          source,
          level: "warning",
          message: failureMessage(source, describeActorError(error)),
        });
        return;
      }
      runs.push({ actor: plan.actor, items: result.items, run: result.run });
      if (result.run?.status && FAILED_STATUS.has(result.run.status)) {
        notices.push({
          source,
          level: "warning",
          message: failureMessage(source, result.run.status.toLowerCase().replaceAll("-", " ")),
        });
      }
      const people = stamp(source, plan.actor, result.run, result.items, spec.watchPhrases);
      if (people.length === 0) {
        notices.push({ source, level: "warning", message: emptyMessage(source) });
      }
      raw.push(...people);
    });

  await Promise.all(jobs);

  const preview = rankCandidates(raw, spec);
  const urls = linkedinProfileUrls(preview.candidates);
  const remaining = SEARCH_BUDGET_MS - (Date.now() - budgetStart);
  if (urls.length === 0) {
    notices.push({
      source: "apify",
      level: "info",
      message: "No LinkedIn profile URL was on the shortlist, so the profile-detail check did not run.",
    });
  } else if (remaining < 20_000) {
    notices.push({
      source: "apify",
      level: "info",
      message: "The profile-detail check was skipped because the search had used its time budget. Validation uses the fields already returned.",
    });
  } else {
    const timeoutSecs = Math.max(15, Math.min(40, Math.floor(remaining / 1000) - 12));
    try {
      const enriched = await runActor(ENRICH_ACTOR, buildEnrichInput(urls), {
        timeoutSecs,
        settleWaitMs: remaining > 30_000 ? 10_000 : 0,
      });
      runs.push({ actor: ENRICH_ACTOR, items: enriched.items, run: enriched.run });
      if (enriched.run?.status && FAILED_STATUS.has(enriched.run.status)) {
        notices.push({
          source: "apify",
          level: "warning",
          message: `LinkedIn profile detail failed: ${enriched.run.status.toLowerCase().replaceAll("-", " ")}. Validation uses the fields already returned.`,
        });
      }
      applyEnrichment(raw, stamp("linkedin-detail", ENRICH_ACTOR, enriched.run, enriched.items, spec.watchPhrases));
    } catch (error) {
      const run = error instanceof SourceFailure ? error.run : null;
      runs.push({ actor: ENRICH_ACTOR, items: [], run });
      notices.push({
        source: "apify",
        level: "warning",
        message: `LinkedIn profile detail failed: ${describeActorError(error)} Validation uses the fields already returned.`,
      });
    }
  }

  const runIds = runs.map((run) => run.run?.id).filter((id): id is string => Boolean(id));
  if (usingLiveClient && runIds.length > 0) {
    try {
      await saveSearchGroup(token, {
        searchId,
        startedAt,
        jobTitle: spec.jobTitle,
        location: spec.location,
        runIds,
      });
    } catch {
      notices.push({
        source: "apify",
        level: "info",
        message: "The runs were charged, but this search could not be grouped on the spend log. Each run is still listed there.",
      });
    }
  }

  return responseFor(spec, "live", tokenConfigured, raw, notices, runs, searchId);
}

export function spendActorLabel(actor: string): string {
  return actorLabel(actor);
}
