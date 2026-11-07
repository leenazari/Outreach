import type { MatchCriterion } from "./types";

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

export function weightedPoints(criterion: MatchCriterion): number {
  return Math.round((criterion.score * criterion.weight) / 100);
}
