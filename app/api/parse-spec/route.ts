import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { saveParseSpend } from "@/lib/apify";
import { extractSpec } from "@/lib/extract-spec";

export const maxDuration = 30;

export async function POST(request: Request) {
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "The request body could not be read." }, { status: 400 });
  }

  if (raw.length > 8_000) {
    return NextResponse.json({ error: "That recording is too long to parse." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const transcript =
    body && typeof body === "object" && "transcript" in body && typeof body.transcript === "string"
      ? body.transcript.trim()
      : "";
  if (!transcript) {
    return NextResponse.json({ error: "Say a job spec before filling the form." }, { status: 400 });
  }
  if (transcript.length > 4_000) {
    return NextResponse.json({ error: "That recording is too long to parse." }, { status: 400 });
  }

  const extracted = await extractSpec(transcript);
  const token = process.env.APIFY_TOKEN?.trim() ?? "";
  if (token && extracted.usage && extracted.usage.usd > 0) {
    try {
      await saveParseSpend(token, {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        model: extracted.usage.model,
        inputTokens: extracted.usage.inputTokens,
        outputTokens: extracted.usage.outputTokens,
        usd: extracted.usage.usd,
        jobTitle: extracted.fields.jobTitle,
      });
    } catch {
      // The form can still fill when the spend record cannot be stored.
    }
  }
  return NextResponse.json(extracted.fields);
}
