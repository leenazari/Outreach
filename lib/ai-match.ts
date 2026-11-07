import { generateText, Output } from "ai";
import { z } from "zod";
import { candidateKey } from "./rank";
import type { Candidate, LlmSpend, ParsedSpec, RawCandidate } from "./types";

export const MATCH_MODEL = "google/gemini-2.5-flash-lite";
export const MATCH_CONCURRENCY = 5;

const INPUT_USD: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash-lite": { input: 0.0000001, output: 0.0000004 },
};

export const aiMatchSchema = z.object({
  relevantExperienceYears: z.number(),
  roleRelevance: z.number(),
  industrySimilarity: z.number(),
  seniorityFit: z.number(),
  skillsMatch: z.number(),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  locationFit: z.number(),
  overall: z.number(),
  reason: z.string(),
});

export type AiMatch = z.infer<typeof aiMatchSchema>;

export type JudgeResult = {
  match: AiMatch;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
};

export type CandidateJudge = (input: { specText: string; profile: string }) => Promise<JudgeResult>;

export function matchModelId(): string {
  return process.env.AI_GATEWAY_MODEL?.trim() || MATCH_MODEL;
}

export function aiGatewayConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim());
}

export function tokenCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = INPUT_USD[model] ?? { input: 0.00000025, output: 0.000002 };
  return Math.round((inputTokens * price.input + outputTokens * price.output) * 1_000_000) / 1_000_000;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function normaliseAiMatch(match: AiMatch): AiMatch {
  return {
    relevantExperienceYears: Math.max(0, Math.round(match.relevantExperienceYears * 10) / 10),
    roleRelevance: clampScore(match.roleRelevance),
    industrySimilarity: clampScore(match.industrySimilarity),
    seniorityFit: clampScore(match.seniorityFit),
    skillsMatch: clampScore(match.skillsMatch),
    matchedSkills: match.matchedSkills.map((item) => item.trim()).filter(Boolean).slice(0, 8),
    missingSkills: match.missingSkills.map((item) => item.trim()).filter(Boolean).slice(0, 8),
    locationFit: clampScore(match.locationFit),
    overall: clampScore(match.overall),
    reason: match.reason.replace(/\s+/g, " ").trim().slice(0, 180),
  };
}

export function specForModel(spec: ParsedSpec): string {
  const text = spec.specText?.trim();
  if (text) return text.slice(0, 4000);
  return [
    spec.jobTitle,
    spec.location && `Location: ${spec.location}`,
    spec.workplace && `Workplace: ${spec.workplace}`,
    spec.seniority && `Seniority: ${spec.seniority}`,
    spec.yearsExperience && `Years: ${spec.yearsExperience}`,
    spec.industry && `Industry: ${spec.industry}`,
    spec.mustHave.length ? `Must-haves: ${spec.mustHave.join("; ")}` : "",
    spec.niceToHave.length ? `Nice-to-haves: ${spec.niceToHave.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

export function profileForModel(record: RawCandidate): string {
  const roles = (record.experience ?? []).slice(0, 12).map((role) => {
    const when = `${role.start ?? "unknown"} to ${role.end ?? "present"}`;
    const industry = role.industry ? ` (${role.industry})` : "";
    return `${role.title} at ${role.company}${industry}, ${when}, ${role.location}. ${role.detail}`.trim();
  });
  return [
    `Name: ${record.name}`,
    `Headline: ${record.headline ?? ""}`,
    `Current title: ${record.title}`,
    `Company: ${record.company ?? ""}`,
    `Company industry: ${record.industry ?? ""}`,
    `Location: ${record.location}`,
    `About: ${record.about ?? ""}`,
    `Skills: ${(record.skills ?? []).join(", ")}`,
    roles.length ? `Experience:\n${roles.join("\n")}` : "Experience: not listed",
  ]
    .join("\n")
    .slice(0, 6000);
}

function gatewayUsd(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const gateway = (metadata as { gateway?: Record<string, unknown> }).gateway;
  if (!gateway) return null;
  for (const key of ["cost", "marketCost", "totalCost"]) {
    const value = gateway[key];
    if (typeof value === "number" && value >= 0) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function createGatewayJudge(model = matchModelId()): CandidateJudge {
  return async ({ specText, profile }) => {
    const result = await generateText({
      model,
      maxOutputTokens: 400,
      output: Output.object({
        schema: aiMatchSchema,
        name: "candidate_match",
        description: "How well this person's actual work matches the job spec.",
      }),
      system: [
        "You score one candidate against a job spec for a recruiter.",
        "Judge the work they actually did: products sold, customers, industry, and skills used in the role descriptions.",
        "Do not give credit for a matching job title when the employers, customers, or work are different.",
        "relevantExperienceYears counts only work that is relevant to this spec.",
        "Scores are integers from 0 to 100.",
        "reason is one plain-English line, under 140 characters, with no name and no score.",
        "matchedSkills and missingSkills use the spec's requirements, not every skill on the profile.",
      ].join(" "),
      prompt: `Job spec:\n${specText}\n\nCandidate:\n${profile}`,
    });
    const match = normaliseAiMatch(result.output);
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    return {
      match,
      inputTokens,
      outputTokens,
      usd: gatewayUsd(result.providerMetadata) ?? tokenCostUsd(model, inputTokens, outputTokens),
    };
  };
}

async function mapPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function scoreCandidatesWithAi(
  candidates: Candidate[],
  records: RawCandidate[],
  spec: ParsedSpec,
  options: { judge: CandidateJudge; concurrency?: number },
): Promise<LlmSpend> {
  const byId = new Map(records.map((record) => [candidateKey(record), record]));
  const specText = specForModel(spec);
  const model = matchModelId();
  let calls = 0;
  let failed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let usd = 0;

  await mapPool(candidates, options.concurrency ?? MATCH_CONCURRENCY, async (candidate) => {
    const record = byId.get(candidate.id);
    if (!record) {
      failed += 1;
      candidate.scoreSource = "heuristic";
      candidate.matchReason = "Heuristic score (AI match failed)";
      return;
    }
    calls += 1;
    try {
      const judged = await options.judge({ specText, profile: profileForModel(record) });
      const match = normaliseAiMatch(judged.match);
      inputTokens += judged.inputTokens;
      outputTokens += judged.outputTokens;
      usd += judged.usd ?? tokenCostUsd(model, judged.inputTokens, judged.outputTokens);
      candidate.score = match.overall;
      candidate.scoreSource = "ai";
      candidate.matchReason = match.reason;
      candidate.matchedSkills = match.matchedSkills;
      candidate.missingSkills = match.missingSkills;
      candidate.aiScores = {
        relevantExperienceYears: match.relevantExperienceYears,
        roleRelevance: match.roleRelevance,
        industrySimilarity: match.industrySimilarity,
        seniorityFit: match.seniorityFit,
        skillsMatch: match.skillsMatch,
        locationFit: match.locationFit,
      };
    } catch {
      failed += 1;
      candidate.scoreSource = "heuristic";
      candidate.matchReason = "Heuristic score (AI match failed)";
    }
  });

  candidates.sort((left, right) => {
    const location = Number(left.locationStatus === "unknown") - Number(right.locationStatus === "unknown");
    if (location !== 0) return location;
    if (right.score !== left.score) return right.score - left.score;
    return (left.name ?? "").localeCompare(right.name ?? "");
  });

  return {
    model,
    calls,
    failed,
    inputTokens,
    outputTokens,
    usd: Math.round(usd * 1_000_000) / 1_000_000,
  };
}
