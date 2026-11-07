import type { ParsedSpec, Validation, ValidationReason, ValidationStatus, WorkRole } from "./types";
import { formatYearMonth, monthIndex } from "./work";

const STATUS_LABEL: Record<ValidationStatus, string> = {
  verified: "Verified consistent",
  review: "Needs review",
  risk: "High risk",
  unchecked: "Not checked (short profile)",
};

type Reason = ValidationReason & { severe: boolean };

type DatedRole = WorkRole & { startIndex: number; endIndex: number };

function yearMonthNow(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function datedRoles(roles: WorkRole[], now: Date): DatedRole[] {
  const current = monthIndex(yearMonthNow(now));
  const dated: DatedRole[] = [];
  for (const role of roles) {
    if (!role.start) continue;
    const startIndex = monthIndex(role.start);
    if (startIndex === null) continue;
    const endIndex = role.end ? monthIndex(role.end) : current;
    if (endIndex === null) continue;
    dated.push({ ...role, startIndex, endIndex });
  }
  return dated;
}

function durationMonths(role: DatedRole): number {
  return Math.max(1, role.endIndex - role.startIndex + 1);
}

function normalCompany(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|plc|gmbh|co)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companiesDisagree(left: string, right: string): boolean {
  const a = normalCompany(left);
  const b = normalCompany(right);
  if (!a || !b) return false;
  return !a.includes(b) && !b.includes(a);
}

function locationsDisagree(left: string, right: string): boolean {
  const words = (value: string) =>
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
  const a = words(left);
  const b = words(right);
  if (a.length === 0 || b.length === 0) return false;
  return !a.some((word) => b.includes(word));
}

function seniority(title: string): number {
  const text = title.toLowerCase();
  if (/\b(chief|cxo|ceo|cto|cfo|founder|co-founder)\b/.test(text)) return 8;
  if (/\b(vp|vice president)\b/.test(text)) return 7;
  if (/\bdirector\b/.test(text)) return 6;
  if (/\b(head|manager)\b/.test(text)) return 5;
  if (/\b(lead|principal)\b/.test(text)) return 4;
  if (/\bsenior\b/.test(text)) return 3;
  if (/\b(junior|intern|assistant|trainee|apprentice)\b/.test(text)) return 1;
  return 2;
}

function coveredMonths(roles: DatedRole[]): number {
  if (roles.length === 0) return 0;
  const points = [...roles].sort((a, b) => a.startIndex - b.startIndex);
  let used = 0;
  let cursor = points[0]?.startIndex ?? 0;
  for (const role of points) {
    const start = Math.max(role.startIndex, cursor);
    if (role.endIndex >= start) {
      used += role.endIndex - start + 1;
      cursor = role.endIndex + 1;
    }
  }
  return used;
}

function linkedInSource(source: WorkRole["source"]): boolean {
  return source === "linkedin-profile" || source === "linkedin-detail";
}

export function validateProfile(
  input: {
    title: string;
    location: string;
    experience?: WorkRole[];
    connections?: number | null;
    enriched?: boolean;
  },
  spec: Pick<ParsedSpec, "mustHave">,
  now = new Date(),
): Validation {
  const roles = input.experience ?? [];
  const dated = datedRoles(roles, now);
  const reasons: Reason[] = [];

  for (const role of dated) {
    if (role.end && role.endIndex < role.startIndex) {
      reasons.push({
        severe: true,
        summary: "A public date range ends before it starts.",
        evidence: `${role.title} at ${role.company || "an unnamed employer"} is listed as ${formatYearMonth(role.start ?? "")} to ${formatYearMonth(role.end)}.`,
      });
    }
  }

  const sensible = dated.filter((role) => role.endIndex >= role.startIndex);
  const byMonth = new Map<number, Set<string>>();
  for (const role of sensible) {
    const company = normalCompany(role.company) || role.title.toLowerCase();
    for (let month = role.startIndex; month <= role.endIndex; month += 1) {
      const names = byMonth.get(month) ?? new Set<string>();
      names.add(company);
      byMonth.set(month, names);
    }
  }
  let peak = 0;
  for (const names of byMonth.values()) peak = Math.max(peak, names.size);
  const overlapPairs: string[] = [];
  for (let index = 0; index < sensible.length; index += 1) {
    for (let other = index + 1; other < sensible.length; other += 1) {
      const left = sensible[index];
      const right = sensible[other];
      if (!left || !right || !companiesDisagree(left.company, right.company)) continue;
      const overlap = Math.min(left.endIndex, right.endIndex) - Math.max(left.startIndex, right.startIndex) + 1;
      if (overlap >= 2) {
        overlapPairs.push(
          `${left.title} at ${left.company || "one employer"} overlaps ${right.title} at ${right.company || "another employer"} by ${overlap} months.`,
        );
      }
    }
  }
  if (peak >= 3) {
    reasons.push({
      severe: true,
      summary: "Three or more employers are listed at the same time.",
      evidence: overlapPairs.slice(0, 2).join(" ") || "The dated public roles overlap across three employers.",
    });
  } else if (overlapPairs.length > 0) {
    reasons.push({
      severe: false,
      summary: "Dated roles at different employers overlap.",
      evidence: overlapPairs[0] ?? "Two public roles cover the same months.",
    });
  }

  const short = sensible.filter((role) => durationMonths(role) < 6);
  const veryShort = sensible.filter((role) => durationMonths(role) < 4);
  if (veryShort.length >= 4) {
    reasons.push({
      severe: true,
      summary: "Several very short roles are listed one after another.",
      evidence: `${veryShort.length} dated roles each lasted under four months.`,
    });
  } else if (short.length >= 3) {
    reasons.push({
      severe: false,
      summary: "Several short roles are listed one after another.",
      evidence: `${short.length} dated roles each lasted under six months.`,
    });
  }

  const totalMonths = coveredMonths(sensible);
  const leader = [input.title, ...roles.map((role) => role.title)].sort((a, b) => seniority(b) - seniority(a))[0] ?? "";
  if (seniority(leader) >= 6 && totalMonths > 0 && totalMonths < 12) {
    reasons.push({
      severe: true,
      summary: "A senior title appears with under a year of dated public experience.",
      evidence: `${leader} is listed, and the dated roles add up to ${totalMonths} months.`,
    });
  } else if (seniority(leader) >= 6 && totalMonths > 0 && totalMonths < 24) {
    reasons.push({
      severe: false,
      summary: "A senior title appears with a short dated public history.",
      evidence: `${leader} is listed, and the dated roles add up to ${totalMonths} months.`,
    });
  }

  const ordered = [...sensible].sort((a, b) => a.startIndex - b.startIndex);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const next = ordered[index];
    if (!previous || !next) continue;
    const jump = seniority(next.title) - seniority(previous.title);
    const gap = next.startIndex - previous.endIndex;
    if (jump >= 3 && gap < 12) {
      reasons.push({
        severe: false,
        summary: "A job title jumps several seniority levels in under a year.",
        evidence: `${previous.title} is followed by ${next.title}.`,
      });
      break;
    }
  }

  const linkedInCurrent = roles.filter((role) => linkedInSource(role.source) && role.end === null && role.company);
  const indeedCurrent = roles.filter((role) => role.source === "indeed-resume" && role.end === null && role.company);
  if (linkedInCurrent[0] && indeedCurrent[0] && companiesDisagree(linkedInCurrent[0].company, indeedCurrent[0].company)) {
    reasons.push({
      severe: false,
      summary: "LinkedIn and the Indeed resume name different current employers.",
      evidence: `LinkedIn lists ${linkedInCurrent[0].company}. The Indeed resume lists ${indeedCurrent[0].company}.`,
    });
  }
  if (
    linkedInCurrent[0] &&
    indeedCurrent[0] &&
    locationsDisagree(linkedInCurrent[0].location || input.location, indeedCurrent[0].location)
  ) {
    reasons.push({
      severe: false,
      summary: "LinkedIn and the Indeed resume name different locations for the current role.",
      evidence: `LinkedIn lists ${linkedInCurrent[0].location || input.location}. The Indeed resume lists ${indeedCurrent[0].location}.`,
    });
  }

  if (typeof input.connections === "number" && input.connections < 10 && dated.length === 0) {
    reasons.push({
      severe: true,
      summary: "The public profile shows very few connections and no dated work history.",
      evidence: `LinkedIn shows ${input.connections} connections, and no dated roles were returned.`,
    });
  } else if (typeof input.connections === "number" && input.connections < 50) {
    reasons.push({
      severe: false,
      summary: "The public profile shows a low connection count.",
      evidence: `LinkedIn shows ${input.connections} connections. A lower count is only a flag.`,
    });
  }

  if (dated.length === 0 && seniority(input.title) >= 6) {
    reasons.push({
      severe: true,
      summary: "A senior title is listed without dated public work history.",
      evidence: `${input.title} is on the profile, and no start or end dates were returned.`,
    });
  } else if (dated.length === 0) {
    reasons.push({
      severe: false,
      summary: "There is not enough dated public history to call this consistent.",
      evidence: "No start and end dates were on the profiles returned for this person.",
    });
  }

  const thinHistory = dated.length < 2;
  if (thinHistory) {
    for (const reason of reasons) {
      if (reason.summary === "A public date range ends before it starts.") continue;
      reason.severe = false;
    }
  }

  const severe = reasons.some((reason) => reason.severe);
  let status: ValidationStatus = severe ? "risk" : reasons.length > 0 ? "review" : "verified";
  if (input.enriched === false && !severe && dated.length < 2) {
    const specific = reasons.filter((reason) => reason.summary !== "There is not enough dated public history to call this consistent.");
    if (specific.length === 0) status = "unchecked";
  }
  const visible: ValidationReason[] =
    status === "verified"
      ? [
          {
            summary: "The dated public work history lines up.",
            evidence: `${dated.length} dated role${dated.length === 1 ? "" : "s"} showed no overlap, date, or seniority flag.`,
          },
        ]
      : status === "unchecked"
        ? [
            {
              summary: "Not checked (short profile)",
              evidence: "The full profile was not fetched, so the work history was not checked.",
            },
          ]
        : reasons.map(({ summary, evidence }) => ({ summary, evidence }));

  return { status, label: STATUS_LABEL[status], reasons: visible };
}
