"use client";

import { useEffect, useState } from "react";
import type { RecentSearch } from "@/lib/recent-searches";
import type { SearchRequest } from "@/lib/types";

function when(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function RecentSearches({ disabled, onLoad }: { disabled: boolean; onLoad: (request: SearchRequest) => void }) {
  const [searches, setSearches] = useState<RecentSearch[]>([]);

  useEffect(() => {
    void fetch("/api/searches")
      .then(async (response) => {
        if (!response.ok) return { searches: [] as RecentSearch[] };
        return (await response.json()) as { searches?: RecentSearch[] };
      })
      .then((payload) => setSearches(Array.isArray(payload.searches) ? payload.searches.slice(0, 5) : []))
      .catch(() => setSearches([]));
  }, []);

  if (searches.length === 0) return null;

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Recent searches</p>
      <ul className="grid gap-1">
        {searches.map((search) => (
          <li key={search.searchId}>
            <button
              type="button"
              disabled={disabled || !search.request}
              onClick={() => {
                if (search.request) onLoad(search.request);
              }}
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-left text-sm leading-5 disabled:opacity-50"
            >
              <span className="font-medium">{search.jobTitle || "Untitled search"}</span>
              {search.location ? <span className="text-muted-foreground"> · {search.location}</span> : null}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {when(search.startedAt)}
                {search.request ? "" : " · spec was not stored"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
