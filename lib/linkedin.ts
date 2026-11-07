import { asRecord, asString } from "./text";

const ID_TOKEN = /\b(AC[ow][A-Za-z0-9_-]{5,})\b/g;

function remember(found: string[], seen: Set<string>, token: string): void {
  if (!token || seen.has(token)) return;
  seen.add(token);
  found.push(token);
}

function tokensFrom(value: unknown, found: string[], seen: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(ID_TOKEN)) {
      if (match[1]) remember(found, seen, match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) tokensFrom(item, found, seen);
  }
}

export function collectLinkedInIds(record: Record<string, unknown>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const original = asRecord(record.originalQuery);
  const values = [
    record.id,
    record.profileIdInSearch,
    record.objectUrn,
    record.entityUrn,
    record.urn,
    record.linkedinUrl,
    record.url,
    record.profileUrl,
    record.publicIdentifier,
    original?.query,
    original?.url,
  ];
  for (const value of values) tokensFrom(value, found, seen);
  return found;
}

export function linkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function isVanityLinkedInUrl(url: string | null | undefined): boolean {
  const slug = linkedInSlug(url);
  return Boolean(slug && !/^AC[ow]/i.test(slug));
}

export function preferredProfileUrl(record: Record<string, unknown>): string | null {
  const publicIdentifier = asString(record.publicIdentifier);
  if (publicIdentifier && !/^AC[ow]/i.test(publicIdentifier)) {
    return `https://www.linkedin.com/in/${publicIdentifier}`;
  }
  const raw = asString(record.linkedinUrl) || asString(record.url) || asString(record.profileUrl);
  const slug = linkedInSlug(raw);
  if (slug && !/^AC[ow]/i.test(slug)) return `https://www.linkedin.com/in/${slug}`;
  if (raw && /linkedin\.com\/in\//i.test(raw)) return raw.split(/[?#]/)[0] ?? raw;
  const id = collectLinkedInIds(record).find((token) => /^AC[ow]/i.test(token));
  if (id) return `https://www.linkedin.com/in/${id}`;
  if (raw) return raw.split(/[?#]/)[0] ?? raw;
  return null;
}

export function originalQueryUrls(record: Record<string, unknown>): string[] {
  const original = asRecord(record.originalQuery);
  return [asString(original?.query), asString(original?.url)].filter(Boolean);
}

function companyFromEntry(entry: Record<string, unknown>): string {
  const direct = asString(entry.companyName);
  if (direct) return direct;
  const company = asRecord(entry.company);
  return asString(company?.name) || asString(entry.company);
}

function positionEntries(record: Record<string, unknown>): Record<string, unknown>[] {
  const groups = [record.currentPositions, record.currentPosition, record.experience, record.experiences, record.positions];
  const entries: Record<string, unknown>[] = [];
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group && typeof group === "object" ? [group] : [];
    for (const item of list) {
      const entry = asRecord(item);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

export function readCurrentCompany(record: Record<string, unknown>): string {
  for (const entry of positionEntries(record)) {
    const company = companyFromEntry(entry);
    if (company) return company;
  }
  return "";
}

export function readIndustry(record: Record<string, unknown>): string {
  if (typeof record.industry === "string" && record.industry.trim()) return record.industry.trim();
  const named = asString(asRecord(record.industry)?.name);
  if (named) return named;
  for (const entry of positionEntries(record)) {
    const company = asRecord(entry.company);
    const industry = asString(entry.industry) || asString(company?.industry) || asString(asRecord(entry.industry)?.name);
    if (industry) return industry;
  }
  return "";
}
