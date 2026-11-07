import type { SearchRequest } from "./types";
import { asRecord, asString } from "./text";

export const LAST_SEARCH_KEY = "interviewa-last-search";

export function readStoredRequest(value: unknown): SearchRequest | null {
  const record = asRecord(value);
  if (!record) return null;
  const specText = asString(record.specText);
  const jobTitle = asString(record.jobTitle);
  if (!specText && !jobTitle) return null;
  const locked = Array.isArray(record.lockedFields)
    ? record.lockedFields.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    specText,
    jobTitle,
    location: asString(record.location),
    salaryMin: asString(record.salaryMin),
    salaryMax: asString(record.salaryMax),
    salaryCurrency: asString(record.salaryCurrency) || "GBP",
    mustHave: asString(record.mustHave),
    niceToHave: asString(record.niceToHave),
    seniority: asString(record.seniority),
    yearsExperience: asString(record.yearsExperience),
    industry: asString(record.industry),
    workplace: asString(record.workplace),
    watchPhrases: asString(record.watchPhrases),
    useSampleData: false,
    includeIndeed: record.includeIndeed === true,
    includeEmail: record.includeEmail === true,
    recentlyChangedJobs: record.recentlyChangedJobs === true,
    openToWork: record.openToWork !== false,
    ...(locked && locked.length > 0 ? { lockedFields: locked } : {}),
  };
}

export function readLastSearch(raw: string | null): SearchRequest | null {
  if (!raw) return null;
  try {
    return readStoredRequest(JSON.parse(raw));
  } catch {
    return null;
  }
}
