import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SearchGroupRecord } from "./apify";
import { recentSearches } from "./recent-searches";
import type { SearchRequest } from "./types";

const request: SearchRequest = {
  specText: "Marketing executive in London",
  jobTitle: "marketing executive",
  location: "London",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: "",
  niceToHave: "",
  seniority: "",
  yearsExperience: "",
  industry: "",
  workplace: "",
  watchPhrases: "",
  useSampleData: false,
  includeIndeed: false,
  includeEmail: false,
  recentlyChangedJobs: false,
  openToWork: true,
};

function group(searchId: string, startedAt: string, stored: SearchRequest | null = request): SearchGroupRecord {
  return { searchId, startedAt, jobTitle: stored?.jobTitle ?? "Old", location: stored?.location ?? "London", runIds: ["run"], request: stored };
}

describe("recent searches", () => {
  it("keeps the five newest and their stored spec", () => {
    const listed = recentSearches(
      [
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1", "2026-11-01T00:00:00.000Z"),
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2", "2026-11-07T00:00:00.000Z"),
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3", "2026-11-03T00:00:00.000Z", null),
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4", "2026-11-06T00:00:00.000Z"),
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5", "2026-11-05T00:00:00.000Z"),
        group("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6", "2026-11-04T00:00:00.000Z"),
      ],
      5,
    );
    assert.deepEqual(
      listed.map((item) => item.searchId.slice(-1)),
      ["2", "4", "5", "6", "3"],
    );
    assert.equal(listed[0]?.request?.specText, "Marketing executive in London");
    assert.equal(listed[4]?.request, null);
  });
});
