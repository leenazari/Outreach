import type { MatchCriterion, MatchCriterionKey, ParsedSpec, RawCandidate, ValidationStatus } from "./types";
import { haystackIncludes, normaliseForMatch } from "./text";
import { monthIndex } from "./work";

/**
 * Weights sum to 100. Each criterion is scored 0–100, then contributes
 * (criterion score / 100) * weight points to the match percentage.
 */
export const MATCH_WEIGHTS = {
  title: 25,
  skills: 25,
  experience: 15,
  location: 15,
  seniority: 10,
  recency: 10,
} as const;

export const HIGH_RISK_SCORE_CAP = 49;

const STOP = new Set(["a", "an", "the", "of", "and", "or", "in", "for", "to", "at", "on"]);

const CRITERION_LABEL: Record<MatchCriterionKey, string> = {
  title: "Job title",
  skills: "Skills",
  experience: "Experience",
  location: "Location",
  seniority: "Seniority",
  recency: "Recency",
};

function tokens(value: string): string[] {
  return normaliseForMatch(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function coverage(needles: string[], haystack: string): number {
  if (needles.length === 0) return 100;
  const hits = needles.filter((token) => haystack.includes(token)).length;
  return Math.round((hits / needles.length) * 100);
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

function yearRequirement(mustHave: string[]): number | null {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  for (const phrase of mustHave) {
    const match = /(?:at least\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*years?/i.exec(phrase);
    if (!match?.[1]) continue;
    const raw = match[1].toLowerCase();
    const years = Number.isFinite(Number(raw)) ? Number(raw) : words[raw];
    if (years && years <= 40) return years;
  }
  return null;
}

function datedMonths(record: RawCandidate, now: Date): number {
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let total = 0;
  let cursor = -1;
  const ranges = (record.experience ?? [])
    .map((role) => {
      if (!role.start) return null;
      const start = monthIndex(role.start);
      const end = role.end ? monthIndex(role.end) : current;
      if (start === null || end === null || end < start) return null;
      return { start, end };
    })
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((a, b) => a.start - b.start);
  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    if (range.end >= start) {
      total += range.end - start + 1;
      cursor = range.end + 1;
    }
  }
  return total;
}

function titleScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  const wanted = tokens(spec.jobTitle);
  const have = normaliseForMatch(record.title);
  const score = wanted.length === 0 ? 100 : coverage(wanted, have);
  return {
    key: "title",
    label: CRITERION_LABEL.title,
    weight: MATCH_WEIGHTS.title,
    score,
    reason:
      wanted.length === 0
        ? "The spec did not name a title."
        : score === 100
          ? "The title lines up with the spec."
          : score === 0
            ? "The title does not share words with the spec."
            : "The title shares some words with the spec.",
  };
}

function skillsScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  const phrases = [...spec.mustHave, ...spec.niceToHave];
  if (phrases.length === 0) {
    return {
      key: "skills",
      label: CRITERION_LABEL.skills,
      weight: MATCH_WEIGHTS.skills,
      score: 100,
      reason: "The spec did not name skills to check.",
    };
  }
  const hits = phrases.filter((phrase) => haystackIncludes(record.haystack, phrase));
  const score = Math.round((hits.length / phrases.length) * 100);
  return {
    key: "skills",
    label: CRITERION_LABEL.skills,
    weight: MATCH_WEIGHTS.skills,
    score,
    reason:
      hits.length === phrases.length
        ? "Every named skill or requirement appears on the public record."
        : `${hits.length} of ${phrases.length} named skills or requirements appear on the public record.`,
  };
}

function experienceScore(spec: ParsedSpec, record: RawCandidate, now: Date): MatchCriterion {
  const months = datedMonths(record, now);
  const yearsNeeded = yearRequirement(spec.mustHave);
  let score = 20;
  let reason = "No dated experience was on the public record.";
  if (yearsNeeded) {
    const needed = yearsNeeded * 12;
    score = months <= 0 ? 20 : Math.min(100, Math.round((months / needed) * 100));
    reason =
      months <= 0
        ? `The spec asks for ${yearsNeeded} years, and no dates were available.`
        : `Dated experience covers ${months} months against ${yearsNeeded} years named in the spec.`;
  } else if (months >= 24) {
    score = 100;
    reason = "Dated experience covers at least two years.";
  } else if (months >= 12) {
    score = 70;
    reason = "Dated experience covers at least one year.";
  } else if (months > 0) {
    score = 40;
    reason = "Dated experience covers less than a year.";
  }
  return { key: "experience", label: CRITERION_LABEL.experience, weight: MATCH_WEIGHTS.experience, score, reason };
}

function locationScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  if (!spec.location.trim()) {
    return {
      key: "location",
      label: CRITERION_LABEL.location,
      weight: MATCH_WEIGHTS.location,
      score: 100,
      reason: "The spec did not name a place.",
    };
  }
  const same =
    haystackIncludes(record.location, spec.location) || haystackIncludes(spec.location, record.location);
  const score = same ? 100 : coverage(tokens(spec.location), normaliseForMatch(record.location));
  return {
    key: "location",
    label: CRITERION_LABEL.location,
    weight: MATCH_WEIGHTS.location,
    score,
    reason: score === 100 ? "The location lines up with the spec." : "The location does not line up with the spec.",
  };
}

function seniorityScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  const gap = Math.abs(seniority(record.title) - seniority(spec.jobTitle));
  const score = gap === 0 ? 100 : gap === 1 ? 75 : gap === 2 ? 45 : 20;
  return {
    key: "seniority",
    label: CRITERION_LABEL.seniority,
    weight: MATCH_WEIGHTS.seniority,
    score,
    reason:
      gap === 0
        ? "Seniority is in line with the title in the spec."
        : "Seniority sits away from the title in the spec.",
  };
}

function recencyScore(record: RawCandidate, now: Date): MatchCriterion {
  if (record.recentlyChangedJobs) {
    return {
      key: "recency",
      label: CRITERION_LABEL.recency,
      weight: MATCH_WEIGHTS.recency,
      score: 100,
      reason: "A recent job change is on the public record.",
    };
  }
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const fresh = (record.experience ?? []).some((role) => {
    if (role.end || !role.start) return false;
    const start = monthIndex(role.start);
    return start !== null && current - start <= 18;
  });
  return {
    key: "recency",
    label: CRITERION_LABEL.recency,
    weight: MATCH_WEIGHTS.recency,
    score: fresh ? 80 : (record.experience?.length ?? 0) > 0 ? 45 : 20,
    reason: fresh
      ? "The current role started within the last 18 months."
      : "No recent job change was on the public record.",
  };
}

export function scoreMatch(
  record: RawCandidate,
  spec: ParsedSpec,
  validation: ValidationStatus,
  now = new Date(),
): { score: number; criteria: MatchCriterion[]; unlockBlocked: boolean; blockedReason: string | null } {
  const criteria = [
    titleScore(spec, record),
    skillsScore(spec, record),
    experienceScore(spec, record, now),
    locationScore(spec, record),
    seniorityScore(spec, record),
    recencyScore(record, now),
  ];
  const raw = Math.round(criteria.reduce((total, item) => total + (item.score * item.weight) / 100, 0));
  if (validation === "risk") {
    return {
      score: Math.min(raw, HIGH_RISK_SCORE_CAP),
      criteria,
      unlockBlocked: true,
      blockedReason: "High risk blocks identity unlock. The match is capped below the gate.",
    };
  }
  return { score: Math.max(0, Math.min(100, raw)), criteria, unlockBlocked: false, blockedReason: null };
}

export function clampThreshold(value: unknown, fallback = 80): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}
