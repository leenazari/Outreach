import { NextResponse } from "next/server";
import { parsePhraseList, parseSearchRequest } from "@/lib/parse";
import { interpretTranscript } from "@/lib/parse-speech";
import { clampThreshold } from "@/lib/match";
import { MissingApifyTokenError, searchCandidates } from "@/lib/search";
import type { ParsedSpec } from "@/lib/types";
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
  const includeIndeed = record ? record.includeIndeed !== false : true;
  const includeEmail = record ? record.includeEmail === true : false;
  const unlockThreshold = clampThreshold(record?.unlockThreshold ?? process.env.UNLOCK_THRESHOLD, 80);

  let spec: ParsedSpec;
  if (specText) {
    let spoken;
    try {
      spoken = await interpretTranscript(specText, process.env.OPENAI_API_KEY);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The job spec could not be parsed.";
      return NextResponse.json({ error: publicError(message) }, { status: 502 });
    }
    if (!spoken.jobTitle) {
      return NextResponse.json(
        { error: "No job title found in that spec. Name the role, for example “Sales Executive in London”." },
        { status: 400 },
      );
    }
    if (!spoken.location) {
      return NextResponse.json(
        { error: "No location found in that spec. Include a city or country." },
        { status: 400 },
      );
    }
    spec = {
      jobTitle: spoken.jobTitle,
      location: spoken.location,
      salaryMin: spoken.salaryMin,
      salaryMax: spoken.salaryMax,
      salaryCurrency: spoken.salaryCurrency || "GBP",
      mustHave: parsePhraseList(spoken.mustHave),
      niceToHave: parsePhraseList(spoken.niceToHave),
      watchPhrases: parsePhraseList(record ? asString(record.watchPhrases) : "", 3),
      useSampleData: false,
      includeIndeed,
    };
  } else {
    const parsed = parseSearchRequest(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    spec = { ...parsed.spec, useSampleData: false, includeIndeed };
  }

  try {
    const result = await searchCandidates(spec, {
      token: process.env.APIFY_TOKEN,
      unlockThreshold,
      includeEmail,
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
