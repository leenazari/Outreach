import type { SearchGroupRecord } from "./apify";
import { readStoredRequest } from "./saved-spec";
import type { SearchRequest } from "./types";

export type RecentSearch = {
  searchId: string;
  startedAt: string;
  jobTitle: string;
  location: string;
  request: SearchRequest | null;
};

export function recentSearches(groups: SearchGroupRecord[], limit = 5): RecentSearch[] {
  return [...groups]
    .filter((group) => group.searchId)
    .sort((left, right) => (right.startedAt || "").localeCompare(left.startedAt || ""))
    .slice(0, Math.max(0, limit))
    .map((group) => ({
      searchId: group.searchId,
      startedAt: group.startedAt,
      jobTitle: group.jobTitle,
      location: group.location,
      request: group.request ?? null,
    }));
}

export function requestFromGroup(group: SearchGroupRecord | null): SearchRequest | null {
  return group?.request ? readStoredRequest(group.request) : null;
}
