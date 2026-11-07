import { RESULT_LIMIT } from "./actors";
import type { Candidate, ParsedSpec, RawCandidate, ScoreReason, SourceId, ValidationStatus } from "./types";
import { canonicalName, canonicalProfileUrl, clip, haystackIncludes, uniqueStrings } from "./text";
import { validateProfile } from "./validate";

export const NICE_TO_HAVE_POINTS = 15;
export const NICE_TO_HAVE_CAP = 60;
export const RECENT_JOB_POINTS = 15;
export const WATCH_POST_POINTS = 15;
export const CV_POINTS = 10;
export const MATCH_OPEN_PERCENT = 80;

export function matchIsOpen(score: number): boolean {
  return score >= MATCH_OPEN_PERCENT;
}
export const VALIDATION_POINTS: Record<ValidationStatus, number> = {
  verified: 0,
  review: -8,
  risk: -20,
};

const VALIDATION_WHY: Record<ValidationStatus, string> = {
  verified: "Validation: public work history is consistent",
  review: "Validation: needs review",
  risk: "Validation: high risk",
};

export function candidateKey(record: RawCandidate): string {
  return canonicalProfileUrl(record.profileUrl) || canonicalName(record.name) || record.snippet.slice(0, 40);
}

const UNPUBLISHED_NAME = "name not published";

function mergeText(current: string, incoming: string, max: number): string {
  if (!current) return clip(incoming, max);
  if (!incoming) return current;
  const normalised = current.toLowerCase();
  if (normalised.includes(incoming.toLowerCase())) return current;
  return clip(`${current} · ${incoming}`, max);
}

function preferTitle(current: string, incoming: string): string {
  if (!current || current === "Title not listed" || current === "LinkedIn member") return incoming || current;
  return current;
}

function mergeCandidate(existing: RawCandidate, incoming: RawCandidate): void {
  existing.sources = uniqueStrings([...existing.sources, ...incoming.sources]) as SourceId[];
  existing.title = preferTitle(existing.title, incoming.title);
  if (
    incoming.location &&
    existing.location &&
    !existing.location.toLowerCase().includes(incoming.location.toLowerCase())
  ) {
    existing.location = `${existing.location} · ${incoming.location}`;
  } else if (!existing.location) {
    existing.location = incoming.location;
  }
  if (!existing.profileUrl && incoming.profileUrl) existing.profileUrl = incoming.profileUrl;
  existing.snippet = mergeText(existing.snippet, incoming.snippet, 700);
  existing.haystack = `${existing.haystack}\n${incoming.haystack}`;
  existing.recentlyChangedJobs = existing.recentlyChangedJobs || incoming.recentlyChangedJobs;
  existing.competitorOrComplaintPost =
    existing.competitorOrComplaintPost || incoming.competitorOrComplaintPost;
  existing.cvFound = existing.cvFound || incoming.cvFound;
  existing.matchedWatchPhrases = uniqueStrings([
    ...existing.matchedWatchPhrases,
    ...incoming.matchedWatchPhrases,
  ]);
  existing.sample = existing.sample && incoming.sample;
  existing.experience = [...(existing.experience ?? []), ...(incoming.experience ?? [])];
  existing.origins = [...(existing.origins ?? []), ...(incoming.origins ?? [])];
  if (typeof incoming.connections === "number") {
    existing.connections =
      typeof existing.connections === "number"
        ? Math.min(existing.connections, incoming.connections)
        : incoming.connections;
  }
}

export function dedupeCandidates(records: RawCandidate[]): RawCandidate[] {
  const byUrl = new Map<string, RawCandidate>();
  const byName = new Map<string, RawCandidate>();
  const order: RawCandidate[] = [];

  for (const record of records) {
    const urlKey = canonicalProfileUrl(record.profileUrl);
    const nameKey = canonicalName(record.name);
    const nameIsUseful = nameKey.length > 0 && nameKey !== UNPUBLISHED_NAME;
    const existing = (urlKey ? byUrl.get(urlKey) : undefined) ?? (nameIsUseful ? byName.get(nameKey) : undefined);

    if (!existing) {
      const copy: RawCandidate = {
        ...record,
        sources: [...record.sources],
        matchedWatchPhrases: [...record.matchedWatchPhrases],
        experience: [...(record.experience ?? [])],
        origins: [...(record.origins ?? [])],
      };
      order.push(copy);
      if (urlKey) byUrl.set(urlKey, copy);
      if (nameIsUseful) byName.set(nameKey, copy);
      continue;
    }

    mergeCandidate(existing, record);
    const mergedUrl = canonicalProfileUrl(existing.profileUrl);
    if (mergedUrl) byUrl.set(mergedUrl, existing);
    if (nameIsUseful) byName.set(nameKey, existing);
  }

  return order;
}

function scoreOne(record: RawCandidate, spec: ParsedSpec): Candidate | null {
  const matchedMustHaves = spec.mustHave.filter((phrase) => haystackIncludes(record.haystack, phrase));
  if (spec.mustHave.length > 0 && matchedMustHaves.length !== spec.mustHave.length) return null;

  const matchedNiceToHaves = spec.niceToHave.filter((phrase) => haystackIncludes(record.haystack, phrase));
  const why: ScoreReason[] = matchedMustHaves.map((phrase) => ({
    label: `Must-have: ${phrase}`,
    points: 0,
  }));

  let score = 0;
  let niceBudget = NICE_TO_HAVE_CAP;
  for (const phrase of matchedNiceToHaves) {
    const points = Math.min(NICE_TO_HAVE_POINTS, niceBudget);
    niceBudget -= points;
    score += points;
    why.push({
      label: points > 0 ? `Nice-to-have: ${phrase}` : `Nice-to-have: ${phrase} (cap reached)`,
      points,
    });
  }

  if (record.recentlyChangedJobs) {
    score += RECENT_JOB_POINTS;
    why.push({
      label: "Changed jobs in the last 90 days",
      points: RECENT_JOB_POINTS,
    });
  }

  if (record.competitorOrComplaintPost) {
    score += WATCH_POST_POINTS;
    const phrases = record.matchedWatchPhrases;
    why.push({
      label:
        phrases.length > 0
          ? `Posted about ${phrases.join(", ")}`
          : "Returned by a watched-phrase post search",
      points: WATCH_POST_POINTS,
    });
  }

  if (record.cvFound) {
    score += CV_POINTS;
    why.push({ label: "Public resume snippet found", points: CV_POINTS });
  }

  if (why.length === matchedMustHaves.length) {
    why.push({
      label: "Passed the must-haves, with no extra nice-to-have or signal points",
      points: 0,
    });
  }

  const validation = validateProfile(
    {
      title: record.title,
      location: record.location,
      experience: record.experience,
      connections: record.connections,
    },
    spec,
  );
  const adjustment = VALIDATION_POINTS[validation.status];
  score = Math.max(0, Math.min(100, score + adjustment));
  why.push({ label: VALIDATION_WHY[validation.status], points: adjustment });

  const sources = record.sources.length > 0 ? record.sources : (["linkedin-profile"] as SourceId[]);
  const id = candidateKey(record);

  return {
    id,
    name: record.name,
    title: record.title,
    location: record.location || "Location not listed",
    profileUrl: record.profileUrl,
    source: sources[0] ?? "linkedin-profile",
    sources,
    snippet: record.snippet,
    score: Math.min(100, score),
    why,
    matchedMustHaves,
    matchedNiceToHaves,
    matchedWatchPhrases: record.matchedWatchPhrases,
    recentlyChangedJobs: record.recentlyChangedJobs,
    competitorOrComplaintPost: record.competitorOrComplaintPost,
    cvFound: record.cvFound,
    sample: record.sample,
    validation,
  };
}

export function rankCandidates(
  records: RawCandidate[],
  spec: ParsedSpec,
): { candidates: Candidate[]; afterDedupe: number; droppedForMustHave: number; matched: number } {
  const deduped = dedupeCandidates(records);
  const candidates: Candidate[] = [];
  let droppedForMustHave = 0;

  for (const record of deduped) {
    const scored = scoreOne(record, spec);
    if (!scored) {
      droppedForMustHave += 1;
      continue;
    }
    candidates.push(scored);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return a.name.localeCompare(b.name);
  });

  return {
    candidates: candidates.slice(0, RESULT_LIMIT),
    afterDedupe: deduped.length,
    droppedForMustHave,
    matched: candidates.length,
  };
}
