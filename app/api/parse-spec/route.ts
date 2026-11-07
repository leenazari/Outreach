import { NextResponse } from "next/server";
import { interpretTranscript } from "@/lib/parse-speech";

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

  const parsed = await interpretTranscript(transcript, process.env.OPENAI_API_KEY);
  return NextResponse.json(parsed);
}
