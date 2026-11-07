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

const NOT_ASSESSED = "not assessed";

const INDUSTRY_FAMILIES: { id: string; label: string; pattern: RegExp }[] = [
  { id: "software", label: "B2B software", pattern: /\b(b2b saas|saas|software|hr tech|fintech|devtools?)\b/i },
  { id: "aviation", label: "aviation", pattern: /\b(commercial aviation|aviation|airline|airlines|aerospace|aircraft)\b/i },
  { id: "healthcare", label: "healthcare", pattern: /\b(healthcare|hospital|clinical|pharma|pharmaceutical)\b/i },
  { id: "finance", label: "financial services", pattern: /\b(investment bank|banking|insurance|hedge fund)\b/i },
  { id: "retail", label: "retail", pattern: /\b(retail|e-commerce|ecommerce)\b/i },
  { id: "energy", label: "energy", pattern: /\b(oil and gas|renewable energy)\b/i },
  { id: "hospitality", label: "hospitality", pattern: /\b(hospitality|hotel chain)\b/i },
  { id: "legal", label: "legal", pattern: /\b(law firm|legal services)\b/i },
  { id: "realestate", label: "real estate", pattern: /\b(real estate|property development)\b/i },
  { id: "manufacturing", label: "manufacturing", pattern: /\b(manufacturing|industrial equipment)\b/i },
  { id: "recruitment", label: "recruitment", pattern: /\b(recruitment agency|staffing agency|executive search)\b/i },
];

function industryHits(text: string): { id: string; label: string }[] {
  const hits: { id: string; label: string }[] = [];
  for (const family of INDUSTRY_FAMILIES) {
    if (family.pattern.test(text)) hits.push({ id: family.id, label: family.label });
  }
  return hits;
}

function industryConflict(spec: ParsedSpec, record: RawCandidate): string | null {
  const specText = [spec.jobTitle, ...spec.mustHave, ...spec.niceToHave].join("\n");
  const wanted = industryHits(specText);
  if (wanted.length === 0) return null;
  const profileText = [
    record.industry,
    record.company,
    ...(record.experience ?? []).flatMap((role) => [role.title, role.company, role.detail]),
    record.haystack,
  ]
    .filter(Boolean)
    .join("\n");
  const found = industryHits(profileText);
  if (found.length === 0) return null;
  if (found.some((hit) => wanted.some((item) => item.id === hit.id))) return null;
  const specLabel = wanted.map((item) => item.label).join(", ");
  const profileLabel = record.industry?.trim() || found.map((item) => item.label).join(", ");
  return `Industry does not match the spec: ${profileLabel} is outside ${specLabel}.`;
}

function notAssessed(key: MatchCriterionKey): MatchCriterion {
  return {
    key,
    label: CRITERION_LABEL[key],
    weight: MATCH_WEIGHTS[key],
    score: 0,
    reason: NOT_ASSESSED,
    assessed: false,
  };
}

function titleKnown(record: RawCandidate): boolean {
  const title = record.title.trim();
  return Boolean(title) && !/^(title not listed|linkedin member|resume)$/i.test(title);
}

function titleScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  if (!titleKnown(record)) return notAssessed("title");
  const wanted = tokens(spec.jobTitle);
  const have = normaliseForMatch(record.title);
  const score = wanted.length === 0 ? 100 : coverage(wanted, have);
  return {
    key: "title",
    label: CRITERION_LABEL.title,
    weight: MATCH_WEIGHTS.title,
    score,
    assessed: true,
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
  const conflict = industryConflict(spec, record);
  if (conflict) {
    return {
      key: "skills",
      label: CRITERION_LABEL.skills,
      weight: MATCH_WEIGHTS.skills,
      score: 0,
      assessed: true,
      reason: conflict,
    };
  }
  const phrases = [...spec.mustHave, ...spec.niceToHave];
  if (phrases.length === 0) {
    return {
      key: "skills",
      label: CRITERION_LABEL.skills,
      weight: MATCH_WEIGHTS.skills,
      score: 100,
      reason: "The spec did not name skills to check.",
      assessed: true,
    };
  }
  if (record.detailOnRecord !== true) return notAssessed("skills");
  const hits = phrases.filter((phrase) => haystackIncludes(record.haystack, phrase)).length;
  const score = Math.round((hits / phrases.length) * 100);
  return {
    key: "skills",
    label: CRITERION_LABEL.skills,
    weight: MATCH_WEIGHTS.skills,
    score,
    assessed: true,
    reason:
      hits === phrases.length
        ? "Every named skill or requirement appears on the public record."
        : `${hits} of ${phrases.length} named skills or requirements appear on the public record.`,
  };
}

function experienceScore(spec: ParsedSpec, record: RawCandidate, now: Date): MatchCriterion {
  const months = datedMonths(record, now);
  if (months <= 0) return notAssessed("experience");
  const yearsNeeded = yearRequirement(spec.mustHave);
  let score = 50;
  let reason = "Dated experience is on the record.";
  if (yearsNeeded) {
    const needed = yearsNeeded * 12;
    score = Math.min(100, Math.round((months / needed) * 100));
    reason = `Dated experience covers ${months} months against ${yearsNeeded} years named in the spec.`;
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
  return { key: "experience", label: CRITERION_LABEL.experience, weight: MATCH_WEIGHTS.experience, score, reason, assessed: true };
}

function locationScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  if (!spec.location.trim()) {
    return {
      key: "location",
      label: CRITERION_LABEL.location,
      weight: MATCH_WEIGHTS.location,
      score: 100,
      reason: "The spec did not name a place.",
      assessed: true,
    };
  }
  if (!record.location.trim()) return notAssessed("location");
  const same =
    haystackIncludes(record.location, spec.location) || haystackIncludes(spec.location, record.location);
  const score = same ? 100 : coverage(tokens(spec.location), normaliseForMatch(record.location));
  return {
    key: "location",
    label: CRITERION_LABEL.location,
    weight: MATCH_WEIGHTS.location,
    score,
    assessed: true,
    reason: score === 100 ? "The location lines up with the spec." : "The location does not line up with the spec.",
  };
}

function seniorityScore(spec: ParsedSpec, record: RawCandidate): MatchCriterion {
  if (!titleKnown(record)) {
    return {
      key: "seniority",
      label: CRITERION_LABEL.seniority,
      weight: MATCH_WEIGHTS.seniority,
      score: 0,
      reason: NOT_ASSESSED,
      assessed: false,
    };
  }
  const gap = Math.abs(seniority(record.title) - seniority(spec.jobTitle));
  const score = gap === 0 ? 100 : gap === 1 ? 75 : gap === 2 ? 45 : 20;
  return {
    key: "seniority",
    label: CRITERION_LABEL.seniority,
    weight: MATCH_WEIGHTS.seniority,
    score,
    assessed: true,
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
      assessed: true,
      reason: "A recent job change is on the public record.",
    };
  }
  const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const fresh = (record.experience ?? []).some((role) => {
    if (role.end || !role.start) return false;
    const start = monthIndex(role.start);
    return start !== null && current - start <= 18;
  });
  if (!fresh && datedMonths(record, now) <= 0) return notAssessed("recency");
  return {
    key: "recency",
    label: CRITERION_LABEL.recency,
    weight: MATCH_WEIGHTS.recency,
    score: fresh ? 80 : 45,
    assessed: true,
    reason: fresh
      ? "The current role started within the last 18 months."
      : "No recent job change was on the public record.",
  };
}

export function unlockEligible(criteria: MatchCriterion[]): boolean {
  const title = criteria.find((item) => item.key === "title");
  const location = criteria.find((item) => item.key === "location");
  const others = criteria.filter((item) => item.assessed && item.key !== "title" && item.key !== "location");
  return Boolean(title?.assessed && location?.assessed && others.length >= 1);
}

export function scoreMatch(
  record: RawCandidate,
  spec: ParsedSpec,
  validation: ValidationStatus,
  now = new Date(),
): { score: number; criteria: MatchCriterion[]; unlockBlocked: boolean; blockedReason: string | null; eligible: boolean } {
  const criteria = [
    titleScore(spec, record),
    skillsScore(spec, record),
    experienceScore(spec, record, now),
    locationScore(spec, record),
    seniorityScore(spec, record),
    recencyScore(record, now),
  ];
  const assessed = criteria.filter((item) => item.assessed);
  const weightSum = assessed.reduce((total, item) => total + item.weight, 0);
  const raw = weightSum === 0 ? 0 : Math.round(assessed.reduce((total, item) => total + item.score * item.weight, 0) / weightSum);
  if (validation === "risk") {
    return {
      score: Math.min(raw, HIGH_RISK_SCORE_CAP),
      criteria,
      unlockBlocked: true,
      blockedReason: "High risk blocks identity unlock. The match is capped below the gate.",
      eligible: false,
    };
  }
  return {
    score: Math.max(0, Math.min(100, raw)),
    criteria,
    unlockBlocked: false,
    blockedReason: null,
    eligible: unlockEligible(criteria),
  };
}

export function clampThreshold(value: unknown, fallback = 80): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}
