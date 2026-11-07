import type { ParsedSpec } from "./types";
import { asString } from "./text";

const MAX_PHRASE_LENGTH = 80;
const MAX_PHRASES = 12;
const MAX_WATCH_PHRASES = 5;

export function parsePhraseList(raw: string, limit = MAX_PHRASES): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const phrase = part.trim().replace(/\s+/g, " ").slice(0, MAX_PHRASE_LENGTH);
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(phrase);
    if (items.length >= limit) break;
  }
  return items;
}

function formatAmount(currency: string, raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return raw.trim();
  const formatted = Number(digits).toLocaleString("en-GB");
  if (currency === "GBP") return `£${formatted}`;
  if (currency === "USD") return `$${formatted}`;
  if (currency === "EUR") return `€${formatted}`;
  return `${currency} ${formatted}`;
}

export function salaryLabel(spec: Pick<ParsedSpec, "salaryMin" | "salaryMax" | "salaryCurrency">): string {
  const currency = spec.salaryCurrency || "GBP";
  const min = spec.salaryMin ? formatAmount(currency, spec.salaryMin) : "";
  const max = spec.salaryMax ? formatAmount(currency, spec.salaryMax) : "";
  if (min && max) return min === max ? min : `${min} to ${max}`;
  if (min) return min;
  if (max) return `Up to ${max}`;
  return "Not specified";
}

export function parseSearchRequest(
  body: unknown,
): { ok: true; spec: ParsedSpec } | { ok: false; error: string } {
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!record) return { ok: false, error: "Expected a JSON object." };

  const jobTitle = asString(record.jobTitle);
  const location = asString(record.location);
  if (!jobTitle) return { ok: false, error: "Job title is required." };
  if (!location) return { ok: false, error: "Location is required." };
  if (jobTitle.length > 120) return { ok: false, error: "Job title is too long." };
  if (location.length > 120) return { ok: false, error: "Location is too long." };

  const currency = asString(record.salaryCurrency).toUpperCase().slice(0, 8);

  return {
    ok: true,
    spec: {
      jobTitle,
      location,
      salaryMin: asString(record.salaryMin).slice(0, 20),
      salaryMax: asString(record.salaryMax).slice(0, 20),
      salaryCurrency: currency || "GBP",
      mustHave: parsePhraseList(asString(record.mustHave)),
      niceToHave: parsePhraseList(asString(record.niceToHave)),
      watchPhrases: parsePhraseList(asString(record.watchPhrases), MAX_WATCH_PHRASES),
      useSampleData: record.useSampleData === true,
    },
  };
}
