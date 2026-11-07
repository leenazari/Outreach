import type { SearchRequest } from "./types";

export const PARSED_FIELDS = [
  "jobTitle",
  "location",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "mustHave",
  "niceToHave",
  "seniority",
  "yearsExperience",
  "industry",
  "workplace",
  "searchTitle",
] as const;

export type ParsedField = (typeof PARSED_FIELDS)[number];

export type ParsedSpecFields = Pick<SearchRequest, ParsedField>;

export function pickParsedField(formValue: string, parsed: string, locked: boolean): string {
  if (locked) return formValue.trim();
  const current = formValue.trim();
  return current || parsed;
}

export function pickCurrency(formValue: string, parsed: string, locked: boolean): string {
  if (locked) return formValue.trim() || "GBP";
  if (formValue.trim() && formValue.trim() !== "GBP") return formValue.trim();
  return parsed || formValue.trim() || "GBP";
}

export function applyParsedSpec(
  current: SearchRequest,
  parsed: Partial<ParsedSpecFields>,
  touched: ReadonlySet<string>,
): SearchRequest {
  const next = { ...current };
  for (const field of PARSED_FIELDS) {
    if (touched.has(field)) continue;
    const value = parsed[field];
    if (typeof value !== "string") continue;
    next[field] = value;
  }
  return next;
}
