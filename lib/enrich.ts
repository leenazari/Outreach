import { MAX_ENRICH } from "./actors";
import { isVanityLinkedInUrl, memberKeysFrom } from "./linkedin";
import { commuteDecision } from "./location-fit";
import { dedupeCandidates } from "./rank";
import { titleClearlyUnrelated } from "./title-filter";
import type { ParsedSpec, RawCandidate } from "./types";
import { canonicalName, canonicalProfileUrl, uniqueStrings } from "./text";

const UNPUBLISHED_NAME = "name not published";

export type EnrichmentTarget = {
  score: number;
  profileUrl: string | null;
  linkedinIds?: string[];
  subscores?: { key: string; assessed: boolean }[];
};

function assessedEnough(target: EnrichmentTarget): boolean {
  const subscores = target.subscores;
  if (!subscores || subscores.length === 0) return true;
  const assessed = (key: string) => subscores.find((item) => item.key === key)?.assessed === true;
  const others = subscores.filter((item) => item.assessed && item.key !== "title" && item.key !== "location").length;
  return assessed("title") && assessed("location") && others >= 1;
}

export function enrichmentQuery(target: EnrichmentTarget): string | null {
  const url = target.profileUrl?.trim() ?? "";
  if (/linkedin\.com\/in\//i.test(url)) return url.split(/[?#]/)[0] ?? url;
  const id = (target.linkedinIds ?? []).find((token) => /^AC[ow]/i.test(token));
  if (id) return `https://www.linkedin.com/in/${id}`;
  if (/linkedin\.com\//i.test(url)) return url.split(/[?#]/)[0] ?? url;
  return null;
}

export function preFilterCandidates(records: RawCandidate[], spec: ParsedSpec, limit = MAX_ENRICH): {
  kept: RawCandidate[];
  enrich: RawCandidate[];
  excludedLocation: number;
  excludedTitle: number;
} {
  let excludedLocation = 0;
  let excludedTitle = 0;
  const kept: RawCandidate[] = [];
  for (const record of dedupeCandidates(records)) {
    const linkedIn = record.sources.includes("linkedin-profile") || Boolean(record.profileUrl?.includes("linkedin.com/in/"));
    if (linkedIn && commuteDecision(record.location, spec) === "excluded") {
      excludedLocation += 1;
      continue;
    }
    if (linkedIn && titleClearlyUnrelated(record.title, spec.jobTitle)) {
      excludedTitle += 1;
      continue;
    }
    kept.push(record);
  }
  const enrich = [...kept].sort((left, right) => {
    const location =
      Number(commuteDecision(left.location, spec) === "unknown") - Number(commuteDecision(right.location, spec) === "unknown");
    if (location !== 0) return location;
    return (right.firstPassScore ?? 0) - (left.firstPassScore ?? 0);
  });
  return { kept, enrich: enrich.slice(0, Math.max(0, limit)), excludedLocation, excludedTitle };
}

export function profilesToEnrich(records: RawCandidate[], spec: ParsedSpec, limit: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const record of dedupeCandidates(records)) {
    if (urls.length >= limit) break;
    if (commuteDecision(record.location, spec) === "excluded") continue;
    const url = enrichmentQuery({
      score: record.firstPassScore ?? 0,
      profileUrl: record.profileUrl,
      linkedinIds: record.linkedinIds,
    });
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function selectEnrichmentTargets<T extends EnrichmentTarget>(candidates: T[], limit: number): T[] {
  return [...candidates]
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.score >= 50 && assessedEnough(candidate) && enrichmentQuery(candidate))
    .slice(0, Math.max(0, limit));
}

function idsOverlap(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right || left.length === 0 || right.length === 0) return false;
  const seen = new Set(left);
  return right.some((id) => seen.has(id));
}

function urlKeys(record: RawCandidate): string[] {
  const keys = [record.profileUrl, ...(record.queryUrls ?? [])]
    .map((url) => canonicalProfileUrl(url ?? null))
    .filter((url): url is string => Boolean(url));
  return uniqueStrings(keys);
}

function namesAgree(target: RawCandidate, extra: RawCandidate): boolean {
  const name = canonicalName(extra.name);
  const targetName = canonicalName(target.name);
  if (!name || !targetName || targetName === UNPUBLISHED_NAME || name === UNPUBLISHED_NAME) return false;
  return name === targetName;
}

function samePerson(target: RawCandidate, extra: RawCandidate): boolean {
  const memberHit = idsOverlap(memberKeysFrom(target.linkedinIds), memberKeysFrom(extra.linkedinIds));
  const urlHit = urlKeys(extra).some((url) => new Set(urlKeys(target)).has(url));
  if ((memberHit || urlHit) && namesAgree(target, extra)) return true;
  if (memberHit && (!canonicalName(target.name) || !canonicalName(extra.name))) return true;
  return false;
}

function preferUrl(current: string | null, incoming: string | null): string | null {
  if (isVanityLinkedInUrl(incoming)) return incoming;
  if (isVanityLinkedInUrl(current)) return current;
  return current || incoming;
}

export function applyEnrichment(records: RawCandidate[], enriched: RawCandidate[]): void {
  for (const extra of enriched) {
    const target = records.find((record) => samePerson(record, extra));
    if (!target) continue;
    target.detailOnRecord = target.detailOnRecord || extra.detailOnRecord || (extra.experience?.length ?? 0) > 0;
    if ((extra.experience?.length ?? 0) > 0) {
      target.experience = [
        ...(target.experience ?? []).filter((role) => role.source === "indeed-resume"),
        ...(extra.experience ?? []),
      ];
    }
    if (typeof extra.connections === "number") target.connections = extra.connections;
    if (extra.company) target.company = extra.company;
    if (extra.industry) target.industry = extra.industry;
    target.openToWork = target.openToWork || extra.openToWork;
    if (!target.openToWorkPostUrl && extra.openToWorkPostUrl) target.openToWorkPostUrl = extra.openToWorkPostUrl;
    if (extra.title && extra.title !== "Title not listed") target.title = extra.title;
    target.profileUrl = preferUrl(target.profileUrl, extra.profileUrl);
    target.linkedinIds = uniqueStrings([...(target.linkedinIds ?? []), ...(extra.linkedinIds ?? [])]);
    target.queryUrls = uniqueStrings([...(target.queryUrls ?? []), ...(extra.queryUrls ?? [])]);
    target.haystack = `${target.haystack}\n${extra.haystack}`;
    if (extra.snippet) target.snippet = extra.snippet;
    if (extra.headline) target.headline = extra.headline;
    if (extra.about) target.about = extra.about;
    if ((extra.skills?.length ?? 0) > 0) target.skills = extra.skills;
    if (!target.email && extra.email) target.email = extra.email;
    if (!target.photoUrl && extra.photoUrl) target.photoUrl = extra.photoUrl;
    target.enriched = true;
    target.origins = [...(target.origins ?? []), ...(extra.origins ?? [])];
    target.recentlyChangedJobs = target.recentlyChangedJobs || extra.recentlyChangedJobs;
  }
}
