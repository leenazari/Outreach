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

export function weightedPoints(criterion: MatchCriterion): number {
  return Math.round((criterion.score * criterion.weight) / 100);
}
