const MATCH_PUNCTUATION = /[^a-z0-9+#.\s]/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function normaliseForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(MATCH_PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function haystackIncludes(haystack: string, phrase: string): boolean {
  const needle = normaliseForMatch(phrase);
  if (!needle) return false;
  return normaliseForMatch(haystack).includes(needle);
}

export function stripContactDetails(value: string): string {
  return value.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");
}

export function canonicalName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalProfileUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    let path = parsed.pathname.replace(/\/+$/, "");
    if (host.endsWith("linkedin.com")) {
      const match = path.match(/\/in\/([^/]+)/i);
      if (match?.[1]) path = `/in/${match[1].toLowerCase()}`;
    }
    return `${host}${path}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}
