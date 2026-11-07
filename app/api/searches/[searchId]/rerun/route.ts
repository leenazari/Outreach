import { NextResponse } from "next/server";
import { getStoreRecord } from "@/lib/apify";
import { POST as postSearch } from "@/app/api/search/route";
import { readStoredRequest } from "@/lib/saved-spec";
import { asRecord, asString } from "@/lib/text";

export const maxDuration = 300;

function validSearchId(searchId: string): boolean {
  return /^[0-9a-f-]{8,80}$/i.test(searchId);
}

export async function POST(_request: Request, context: { params: Promise<{ searchId: string }> }) {
  const { searchId } = await context.params;
  if (!validSearchId(searchId)) {
    return NextResponse.json({ error: "That search id is not valid." }, { status: 400 });
  }
  const token = process.env.APIFY_TOKEN?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "APIFY_TOKEN is not set, so a live search cannot run." }, { status: 503 });
  }
  const stored = asRecord(await getStoreRecord(token, `search-${searchId}`));
  const request = readStoredRequest(stored?.request);
  if (!request) {
    return NextResponse.json(
      {
        error: "This search was stored before the spec was kept, so it cannot be rerun from the id alone.",
        searchId,
        jobTitle: asString(stored?.jobTitle),
        location: asString(stored?.location),
      },
      { status: 409 },
    );
  }
  return postSearch(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}
