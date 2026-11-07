import { RESULT_LIMIT } from "./actors";
import type { Candidate, ParsedSpec, RawCandidate, ScoreReason, SourceId, ValidationStatus } from "./types";
import { canonicalName, canonicalProfileUrl, clip, haystackIncludes, uniqueStrings } from "./text";
import { companyType, locationRegion, presentCandidate } from "./identity";
import { clampThreshold, scoreMatch } from "./match";
import { validateProfile } from "./validate";

export const NICE_TO_HAVE_POINTS = 15;
export const NICE_TO_HAVE_CAP = 60;
export const RECENT_JOB_POINTS = 15;
export const WATCH_POST_POINTS = 15;
export const CV_POINTS = 10;
export const MATCH_OPEN_PERCENT = 80;

export function matchIsOpen(score: number, threshold = MATCH_OPEN_PERCENT): boolean {
  return score >= threshold;
}

export function presentRanked(candidates: Candidate[]): Candidate[] {
  return candidates.map((candidate) => presentCandidate(candidate));
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
  existing.detailOnRecord = existing.detailOnRecord || incoming.detailOnRecord;
  if (!existing.sourceUrl && incoming.sourceUrl) existing.sourceUrl = incoming.sourceUrl;
  if (!existing.email && incoming.email) existing.email = incoming.email;
  if (!existing.photoUrl && incoming.photoUrl) existing.photoUrl = incoming.photoUrl;
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

const COUNTRIES: { name: string; pattern: RegExp }[] = [
  {
    name: "United Kingdom",
    pattern:
      /\b(united kingdom|england|scotland|wales|northern ireland|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|newcastle|nottingham|cardiff|belfast|leicester|coventry|brighton|oxford|cambridge|reading|southampton|portsmouth|york|bath|aberdeen|dundee|swansea|plymouth|derby|uk)\b/i,
  },
  {
    name: "United States",
    pattern: /\b(united states|usa|u\.s\.a?\.|new york|san francisco|los angeles|chicago|boston|seattle|austin|texas|california)\b/i,
  },
  { name: "Ireland", pattern: /\b(ireland|dublin|cork)\b/i },
  { name: "France", pattern: /\b(france|paris|lyon)\b/i },
  { name: "Germany", pattern: /\b(germany|berlin|munich|hamburg)\b/i },
  { name: "Netherlands", pattern: /\b(netherlands|amsterdam)\b/i },
  { name: "Canada", pattern: /\b(canada|toronto|vancouver|montreal)\b/i },
  { name: "Australia", pattern: /\b(australia|sydney|melbourne)\b/i },
  { name: "India", pattern: /\b(india|bangalore|bengaluru|mumbai|delhi)\b/i },
  { name: "Singapore", pattern: /\bsingapore\b/i },
  { name: "United Arab Emirates", pattern: /\b(united arab emirates|dubai|abu dhabi)\b/i },
];

function countryOf(location: string): string | null {
  for (const country of COUNTRIES) {
    if (country.pattern.test(location)) return country.name;
  }
  return null;
}

export function countryContradiction(candidateLocation: string, specLocation: string): boolean {
  if (!candidateLocation.trim() || !specLocation.trim()) return false;
  const theirs = countryOf(candidateLocation);
  const wanted = countryOf(specLocation);
  if (!theirs || !wanted) return false;
  return theirs !== wanted;
}

function experienceSummary(record: RawCandidate): string {
  const months = (record.experience ?? []).filter((role) => role.start).length;
  if (months === 0) return "Experience length was not dated on the public record.";
  return `${months} dated role${months === 1 ? "" : "s"} on the public record.`;
}

function scoreOne(record: RawCandidate, spec: ParsedSpec, threshold: number): Candidate | null {
  if (countryContradiction(record.location, spec.location)) return null;

  const matchedMustHaves = spec.mustHave.filter((phrase) => haystackIncludes(record.haystack, phrase));

  const matchedNiceToHaves = spec.niceToHave.filter((phrase) => haystackIncludes(record.haystack, phrase));
  const why: ScoreReason[] = matchedMustHaves.map((phrase) => ({
    label: `Must-have: ${phrase}`,
    points: 0,
  }));
  if (record.competitorOrComplaintPost) {
    const phrases = record.matchedWatchPhrases;
    why.push({
      label: phrases.length > 0 ? `Posted about ${phrases.join(", ")}` : "Returned by a watched-phrase post search",
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
  const match = scoreMatch(record, spec, validation.status);
  why.push({ label: VALIDATION_WHY[validation.status], points: 0 });
  for (const criterion of match.criteria) {
    why.push({ label: `${criterion.label}: ${criterion.reason}`, points: criterion.score });
  }

  const sources = record.sources.length > 0 ? record.sources : (["linkedin-profile"] as SourceId[]);
  const skills = [...matchedMustHaves, ...matchedNiceToHaves];
  const id = candidateKey(record);
  const unlocked = match.eligible && !match.unlockBlocked && match.score >= threshold;

  return {
    id,
    name: record.name,
    title: record.title,
    location: record.location || "Location not listed",
    locationRegion: locationRegion(record.location || ""),
    companyType: companyType(record.title),
    experienceSummary: experienceSummary(record),
    skills,
    profileUrl: record.profileUrl,
    sourceUrl: record.sourceUrl ?? (sources.every((source) => source === "indeed-resume") ? record.profileUrl : null),
    email: record.email ?? null,
    photoUrl: record.photoUrl ?? null,
    source: sources[0] ?? "linkedin-profile",
    sources,
    snippet: record.snippet,
    score: match.score,
    subscores: match.criteria,
    why,
    matchedMustHaves,
    matchedNiceToHaves,
    matchedWatchPhrases: record.matchedWatchPhrases,
    recentlyChangedJobs: record.recentlyChangedJobs,
    competitorOrComplaintPost: record.competitorOrComplaintPost,
    cvFound: record.cvFound,
    sample: record.sample,
    validation,
    unlocked,
    unlockBlocked: match.unlockBlocked,
    blockedReason: match.blockedReason,
    identityNote: null,
  };
}

export function rankCandidates(
  records: RawCandidate[],
  spec: ParsedSpec,
  threshold = 80,
): { candidates: Candidate[]; afterDedupe: number; droppedForMustHave: number; matched: number } {
  const gate = clampThreshold(threshold);
  const deduped = dedupeCandidates(records);
  const candidates: Candidate[] = [];
  let droppedForMustHave = 0;

  for (const record of deduped) {
    const scored = scoreOne(record, spec, gate);
    if (!scored) {
      droppedForMustHave += 1;
      continue;
    }
    candidates.push(scored);
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.sources.length !== a.sources.length) return b.sources.length - a.sources.length;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return {
    candidates: candidates.slice(0, RESULT_LIMIT),
    afterDedupe: deduped.length,
    droppedForMustHave,
    matched: candidates.length,
  };
}
