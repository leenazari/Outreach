import { gateway, generateText, Output } from "ai";
import { z } from "zod";
import { MATCH_MODEL, matchModelId, tokenCostUsd } from "./ai-match";
import { parseSpokenSpecRules } from "./parse-speech";

export const specExtractionSchema = z.object({
  jobTitle: z.string(),
  seniority: z.string(),
  location: z.string(),
  workMode: z.string(),
  officeDays: z.string(),
  salaryMin: z.string(),
  salaryMax: z.string(),
  salaryCurrency: z.string(),
  yearsExperience: z.string(),
  mustHaves: z.array(z.string()),
  niceToHaves: z.array(z.string()),
  industry: z.string(),
  keySkills: z.array(z.string()),
  searchTitle: z.string(),
});

export type SpecExtraction = z.infer<typeof specExtractionSchema>;

export type ExtractedSpecFields = {
  jobTitle: string;
  seniority: string;
  location: string;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  yearsExperience: string;
  mustHave: string;
  niceToHave: string;
  industry: string;
  workplace: string;
  searchTitle: string;
  parser: "gateway" | "rules";
};

export type SpecUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export type SpecExtractor = (input: { transcript: string }) => Promise<{
  output: SpecExtraction;
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
}>;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function digits(value: string): string {
  const match = value.match(/\d{1,2}/);
  return match?.[0] ?? "";
}

function money(value: string): string {
  const digitsOnly = value.replace(/[^\d]/g, "");
  return digitsOnly ? String(Number(digitsOnly)) : "";
}

function uniquePhrases(values: string[]): string[] {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const value of values) {
    const phrase = clean(value);
    if (phrase.length < 2) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(phrase);
  }
  return phrases;
}

export function formatWorkMode(workMode: string, officeDays: string): string {
  const mode = clean(workMode);
  const days = clean(officeDays).replace(/\s*days?(?:\s+in\s+office)?$/i, "");
  const label = /\bhybrid\b/i.test(mode)
    ? "Hybrid"
    : /\bremote\b/i.test(mode)
      ? "Remote"
      : /\b(onsite|on-site|office)\b/i.test(mode)
        ? "Office"
        : mode;
  if (label && days && /\d/.test(days)) return `${label}, ${days} days in office`;
  return label;
}

export function fieldsFromExtraction(extracted: SpecExtraction): Omit<ExtractedSpecFields, "parser"> {
  const must = uniquePhrases(extracted.mustHaves);
  const nice = uniquePhrases(extracted.niceToHaves);
  const skills = uniquePhrases(extracted.keySkills).filter(
    (skill) => !must.some((item) => item.toLowerCase() === skill.toLowerCase()) && !nice.some((item) => item.toLowerCase() === skill.toLowerCase()),
  );
  const currency = clean(extracted.salaryCurrency).toUpperCase();
  return {
    jobTitle: clean(extracted.jobTitle),
    seniority: clean(extracted.seniority).toLowerCase(),
    location: clean(extracted.location),
    salaryMin: money(extracted.salaryMin),
    salaryMax: money(extracted.salaryMax),
    salaryCurrency: currency === "GBP" || currency === "EUR" || currency === "USD" ? currency : "",
    yearsExperience: digits(extracted.yearsExperience),
    mustHave: [...must, ...skills].join("\n"),
    niceToHave: nice.join("\n"),
    industry: clean(extracted.industry),
    workplace: formatWorkMode(extracted.workMode, extracted.officeDays),
    searchTitle: clean(extracted.searchTitle).slice(0, 80),
  };
}

function fromRules(transcript: string): ExtractedSpecFields {
  const rules = parseSpokenSpecRules(transcript);
  return {
    jobTitle: rules.jobTitle,
    seniority: rules.seniority,
    location: rules.location,
    salaryMin: rules.salaryMin,
    salaryMax: rules.salaryMax,
    salaryCurrency: rules.salaryCurrency,
    yearsExperience: rules.yearsExperience,
    mustHave: rules.mustHave,
    niceToHave: rules.niceToHave,
    industry: rules.industry,
    workplace: rules.workplace,
    searchTitle: rules.jobTitle,
    parser: "rules",
  };
}

function gatewayCost(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = (metadata as { gateway?: Record<string, unknown> }).gateway;
  if (!record) return null;
  for (const key of ["cost", "marketCost", "totalCost"]) {
    const value = record[key];
    if (typeof value === "number" && value >= 0) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function createGatewayExtractor(model = matchModelId()): SpecExtractor {
  return async ({ transcript }) => {
    const result = await generateText({
      model: gateway(model),
      maxOutputTokens: 500,
      output: Output.object({
        schema: specExtractionSchema,
        name: "job_spec",
        description: "Fields read from a spoken or written job spec.",
      }),
      system: [
        "Read a recruiter's job spec. It may be typed or spoken, with filler such as um, uh, I'm looking for, and repeated phrases.",
        "Ignore filler. Infer what they mean. Do not copy the ramble into the fields.",
        "jobTitle is a clean role, such as Marketing Executive, without I'm looking for.",
        "seniority is junior, senior, lead, principal, head, director, or empty.",
        "location is a city or region, not a country by itself unless that is all they said.",
        "workMode is onsite, hybrid, or remote. officeDays is the number of days in the office when they said one, otherwise empty.",
        "yearsExperience is the minimum years they asked for, as digits only.",
        "mustHaves are short concrete requirements inferred from need, must, essential, has to have, or anything core to doing the role.",
        "niceToHaves are inferred from ideally, bonus, a plus, or would be nice.",
        "keySkills are tools or skills named in the spec.",
        "searchTitle is a short LinkedIn query, at most six words, from the role and at most two core skills. No location and no filler.",
        "salaryMin and salaryMax are annual numbers as digits. salaryCurrency is GBP, EUR, or USD.",
        "Use empty strings or empty arrays when something was not said. Do not invent requirements.",
      ].join(" "),
      prompt: transcript,
    });
    return {
      output: result.output,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      usd: gatewayCost(result.providerMetadata),
    };
  };
}

export async function extractSpec(
  transcript: string,
  options?: { extract?: SpecExtractor; model?: string },
): Promise<{ fields: ExtractedSpecFields; usage: SpecUsage | null }> {
  const model = options?.model ?? matchModelId();
  const extract = options?.extract ?? createGatewayExtractor(model);
  try {
    const result = await extract({ transcript });
    const usd = result.usd ?? tokenCostUsd(model, result.inputTokens, result.outputTokens);
    return {
      fields: { ...fieldsFromExtraction(result.output), parser: "gateway" },
      usage: { model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usd },
    };
  } catch {
    return { fields: fromRules(transcript), usage: null };
  }
}

export { MATCH_MODEL };
