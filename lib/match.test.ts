import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { presentCandidate } from "./identity";
import { HIGH_RISK_SCORE_CAP, MATCH_WEIGHTS, scoreMatch } from "./match";
import { buildExport } from "./interviewa";
import type { Candidate, ParsedSpec, RawCandidate } from "./types";

const spec: ParsedSpec = {
  jobTitle: "Sales Executive",
  location: "London",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: ["B2B sales", "at least 2 years B2B sales"],
  niceToHave: ["CRM"],
  watchPhrases: [],
  useSampleData: false,
  includeIndeed: true,
};

function record(overrides: Partial<RawCandidate>): RawCandidate {
  return {
    name: "Avery Lang",
    title: "Sales Executive",
    location: "London, United Kingdom",
    profileUrl: "https://www.linkedin.com/in/avery",
    sources: ["linkedin-profile"],
    snippet: "B2B sales and CRM",
    haystack: "Sales Executive\nLondon\nB2B sales\nCRM",
    recentlyChangedJobs: true,
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    experience: [
      {
        title: "Sales Executive",
        company: "Northwind",
        location: "London",
        start: "2018-01",
        end: null,
        detail: "B2B sales",
        source: "linkedin-profile",
      },
    ],
    ...overrides,
  };
}

describe("match scoring", () => {
  it("weights sum to 100 and a close profile scores high", () => {
    const weights = Object.values(MATCH_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.equal(weights, 100);
    const scored = scoreMatch(record({}), spec, "verified", new Date("2026-11-07T00:00:00.000Z"));
    assert.equal(scored.criteria.length, 6);
    assert.equal(scored.unlockBlocked, false);
    assert.ok(scored.score >= 80);
  });

  it("caps a high-risk profile below the default gate", () => {
    const scored = scoreMatch(record({}), spec, "risk", new Date("2026-11-07T00:00:00.000Z"));
    assert.equal(scored.unlockBlocked, true);
    assert.ok(scored.score <= HIGH_RISK_SCORE_CAP);
  });
});

describe("identity gate", () => {
  it("strips name and profile URL below the gate and keeps them above it", () => {
    const base = {
      id: "linkedin.com/in/avery",
      title: "Sales Executive",
      location: "London, United Kingdom",
      locationRegion: "United Kingdom",
      companyType: "Sales",
      experienceSummary: "1 dated role on the public record.",
      skills: ["B2B sales"],
      source: "linkedin-profile" as const,
      sources: ["linkedin-profile" as const],
      snippet: "Avery Lang, B2B sales, avery@example.com",
      score: 70,
      subscores: [],
      why: [],
      matchedMustHaves: [],
      matchedNiceToHaves: [],
      matchedWatchPhrases: [],
      recentlyChangedJobs: true,
      competitorOrComplaintPost: false,
      cvFound: false,
      sample: false,
      validation: { status: "review" as const, label: "Needs review", reasons: [{ summary: "Short tenure", evidence: "Northwind 2024" }] },
      unlockBlocked: false,
      blockedReason: null,
      identityNote: null,
      email: "avery@example.com",
      photoUrl: "https://example.com/avery.jpg",
      sourceUrl: null,
    } satisfies Omit<Candidate, "name" | "profileUrl" | "unlocked">;

    const locked = presentCandidate({ ...base, name: "Avery Lang", profileUrl: "https://www.linkedin.com/in/avery", unlocked: false });
    assert.equal(locked.name, null);
    assert.equal(locked.profileUrl, null);
    assert.equal(locked.email, null);
    assert.equal(locked.photoUrl, null);
    assert.equal(JSON.stringify(locked).includes("Avery Lang"), false);
    assert.equal(JSON.stringify(locked).includes("avery@example.com"), false);
    assert.equal(JSON.stringify(locked).includes("Northwind"), false);

    const open = presentCandidate({ ...base, name: "Avery Lang", profileUrl: "https://www.linkedin.com/in/avery", unlocked: true, score: 90 });
    assert.equal(open.name, "Avery Lang");
    assert.equal(open.profileUrl, "https://www.linkedin.com/in/avery");

    const indeed = presentCandidate({
      ...base,
      name: "Riley Chen",
      profileUrl: null,
      sourceUrl: "https://resumes.indeed.com/resume/abc",
      sources: ["indeed-resume"],
      source: "indeed-resume",
      unlocked: true,
      score: 88,
    });
    assert.equal(indeed.name, null);
    assert.equal(indeed.sourceUrl, "https://resumes.indeed.com/resume/abc");
    assert.match(indeed.identityNote ?? "", /Indeed/);
  });

  it("exports only unlocked candidates", () => {
    const open = presentCandidate({
      id: "1",
      name: "Avery Lang",
      title: "Sales Executive",
      location: "London",
      locationRegion: "London",
      companyType: "Sales",
      experienceSummary: "1 dated role on the public record.",
      skills: ["B2B sales"],
      profileUrl: "https://www.linkedin.com/in/avery",
      sourceUrl: null,
      email: null,
      photoUrl: null,
      source: "linkedin-profile",
      sources: ["linkedin-profile"],
      snippet: "Sales",
      score: 90,
      subscores: [],
      why: [],
      matchedMustHaves: [],
      matchedNiceToHaves: [],
      matchedWatchPhrases: [],
      recentlyChangedJobs: false,
      competitorOrComplaintPost: false,
      cvFound: false,
      sample: false,
      validation: { status: "verified", label: "Verified consistent", reasons: [] },
      unlocked: true,
      unlockBlocked: false,
      blockedReason: null,
      identityNote: null,
    });
    const payload = buildExport({
      candidates: [open],
      spend: {
        mode: "live",
        searchId: "s",
        settled: true,
        totalUsd: 0.1,
        settlingUsd: 0,
        unassignedUsd: 0,
        runs: [],
        candidates: [{ candidateId: "1", name: "Avery Lang", totalUsd: 0.1, lines: [] }],
        note: "",
      },
      searchId: "s",
      jobTitle: "Sales Executive",
      location: "London",
      unlockThreshold: 80,
    });
    assert.equal(payload.product, "Interviewa candidate finder");
    assert.equal(payload.candidates.length, 1);
    assert.equal(payload.candidates[0]?.costAttributedUsd, 0.1);
    assert.equal(payload.candidates[0]?.name, "Avery Lang");
  });
});
