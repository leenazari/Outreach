import type { Candidate, SearchSpend } from "./types";

export const EXPORT_RECORD_KEY = "latest-candidate-export";

export type InterviewaExportCandidate = {
  source: string;
  score: number;
  subScores: { criterion: string; weight: number; score: number; reason: string }[];
  validationStatus: string;
  name: string | null;
  profileUrl: string | null;
  email: string | null;
  summary: string;
  costAttributedUsd: number;
  sourceUrl: string | null;
  title: string;
  company: string;
  locationRegion: string;
  skills: string[];
  companyType: string;
};

export type InterviewaExport = {
  product: "Interviewa candidate finder";
  generatedAt: string;
  searchId: string | null;
  jobTitle: string;
  location: string;
  candidates: InterviewaExportCandidate[];
};

const CSV_COLUMNS = [
  "source",
  "score",
  "subScores",
  "validationStatus",
  "name",
  "profileUrl",
  "email",
  "summary",
  "costAttributedUsd",
  "sourceUrl",
  "title",
  "company",
  "locationRegion",
  "skills",
  "companyType",
] as const;

export function toExportRows(candidates: Candidate[], spend: SearchSpend): InterviewaExportCandidate[] {
  return candidates.map((candidate) => {
      const cost = spend.candidates.find((row) => row.candidateId === candidate.id);
      return {
        source: candidate.sources.join(","),
        score: candidate.score,
        subScores: candidate.subscores.map((item) => ({
          criterion: item.key,
          weight: item.weight,
          score: item.score,
          reason: item.reason,
        })),
        validationStatus: candidate.validation.status,
        name: candidate.name,
        profileUrl: candidate.profileUrl,
        email: candidate.email,
        summary: candidate.snippet,
        costAttributedUsd: cost?.totalUsd ?? 0,
        sourceUrl: candidate.sourceUrl,
        title: candidate.title,
        company: candidate.company,
        locationRegion: candidate.locationRegion,
        skills: candidate.skills,
        companyType: candidate.companyType,
      };
    });
}

export function buildExport(input: {
  candidates: Candidate[];
  spend: SearchSpend;
  searchId: string | null;
  jobTitle: string;
  location: string;
  generatedAt?: string;
}): InterviewaExport {
  return {
    product: "Interviewa candidate finder",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    searchId: input.searchId,
    jobTitle: input.jobTitle,
    location: input.location,
    candidates: toExportRows(input.candidates, input.spend),
  };
}

function csvCell(value: unknown): string {
  const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : value == null ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

export function exportToCsv(payload: InterviewaExport): string {
  const header = CSV_COLUMNS.join(",");
  const lines = payload.candidates.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
  return [header, ...lines].join("\n");
}

export async function postInterviewaWebhook(payload: InterviewaExport): Promise<void> {
  const url = process.env.INTERVIEWA_WEBHOOK_URL?.trim() ?? "";
  if (!url) return;
  const secret = process.env.INTERVIEWA_WEBHOOK_SECRET?.trim() ?? "";
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Interviewa-Webhook-Secret": secret,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
}
