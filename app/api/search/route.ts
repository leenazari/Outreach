import { NextResponse } from "next/server";
import { parsePhraseList, parseSearchRequest } from "@/lib/parse";
import { extractTitle, parseSpokenSpecRules } from "@/lib/parse-speech";
import { MissingApifyTokenError, searchCandidates } from "@/lib/search";
import { readStoredRequest } from "@/lib/saved-spec";
import type { ParsedSpec } from "@/lib/types";
import { pickCurrency, pickParsedField } from "@/lib/form-fill";
import { asString } from "@/lib/text";

export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    tokenConfigured: Boolean(process.env.APIFY_TOKEN?.trim()),
  });
}

export async function POST(request: Request) {
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "The request body could not be read." }, { status: 400 });
  }

  if (raw.length > 20_000) {
    return NextResponse.json({ error: "The job spec is too large." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const specText = record ? asString(record.specText) : "";
  const includeIndeed = record ? record.includeIndeed === true : false;
  const includeEmail = record ? record.includeEmail === true : false;

  let spec: ParsedSpec;
  if (specText) {
    const spoken = parseSpokenSpecRules(specText);
    const edited = (key: string) => (record ? asString(record[key]) : "");
    const locked = new Set(
      Array.isArray(record?.lockedFields) ? record.lockedFields.filter((item): item is string => typeof item === "string") : [],
    );
    const pick = (key: string, parsed: string) => pickParsedField(edited(key), parsed, locked.has(key));
    spec = {
      jobTitle: pick("jobTitle", spoken.jobTitle || extractTitle(specText)),
      location: pick("location", spoken.location),
      salaryMin: pick("salaryMin", spoken.salaryMin),
      salaryMax: pick("salaryMax", spoken.salaryMax),
      salaryCurrency: pickCurrency(edited("salaryCurrency"), spoken.salaryCurrency, locked.has("salaryCurrency")),
      mustHave: parsePhraseList(pick("mustHave", spoken.mustHave)),
      niceToHave: parsePhraseList(pick("niceToHave", spoken.niceToHave)),
      seniority: pick("seniority", spoken.seniority),
      yearsExperience: pick("yearsExperience", spoken.yearsExperience),
      industry: pick("industry", spoken.industry),
      workplace: pick("workplace", spoken.workplace),
      searchTitle: pick("searchTitle", ""),
      watchPhrases: parsePhraseList(record ? asString(record.watchPhrases) : "", 3),
      specText,
      useSampleData: false,
      includeIndeed,
      recentlyChangedJobs: record?.recentlyChangedJobs === true,
      openToWork: record?.openToWork !== false,
    };
  } else {
    const parsed = parseSearchRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    spec = {
      ...parsed.spec,
      useSampleData: false,
      includeIndeed,
      recentlyChangedJobs: record?.recentlyChangedJobs === true,
      openToWork: record?.openToWork !== false,
    };
  }

  try {
    const result = await searchCandidates(spec, {
      token: process.env.APIFY_TOKEN,
      includeEmail,
      aiMatch: true,
      storedRequest: readStoredRequest(body),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message : "The search could not be completed.";
    const status = error instanceof MissingApifyTokenError ? 503 : 500;
    console.error("candidate search failed");
    return NextResponse.json({ error: publicError(message) }, { status });
  }
}

function publicError(message: string): string {
  const token = process.env.APIFY_TOKEN?.trim() ?? "";
  const openai = process.env.OPENAI_API_KEY?.trim() ?? "";
  let safe = message.replace(/\s+/g, " ").trim().slice(0, 500);
  if (token) safe = safe.split(token).join("[redacted]");
  if (openai) safe = safe.split(openai).join("[redacted]");
  return safe;
}
