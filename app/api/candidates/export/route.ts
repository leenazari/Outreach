import { NextResponse } from "next/server";
import { getStoreRecord } from "@/lib/apify";
import { EXPORT_RECORD_KEY, exportToCsv, type InterviewaExport } from "@/lib/interviewa";

export const maxDuration = 30;

function isExport(value: unknown): value is InterviewaExport {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as { candidates?: unknown }).candidates);
}

export async function GET(request: Request) {
  const token = process.env.APIFY_TOKEN?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "APIFY_TOKEN is not set, so there is no unlocked export to read." }, { status: 503 });
  }
  const stored = await getStoreRecord(token, EXPORT_RECORD_KEY);
  const payload: InterviewaExport = isExport(stored)
    ? stored
    : {
        product: "Interviewa candidate finder",
        generatedAt: new Date().toISOString(),
        searchId: null,
        jobTitle: "",
        location: "",
        unlockThreshold: 80,
        candidates: [],
      };
  const format = new URL(request.url).searchParams.get("format");
  if (format === "csv") {
    return new NextResponse(exportToCsv(payload), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"interviewa-unlocked-candidates.csv\"",
      },
    });
  }
  return NextResponse.json(payload);
}
