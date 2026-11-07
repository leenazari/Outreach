import { randomUUID } from "node:crypto";
import {
  actorLabel,
  buildActorPlans,
  buildEnrichInput,
  buildPostsForProfiles,
  buildProfileSearchQuery,
  shortenActorInput,
  ENRICH_ACTOR,
  INDEED_ACTOR,
  MAX_ENRICH,
  POST_ACTOR,
  PROFILE_ACTOR,
  PROFILE_MAX_ITEMS,
  PROFILE_PAGE_ITEMS,
} from "./actors";
import { buildSearchSpend, sampleSpend, type SpendRunInput } from "./attribute";
import { createApifyRunner, putStoreRecord, saveSearchGroup, SourceFailure, type ActorRunner, type ActorRunResult } from "./apify";
import type { ActorRunSnapshot } from "./charge";
import { createGatewayJudge, matchErrorMessage, scoreCandidatesWithAi } from "./ai-match";
import { applyEnrichment, enrichmentQuery, preFilterCandidates } from "./enrich";
import { createApifyCache, POST_TOP_N, searchCacheKey, type ProfileCache } from "./profile-cache";
import { normaliseIndeedResume, normaliseLinkedInPost, normaliseLinkedInProfile } from "./normalise";
import { salaryLabel } from "./parse";
import { buildExport, EXPORT_RECORD_KEY, postInterviewaWebhook } from "./interviewa";
import { candidateKey, rankCandidates } from "./rank";
import { buildSampleCandidates } from "./sample";
import { canonicalName } from "./text";
import type { CandidateJudge } from "./ai-match";
import type { LlmSpend, ParsedSpec, RawCandidate, SearchRequest, SearchResponse, SourceId, SourceNotice, WorkRole } from "./types";

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

function isBadActorInput(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /\b400\b/.test(message) || /invalid-input/i.test(message);
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
  extras?: { excludedLocation?: number; excludedBeforeEnrichment?: number; page?: number; canLoadMore?: boolean },
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
    notices,
    plannedRuns: buildActorPlans(spec),
    stats: {
      collected: raw.length,
      afterDedupe: ranked.afterDedupe,
      droppedForMustHave: ranked.droppedForMustHave,
      excludedForLocation: ranked.excludedForLocation + (extras?.excludedLocation ?? 0),
      excludedBeforeEnrichment: extras?.excludedBeforeEnrichment ?? 0,
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
      searchedFor: spec.location.trim()
        ? `${buildProfileSearchQuery(spec)}, ${spec.location.trim()}`
        : buildProfileSearchQuery(spec),
    },
    spend,
    candidates: ranked.candidates,
    page: extras?.page ?? 1,
    canLoadMore: extras?.canLoadMore ?? false,
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

export async function searchCandidates(
  spec: ParsedSpec,
  options: {
    token: string | undefined;
    runActor?: ActorRunner;
    demo?: boolean;
    includeEmail?: boolean;
    enrichTopN?: number;
    aiMatch?: boolean;
    judge?: CandidateJudge;
    storedRequest?: SearchRequest | null;
    page?: number;
    cache?: ProfileCache;
    now?: Date;
  },
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
  const cache = options.cache ?? (usingLiveClient ? createApifyCache(token) : null);
  const now = options.now ?? new Date();
  const page = Math.max(1, Math.round(options.page ?? 1));
  const searchId = randomUUID();
  const startedAt = new Date().toISOString();
  const budgetStart = Date.now();
  const raw: RawCandidate[] = [];
  const runs: SpendRunInput[] = [];

  const jobs = plans
    .filter((plan) => {
      const source = SOURCE_BY_ACTOR[plan.actor];
      if (!source) return false;
      if (plan.actor === POST_ACTOR) return false;
      if (plan.skipped || !plan.input) {
        notices.push({
          source,
          level: "info",
          message:
            plan.actor === INDEED_ACTOR
              ? "Indeed resume search was skipped because Include Indeed is off."
              : "LinkedIn post search runs for the top matches after scoring.",
        });
        return false;
      }
      return true;
    })
    .map(async (plan) => {
      const source = SOURCE_BY_ACTOR[plan.actor] ?? "linkedin-profile";
      let result: ActorRunResult;
      const planInput = plan.actor === PROFILE_ACTOR && plan.input ? { ...plan.input, takePages: 1, ...(page > 1 ? { startPage: page } : {}) } : plan.input ?? {};
      try {
        if (plan.actor === PROFILE_ACTOR && cache) {
          const query = typeof planInput.searchQuery === "string" ? planInput.searchQuery : "";
          const location = Array.isArray(planInput.locations) ? String(planInput.locations[0] ?? "") : "";
          const cached = await cache.getSearch(searchCacheKey(query, location, page), now);
          if (cached) {
            runs.push({ actor: plan.actor, items: cached, run: null, cached: true });
            raw.push(...stamp(source, plan.actor, null, cached, spec.watchPhrases));
            return;
          }
        }
        try {
          result = await runActor(plan.actor, planInput);
        } catch (error) {
          const shorter = plan.input ? shortenActorInput(plan.input) : null;
          if (!shorter || !isBadActorInput(error) || JSON.stringify(shorter) === JSON.stringify(plan.input)) throw error;
          notices.push({
            source,
            level: "info",
            message: "The first query was too long for the actor, so it was sent again with a shorter title.",
          });
          result = await runActor(plan.actor, shorter);
        }
        if (plan.actor === PROFILE_ACTOR && cache) {
          const query = typeof planInput.searchQuery === "string" ? planInput.searchQuery : "";
          const location = Array.isArray(planInput.locations) ? String(planInput.locations[0] ?? "") : "";
          await cache.putSearch(searchCacheKey(query, location, page), result.items, now);
        }
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

  const preview = rankCandidates(raw, { ...spec, openToWork: false }, {
    limit: Math.max(raw.length, 1),
  });
  for (const candidate of preview.candidates) {
    for (const record of raw) {
      const sameId = candidateKey(record) === candidate.id;
      const sameName = canonicalName(record.name) !== "" && canonicalName(record.name) === canonicalName(candidate.name ?? "");
      if (sameId || sameName) record.firstPassScore = candidate.score;
    }
  }
  const filtered = preFilterCandidates(raw, spec, MAX_ENRICH);
  const dropKeys = new Set(
    raw
      .map((record) => candidateKey(record))
      .filter((key) => !filtered.kept.some((kept) => candidateKey(kept) === key)),
  );
  if (dropKeys.size > 0) {
    const remainingPeople = raw.filter((record) => !dropKeys.has(candidateKey(record)));
    raw.length = 0;
    raw.push(...remainingPeople);
  }
  for (const record of filtered.enrich) {
    const score = preview.candidates.find((candidate) => candidate.id === candidateKey(record))?.score;
    if (typeof score === "number") record.firstPassScore = score;
  }
  const urls = filtered.enrich
    .map((record) => enrichmentQuery({ score: record.firstPassScore ?? 0, profileUrl: record.profileUrl, linkedinIds: record.linkedinIds }))
    .filter((url): url is string => Boolean(url));
  const remaining = SEARCH_BUDGET_MS - (Date.now() - budgetStart);
  if (urls.length === 0) {
    notices.push({
      source: "apify",
      level: "info",
      message: "No LinkedIn profile was left inside the location, so the full-profile call was not made.",
    });
  } else if (remaining < 20_000) {
    notices.push({
      source: "apify",
      level: "info",
      message: "The full-profile rescore was skipped because the search had used its time budget.",
    });
  } else {
    const timeoutSecs = Math.max(15, Math.min(40, Math.floor(remaining / 1000) - 12));
    const cachedProfiles: unknown[] = [];
    const missingUrls: string[] = [];
    for (const url of urls) {
      const hit = cache ? await cache.getProfile(url, now) : null;
      if (hit) cachedProfiles.push(hit);
      else missingUrls.push(url);
    }
    if (cachedProfiles.length > 0) {
      runs.push({ actor: ENRICH_ACTOR, items: cachedProfiles, run: null, cached: true });
      applyEnrichment(raw, stamp("linkedin-detail", ENRICH_ACTOR, null, cachedProfiles, spec.watchPhrases));
    }
    try {
      if (missingUrls.length > 0) {
        const enriched = await runActor(ENRICH_ACTOR, buildEnrichInput(missingUrls, false), {
          timeoutSecs,
          settleWaitMs: remaining > 30_000 ? 10_000 : 0,
          expectedEvents: missingUrls.length,
        });
        runs.push({ actor: ENRICH_ACTOR, items: enriched.items, run: enriched.run });
        if (enriched.run?.status && FAILED_STATUS.has(enriched.run.status)) {
          notices.push({
            source: "apify",
            level: "warning",
            message: `LinkedIn full profile failed: ${enriched.run.status.toLowerCase().replaceAll("-", " ")}. Scores use the short profiles.`,
          });
        }
        applyEnrichment(raw, stamp("linkedin-detail", ENRICH_ACTOR, enriched.run, enriched.items, spec.watchPhrases));
        if (cache) {
          for (const item of enriched.items) {
            const person = normaliseLinkedInProfile(item);
            const url = person ? enrichmentQuery({ score: 0, profileUrl: person.profileUrl, linkedinIds: person.linkedinIds }) : null;
            if (url) await cache.putProfile(url, item, now);
          }
        }
      }
    } catch (error) {
      const run = error instanceof SourceFailure ? error.run : null;
      runs.push({ actor: ENRICH_ACTOR, items: [], run });
      notices.push({
        source: "apify",
        level: "warning",
        message: `LinkedIn full profile failed: ${describeActorError(error)} Scores use the short profiles.`,
      });
    }
  }

  if (options.includeEmail === true) {
    const emailUrls = urls;
    const emailBudget = SEARCH_BUDGET_MS - (Date.now() - budgetStart);
    if (emailUrls.length > 0 && emailBudget >= 20_000) {
      try {
        const emailed = await runActor(ENRICH_ACTOR, buildEnrichInput(emailUrls, true), {
          timeoutSecs: Math.max(15, Math.min(40, Math.floor(emailBudget / 1000) - 12)),
          settleWaitMs: 0,
        });
        runs.push({ actor: ENRICH_ACTOR, items: emailed.items, run: emailed.run });
        applyEnrichment(raw, stamp("linkedin-detail", ENRICH_ACTOR, emailed.run, emailed.items, spec.watchPhrases));
      } catch (error) {
        const run = error instanceof SourceFailure ? error.run : null;
        runs.push({ actor: ENRICH_ACTOR, items: [], run });
        notices.push({
          source: "apify",
          level: "warning",
          message: `LinkedIn email search failed: ${describeActorError(error)}`,
        });
      }
    }
  }

  const pageSize = spec.openToWork === true ? PROFILE_PAGE_ITEMS : PROFILE_MAX_ITEMS;
  const result = responseFor(spec, "live", tokenConfigured, raw, notices, runs, searchId, {
    excludedLocation: filtered.excludedLocation,
    excludedBeforeEnrichment: filtered.excludedLocation + filtered.excludedTitle,
    page,
    canLoadMore: raw.filter((record) => record.sources.includes("linkedin-profile")).length >= pageSize,
  });
  let llm: LlmSpend | null = null;
  const wantsAi = options.aiMatch === true;
  if (wantsAi && result.candidates.length > 0 && SEARCH_BUDGET_MS - (Date.now() - budgetStart) > 15_000) {
    const judge = options.judge ?? createGatewayJudge();
    try {
      llm = await scoreCandidatesWithAi(result.candidates, raw, spec, { judge });
      attachLlmSpend(result, llm);
      if (llm.failed > 0) {
        result.notices.push({
          source: "apify",
          level: "warning",
          message: `AI match failed for ${llm.failed} of ${llm.calls} profiles: ${llm.error ?? "The AI match call failed."} Those cards use the heuristic score.`,
        });
      }
    } catch (error) {
      for (const candidate of result.candidates) {
        candidate.scoreSource = "heuristic";
        candidate.matchReason = "Heuristic score (AI match failed)";
      }
      result.notices.push({
        source: "apify",
        level: "warning",
        message: `AI match failed: ${matchErrorMessage(error)} Scores use the heuristic.`,
      });
    }
  }

  const wantPosts = spec.openToWork === true || spec.watchPhrases.length > 0;
  if (wantPosts && result.candidates.length > 0) {
    const postUrls = result.candidates
      .map((candidate) => candidate.profileUrl)
      .filter((url): url is string => Boolean(url && /linkedin\.com\/in\//i.test(url)))
      .slice(0, POST_TOP_N);
    const cachedPosts: unknown[] = [];
    const missingPostUrls: string[] = [];
    for (const url of postUrls) {
      const hit = cache ? await cache.getPosts(url, now) : null;
      if (hit) cachedPosts.push(...hit);
      else missingPostUrls.push(url);
    }
    if (cachedPosts.length > 0) {
      runs.push({ actor: POST_ACTOR, items: cachedPosts, run: null, cached: true });
      raw.push(...stamp("linkedin-post", POST_ACTOR, null, cachedPosts, spec.watchPhrases));
    }
    if (missingPostUrls.length > 0) {
      try {
        const posted = await runActor(POST_ACTOR, buildPostsForProfiles(missingPostUrls));
        runs.push({ actor: POST_ACTOR, items: posted.items, run: posted.run });
        raw.push(...stamp("linkedin-post", POST_ACTOR, posted.run, posted.items, spec.watchPhrases));
        if (cache) {
          for (const url of missingPostUrls) await cache.putPosts(url, posted.items, now);
        }
      } catch (error) {
        const run = error instanceof SourceFailure ? error.run : null;
        runs.push({ actor: POST_ACTOR, items: [], run });
        result.notices.push({
          source: "linkedin-post",
          level: "warning",
          message: failureMessage("linkedin-post", describeActorError(error)),
        });
      }
    }
    absorbPosts(result, raw, spec);
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
        request: options.storedRequest ?? null,
        llm,
      });
    } catch {
      result.notices.push({
        source: "apify",
        level: "info",
        message: "The runs were charged, but this search could not be grouped on the spend log. Each run is still listed there.",
      });
    }
  }
  if (usingLiveClient) {
    const payload = buildExport({
      candidates: result.candidates,
      spend: result.spend,
      searchId,
      jobTitle: spec.jobTitle,
      location: spec.location,
    });
    try {
      await putStoreRecord(token, EXPORT_RECORD_KEY, payload);
    } catch {
      result.notices.push({
        source: "apify",
        level: "info",
        message: "Candidates could not be stored for the Interviewa export. The search results are still shown.",
      });
    }
    try {
      await postInterviewaWebhook(payload);
    } catch {
      result.notices.push({
        source: "apify",
        level: "warning",
        message: "The Interviewa webhook did not accept the candidates.",
      });
    }
  }
  return result;
}

function absorbPosts(result: SearchResponse, raw: RawCandidate[], spec: ParsedSpec): void {
  const ranked = rankCandidates(raw, spec, { limit: Math.max(raw.length, 1) });
  const seen = new Set(result.candidates.map((candidate) => candidate.id));
  for (const fresh of ranked.candidates) {
    const existing = result.candidates.find((candidate) => candidate.id === fresh.id);
    if (!existing) {
      if (!seen.has(fresh.id)) result.candidates.push(fresh);
      continue;
    }
    const gainedOpenToWork = fresh.openToWork && !existing.openToWork;
    existing.openToWork = existing.openToWork || fresh.openToWork;
    existing.openToWorkPostUrl = existing.openToWorkPostUrl || fresh.openToWorkPostUrl;
    if (gainedOpenToWork && existing.scoreSource === "heuristic" && spec.openToWork === true) {
      existing.score = Math.min(100, existing.score + 10);
    }
  }
  result.candidates.sort((left, right) => {
    const location = Number(left.locationStatus === "unknown") - Number(right.locationStatus === "unknown");
    if (location !== 0) return location;
    return right.score - left.score;
  });
  result.candidates = result.candidates.slice(0, 25);
  result.stats.returned = result.candidates.length;
}

function attachLlmSpend(result: SearchResponse, llm: LlmSpend): void {
  result.spend.llm = llm;
  result.spend.runs.push({
    actor: "ai-gateway",
    label: "AI match",
    runId: null,
    status: "SUCCEEDED",
    startedAt: new Date().toISOString(),
    settled: true,
    totalUsd: llm.usd,
    lines: [
      {
        label: `${llm.model}: ${llm.inputTokens} input tokens, ${llm.outputTokens} output tokens`,
        usd: llm.usd,
        kind: "event",
        allocated: false,
        count: llm.calls,
      },
    ],
    consoleUrl: null,
    note: `${llm.calls} profile${llm.calls === 1 ? "" : "s"} scored. ${llm.failed} failed and kept the heuristic.`,
  });
  if (typeof result.spend.totalUsd === "number") {
    result.spend.totalUsd = Math.round((result.spend.totalUsd + llm.usd) * 1_000_000) / 1_000_000;
  }
}

export function spendActorLabel(actor: string): string {
  return actorLabel(actor);
}
