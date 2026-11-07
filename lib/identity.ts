import type { Candidate, MatchCriterion } from "./types";
import { stripContactDetails } from "./text";

export const INDEED_IDENTITY_NOTE =
  "Identity is only available inside Indeed. This card has no name or contact details from the actor.";

export function locationRegion(location: string): string {
  const parts = location
    .split(/[·,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "Region not listed";
  const country = parts.find((part) =>
    /united kingdom|united states|ireland|england|scotland|wales|germany|france|netherlands|canada|australia/i.test(part),
  );
  return country ?? parts[0] ?? "Region not listed";
}

export function companyType(title: string): string {
  const text = title.toLowerCase();
  if (/sales|account executive|business development/.test(text)) return "Sales";
  if (/engineer|developer|software|data/.test(text)) return "Software";
  if (/design/.test(text)) return "Design";
  if (/nurse|clinical|health|doctor/.test(text)) return "Healthcare";
  if (/market/.test(text)) return "Marketing";
  if (/product/.test(text)) return "Product";
  return "General";
}

function indeedOnly(candidate: Candidate): boolean {
  return candidate.sources.length > 0 && candidate.sources.every((source) => source === "indeed-resume");
}

function anonymousSummary(candidate: Candidate): string {
  const years = candidate.experienceSummary || "Experience length was not dated on the public record.";
  return stripContactDetails(years);
}

export function presentCandidate(candidate: Candidate): Candidate {
  const region = locationRegion(candidate.location);
  const sector = companyType(candidate.title);
  if (!candidate.unlocked) {
    return {
      ...candidate,
      name: null,
      profileUrl: null,
      email: null,
      photoUrl: null,
      sourceUrl: null,
      snippet: anonymousSummary(candidate),
      location: region,
      locationRegion: region,
      companyType: sector,
      identityNote: candidate.unlockBlocked
        ? candidate.blockedReason
        : "Below the unlock threshold. Name, profile link, photo, and contact details are not included.",
      validation: {
        ...candidate.validation,
        reasons: candidate.validation.reasons.map((reason) => ({
          summary: reason.summary,
          evidence: "The supporting detail is withheld below the unlock threshold.",
        })),
      },
    };
  }

  if (indeedOnly(candidate)) {
    return {
      ...candidate,
      name: null,
      profileUrl: null,
      email: null,
      photoUrl: null,
      sourceUrl: candidate.sourceUrl,
      locationRegion: region,
      companyType: sector,
      identityNote: INDEED_IDENTITY_NOTE,
    };
  }

  return {
    ...candidate,
    locationRegion: region,
    companyType: sector,
    identityNote: null,
  };
}

export function weightedPoints(criterion: MatchCriterion): number {
  return Math.round((criterion.score * criterion.weight) / 100);
}
