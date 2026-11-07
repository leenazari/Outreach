import type { WorkRole } from "./types";
import { asRecord, asString, clip } from "./text";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function monthNumber(value: unknown): number | null {
  if (typeof value === "number" && value >= 1 && value <= 12) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) return numeric;
    const named = MONTHS[value.slice(0, 3).toLowerCase()];
    if (named) return named;
  }
  return null;
}

export function parseYearMonth(value: unknown, edge: "start" | "end" = "start"): string | null {
  const missingMonth = edge === "end" ? 12 : 1;
  if (typeof value === "number" && value >= 1950 && value <= 2100) return `${value}-${String(missingMonth).padStart(2, "0")}`;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || /present|current|now/i.test(text)) return null;
    const iso = /^(\d{4})-(\d{2})/.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}`;
    const yearOnly = /^(\d{4})$/.exec(text);
    if (yearOnly) return `${yearOnly[1]}-${String(missingMonth).padStart(2, "0")}`;
    const named = /([A-Za-z]{3,9})\s+(\d{4})/.exec(text) ?? /(\d{4})\s+([A-Za-z]{3,9})/.exec(text);
    if (named) {
      const monthName = /[A-Za-z]/.test(named[1] ?? "") ? named[1] : named[2];
      const yearText = /[A-Za-z]/.test(named[1] ?? "") ? named[2] : named[1];
      const month = MONTHS[(monthName ?? "").slice(0, 3).toLowerCase()];
      if (month && yearText) return `${yearText}-${String(month).padStart(2, "0")}`;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const text = asString(record.text);
  if (/present|current|now/i.test(text) && record.year == null) return null;
  const namedText = text && /[A-Za-z]/.test(text) ? parseYearMonth(text, edge) : null;
  if (namedText) return namedText;
  const year = typeof record.year === "number" ? record.year : Number(record.year);
  if (!Number.isFinite(year) || year < 1950 || year > 2100) return text ? parseYearMonth(text, edge) : null;
  const month = monthNumber(record.month) ?? missingMonth;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function companyName(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  if (!record) return "";
  return asString(record.name) || asString(record.companyName);
}

export function readWorkRoles(
  record: Record<string, unknown>,
  source: WorkRole["source"],
): WorkRole[] {
  const groups = [record.experience, record.experiences, record.positions, record.workExperience, record.currentPositions, record.currentPosition];
  const roles: WorkRole[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const list = Array.isArray(group) ? group : group && typeof group === "object" ? [group] : [];
    for (const item of list) {
      const entry = asRecord(item);
      if (!entry) continue;
      const title = asString(entry.title) || asString(entry.position) || asString(entry.jobTitle);
      const company = companyName(entry.companyName) || companyName(entry.company) || asString(entry.companyName);
      const location =
        asString(entry.locationName) ||
        (typeof entry.location === "string" ? entry.location : asString(asRecord(entry.location)?.linkedinText));
      const current = entry.current === true || /present|current/i.test(asString(entry.endDateText));
      const start = parseYearMonth(entry.startDate ?? entry.startedOn ?? entry.start ?? entry.dateFrom, "start");
      const end = current ? null : parseYearMonth(entry.endDate ?? entry.endedOn ?? entry.end ?? entry.dateTo, "end");
      const detail = clip(asString(entry.description) || asString(entry.summary), 240);
      if (!title && !company) continue;
      const key = `${title}|${company}|${start ?? ""}|${end ?? ""}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roles.push({
        title: title || "Role",
        company,
        location,
        start,
        end,
        detail,
        source,
      });
    }
  }
  return roles;
}

export function readConnections(record: Record<string, unknown>): number | null {
  for (const key of ["connectionsCount", "connections", "connectionCount"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    if (typeof value === "string" && /^\d{1,7}$/.test(value.trim())) return Number(value.trim());
  }
  return null;
}

export function monthIndex(yearMonth: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

export function formatYearMonth(yearMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) return yearMonth;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}
