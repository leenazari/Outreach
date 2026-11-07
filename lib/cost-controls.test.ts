import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildActorPlans, buildPostsForProfiles, MAX_ENRICH, PROFILE_ACTOR, POST_ACTOR, ENRICH_ACTOR } from "./actors";
import type { ActorRunner } from "./apify";
import { preFilterCandidates } from "./enrich";
import { createMemoryCache, PROFILE_CACHE_MS, SEARCH_CACHE_MS } from "./profile-cache";
import { searchCandidates } from "./search";
import { titleClearlyUnrelated } from "./title-filter";
import type { ParsedSpec, RawCandidate } from "./types";

const spec: ParsedSpec = {
  jobTitle: "Marketing Executive",
  location: "London",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: ["CRM"],
  niceToHave: [],
  watchPhrases: [],
  useSampleData: false,
  openToWork: true,
};

function person(name: string, title: string, location: string): RawCandidate {
  return {
    name,
    title,
    location,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}?miniProfileUrn=1`,
    sources: ["linkedin-profile"],
    snippet: title,
    haystack: `${title}\n${location}`,
    recentlyChangedJobs: false,
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    firstPassScore: name === "Ada North" ? 80 : 70,
  };
}

describe("cost controls", () => {
  it("drops an unrelated title and a distant location before enrichment, and caps the rest at 10", () => {
    assert.equal(titleClearlyUnrelated("Accountant", "Marketing Executive"), true);
    assert.equal(titleClearlyUnrelated("Marketing Manager", "Marketing Executive"), false);
    const records = [
      person("Ada North", "Marketing Manager", "London"),
      person("Bea Far", "Marketing Manager", "Manchester"),
      person("Cara Books", "Accountant", "London"),
      person("Dee Quiet", "Marketing Lead", ""),
      ...Array.from({ length: 8 }, (_, index) => person(`Extra ${index}`, "Marketing Executive", "Reading")),
    ];
    const filtered = preFilterCandidates(records, spec, MAX_ENRICH);
    assert.equal(filtered.excludedLocation, 1);
    assert.equal(filtered.excludedTitle, 1);
    assert.equal(filtered.enrich.length, MAX_ENRICH);
    assert.equal(filtered.enrich.some((record) => record.name === "Bea Far"), false);
    assert.equal(filtered.enrich.some((record) => record.name === "Cara Books"), false);
    assert.equal(filtered.enrich[0]?.location === "" || filtered.enrich.some((record) => record.name === "Ada North"), true);
    assert.ok(filtered.enrich.findIndex((record) => record.name === "Dee Quiet") > filtered.enrich.findIndex((record) => record.name === "Ada North"));
  });

  it("reuses a cached profile for 30 days and a search page for 24 hours", async () => {
    const cache = createMemoryCache();
    const now = new Date("2026-11-07T12:00:00.000Z");
    await cache.putProfile("https://www.linkedin.com/in/ada?miniProfileUrn=1", { id: "ada" }, now);
    await cache.putSearch("marketing executive|london|1", [{ id: "page" }], now);
    const later = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000);
    assert.deepEqual(await cache.getProfile("https://www.linkedin.com/in/ada", later), { id: "ada" });
    assert.deepEqual(await cache.getSearch("marketing executive|london|1", new Date(now.getTime() + SEARCH_CACHE_MS - 1000)), [{ id: "page" }]);
    assert.equal(await cache.getProfile("https://www.linkedin.com/in/ada", new Date(now.getTime() + PROFILE_CACHE_MS + 1000)), null);
    assert.equal(await cache.getSearch("marketing executive|london|1", new Date(now.getTime() + SEARCH_CACHE_MS + 1000)), null);
  });

  it("does not buy a cached search page or a cached profile, and asks for posts only for the top five", async () => {
    const cache = createMemoryCache();
    const now = new Date("2026-11-07T12:00:00.000Z");
    const profile = {
      firstName: "Ada",
      lastName: "North",
      headline: "Marketing Executive",
      linkedinUrl: "https://www.linkedin.com/in/ada-north",
      location: { linkedinText: "London, United Kingdom" },
    };
    await cache.putSearch("marketing executive crm|london|1", [profile], now);
    await cache.putProfile("https://www.linkedin.com/in/ada-north", { ...profile, about: "CRM" }, now);
    const calls: string[] = [];
    const runner: ActorRunner = async (actor, input) => {
      calls.push(actor);
      if (actor === POST_ACTOR) {
        assert.ok(((input.authorUrls as string[]) ?? []).length <= 5);
        assert.equal(input.maxPosts, 1);
      }
      if (actor === PROFILE_ACTOR) assert.equal(input.takePages, 1);
      if (actor === PROFILE_ACTOR && input.startPage !== undefined) assert.notEqual(input.startPage, 2);
      return { items: [], run: null };
    };
    const result = await searchCandidates(spec, { token: "present", runActor: runner, cache, now });
    assert.equal(calls.includes(PROFILE_ACTOR), false);
    assert.equal(calls.includes(ENRICH_ACTOR), false);
    assert.equal(calls.filter((actor) => actor === POST_ACTOR).length, 1);
    assert.equal(result.spend.runs.some((run) => run.note === "cached" && run.totalUsd === 0), true);
    assert.equal(result.candidates.some((candidate) => candidate.name === "Ada North"), true);
  });

  it("never requests a second search page unless that page was asked for", async () => {
    const first = buildActorPlans(spec).find((plan) => plan.actor === PROFILE_ACTOR);
    assert.equal(first?.input?.takePages, 1);
    assert.equal(first?.input?.startPage, undefined);
    let startPage: unknown;
    const runner: ActorRunner = async (actor, input) => {
      if (actor === PROFILE_ACTOR) {
        startPage = input.startPage;
        assert.equal(input.takePages, 1);
      }
      return { items: [], run: null };
    };
    await searchCandidates({ ...spec, openToWork: false, watchPhrases: [] }, { token: "present", runActor: runner, page: 2 });
    assert.equal(startPage, 2);
    const posts = buildPostsForProfiles([
      "https://www.linkedin.com/in/a",
      "https://www.linkedin.com/in/b",
      "https://www.linkedin.com/in/c",
      "https://www.linkedin.com/in/d",
      "https://www.linkedin.com/in/e",
      "https://www.linkedin.com/in/f",
    ]);
    assert.equal((posts.authorUrls as string[]).length, 5);
  });
});
