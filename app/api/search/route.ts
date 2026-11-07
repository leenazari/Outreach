import { NextResponse } from "next/server";
import { parseSearchRequest } from "@/lib/parse";
import { searchCandidates } from "@/lib/search";

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

  const parsed = parseSearchRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await searchCandidates(parsed.spec, {
      token: process.env.APIFY_TOKEN,
    });
    return NextResponse.json(result);
  } catch {
    console.error("candidate search failed");
    return NextResponse.json({ error: "The search could not be completed." }, { status: 500 });
  }
}
