import { isVanityLinkedInUrl } from "./linkedin";
import type { RawCandidate } from "./types";
import { canonicalName, canonicalProfileUrl, uniqueStrings } from "./text";

const UNPUBLISHED_NAME = "name not published";

export type EnrichmentTarget = {
  score: number;
  profileUrl: string | null;
  linkedinIds?: string[];
};

export function enrichmentQuery(target: EnrichmentTarget): string | null {
  const url = target.profileUrl?.trim() ?? "";
  if (/linkedin\.com\/in\//i.test(url)) return url.split(/[?#]/)[0] ?? url;
  const id = (target.linkedinIds ?? []).find((token) => /^AC[ow]/i.test(token));
  if (id) return `https://www.linkedin.com/in/${id}`;
  if (/linkedin\.com\//i.test(url)) return url.split(/[?#]/)[0] ?? url;
  return null;
}

export function selectEnrichmentTargets<T extends EnrichmentTarget>(candidates: T[], limit: number): T[] {
  return [...candidates]
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => candidate.score >= 50 && enrichmentQuery(candidate))
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

function samePerson(target: RawCandidate, extra: RawCandidate): boolean {
  if (idsOverlap(target.linkedinIds, extra.linkedinIds)) return true;
  const left = new Set(urlKeys(target));
  if (urlKeys(extra).some((url) => left.has(url))) return true;
  const name = canonicalName(extra.name);
  const targetName = canonicalName(target.name);
  return Boolean(name && targetName && name === targetName && targetName !== UNPUBLISHED_NAME);
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
    if (extra.title && extra.title !== "Title not listed") target.title = extra.title;
    target.profileUrl = preferUrl(target.profileUrl, extra.profileUrl);
    target.linkedinIds = uniqueStrings([...(target.linkedinIds ?? []), ...(extra.linkedinIds ?? [])]);
    target.queryUrls = uniqueStrings([...(target.queryUrls ?? []), ...(extra.queryUrls ?? [])]);
    target.haystack = `${target.haystack}\n${extra.haystack}`;
    if (extra.snippet) target.snippet = extra.snippet;
    if (!target.email && extra.email) target.email = extra.email;
    if (!target.photoUrl && extra.photoUrl) target.photoUrl = extra.photoUrl;
    target.origins = [...(target.origins ?? []), ...(extra.origins ?? [])];
    target.recentlyChangedJobs = target.recentlyChangedJobs || extra.recentlyChangedJobs;
  }
}
