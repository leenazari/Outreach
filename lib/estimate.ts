import { MAX_ENRICH } from "./actors";

export const PROFILE_PAGE_USD = 0.1;
export const ENRICH_PROFILE_USD = 0.004;
export const POST_USD = 0.002;
export const EMAIL_PROFILE_USD = 0.01;
export const INDEED_ESTIMATE_USD = 0.16;
export const DEFAULT_ENRICH_TOP_N = 10;
export const AI_MATCH_ESTIMATE_USD = 0.01;
export const TOP_POSTS = 5;

export type CostEstimateLine = {
  label: string;
  usd: number;
};

export function estimateSearchCost(input: {
  openToWork: boolean;
  includeIndeed: boolean;
  includeEmail: boolean;
  watchPhrases: boolean;
  enrichTopN?: number;
}): { totalUsd: number; lines: CostEstimateLine[] } {
  const enrichCount = input.enrichTopN ?? MAX_ENRICH;
  const posts = input.openToWork || input.watchPhrases;
  const lines: CostEstimateLine[] = [
    { label: "LinkedIn profile page", usd: PROFILE_PAGE_USD },
    { label: `${enrichCount} full profiles`, usd: roundUsd(enrichCount * ENRICH_PROFILE_USD) },
    { label: "AI match, up to", usd: AI_MATCH_ESTIMATE_USD },
  ];
  if (posts) {
    lines.push({ label: `${TOP_POSTS} posts for the top matches`, usd: roundUsd(TOP_POSTS * POST_USD) });
  }
  if (input.includeEmail) {
    lines.push({ label: `${enrichCount} email lookups`, usd: roundUsd(enrichCount * EMAIL_PROFILE_USD) });
  }
  if (input.includeIndeed) {
    lines.push({ label: "Indeed resumes, up to", usd: INDEED_ESTIMATE_USD });
  }
  const totalUsd = roundUsd(lines.reduce((sum, line) => sum + line.usd, 0));
  return { totalUsd, lines };
}

function roundUsd(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function formatEstimate(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
