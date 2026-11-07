import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSearchSpend } from "./attribute";
import { readRunSnapshot } from "./charge";
import { usdToMicros } from "./money";
import type { RawCandidate } from "./types";

function person(name: string, runId: string, itemIndex: number, source: RawCandidate["origins"] extends (infer T)[] | undefined ? T extends { source: infer S } ? S : never : never): RawCandidate {
  return {
    name,
    title: "Sales Executive",
    location: "London",
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(" ", "-")}`,
    sources: source === "indeed-resume" ? ["indeed-resume"] : ["linkedin-profile"],
    snippet: name,
    haystack: name,
    recentlyChangedJobs: false,
    competitorOrComplaintPost: false,
    cvFound: source === "indeed-resume",
    matchedWatchPhrases: [],
    sample: false,
    origins: [{ runId, actor: "test/actor", source, itemIndex, hasExperience: source !== "linkedin-post" }],
  };
}

describe("cost attribution", () => {
  it("splits a shared search-page charge across profiles and reconciles to usageTotalUsd", () => {
    const run = readRunSnapshot({
      id: "page-run",
      status: "SUCCEEDED",
      usageTotalUsd: 0.1,
      chargedEventCounts: { "search-page": 1 },
      accountedChargedEventCounts: { "search-page": 1 },
      eventUsage: { "search-page": { eventTotalUsd: 0.1, eventTitle: "Search page results" } },
      pricingInfo: { pricingModel: "PAY_PER_EVENT", isPPEPlatformUsagePaidByUser: false },
    });
    const spend = buildSearchSpend({
      mode: "live",
      runs: [{ actor: "harvestapi/linkedin-profile-search", items: [{}, {}], run }],
      records: [person("Avery Lang", "page-run", 0, "linkedin-profile"), person("Priya Shah", "page-run", 1, "linkedin-profile")],
      returnedIds: null,
    });
    assert.equal(spend.totalUsd, 0.1);
    assert.equal(spend.candidates[0]?.totalUsd, 0.05);
    assert.equal(spend.candidates[1]?.totalUsd, 0.05);
    assert.equal(spend.candidates[0]?.lines.every((line) => line.allocated), true);
    assert.equal(
      spend.candidates.reduce((sum, candidate) => sum + usdToMicros(candidate.totalUsd), 0) + usdToMicros(spend.unassignedUsd),
      usdToMicros(0.1),
    );
  });

  it("keeps a per-result event on that person and parks filtered people as unassigned", () => {
    const run = readRunSnapshot({
      id: "post-run",
      status: "SUCCEEDED",
      usageTotalUsd: 0.004,
      chargedEventCounts: { post: 2 },
      eventUsage: { post: { eventTotalUsd: 0.004, eventTitle: "Post" } },
      pricingInfo: { pricingModel: "PAY_PER_EVENT", isPPEPlatformUsagePaidByUser: false },
    });
    const kept = person("Avery Lang", "post-run", 0, "linkedin-post");
    const dropped = person("Jonah Ellis", "post-run", 1, "linkedin-post");
    const spend = buildSearchSpend({
      mode: "live",
      runs: [{ actor: "harvestapi/linkedin-post-search", items: [{}, {}], run }],
      records: [kept, dropped],
      returnedIds: new Set(["linkedin.com/in/avery-lang"]),
    });
    assert.equal(spend.candidates.length, 1);
    assert.equal(spend.candidates[0]?.totalUsd, 0.002);
    assert.equal(spend.candidates[0]?.lines[0]?.allocated, false);
    assert.equal(spend.unassignedUsd, 0.002);
    assert.equal(usdToMicros(spend.candidates[0]?.totalUsd ?? 0) + usdToMicros(spend.unassignedUsd), usdToMicros(0.004));
  });
});
