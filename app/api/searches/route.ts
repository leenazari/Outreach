import { NextResponse } from "next/server";
import { listSearchGroups } from "@/lib/apify";
import { recentSearches } from "@/lib/recent-searches";

export async function GET() {
  const token = process.env.APIFY_TOKEN?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ searches: [], error: "APIFY_TOKEN is not set." }, { status: 503 });
  }
  try {
    const searches = recentSearches(await listSearchGroups(token), 5);
    return NextResponse.json({ searches });
  } catch {
    return NextResponse.json({ searches: [], error: "Recent searches could not be read." }, { status: 502 });
  }
}
