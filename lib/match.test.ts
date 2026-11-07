import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HIGH_RISK_SCORE_CAP, INDUSTRY_SCORE_CAP, MATCH_WEIGHTS, scoreMatch } from "./match";
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

  it("drops unassessed skills from the score instead of counting them as zero", () => {
    const scored = scoreMatch(
      record({
        haystack: "Sales Executive\nLondon",
        snippet: "Sales Executive",
        detailOnRecord: false,
        experience: [],
        recentlyChangedJobs: false,
      }),
      spec,
      "verified",
      new Date("2026-11-07T00:00:00.000Z"),
    );
    const skills = scored.criteria.find((item) => item.key === "skills");
    assert.equal(skills?.assessed, false);
    assert.equal(skills?.reason, "not assessed");
    assert.ok(scored.score > 50);
  });

  it("does not reduce the match score for a high-risk label", () => {
    const when = new Date("2026-11-07T00:00:00.000Z");
    const plain = scoreMatch(record({}), spec, "verified", when);
    const risk = scoreMatch(record({}), spec, "risk", when);
    assert.equal(risk.score, plain.score);
    assert.ok(plain.score > HIGH_RISK_SCORE_CAP);
  });

  it("caps a football club sales profile for a B2B SaaS spec", () => {
    const saas = { ...spec, mustHave: ["B2B SaaS", "CRM experience"], niceToHave: ["recruiting or HR tech"] };
    const scored = scoreMatch(
      record({
        title: "Senior Sales Executive",
        company: "Fulham FC",
        industry: "Spectator Sports",
        haystack: "Senior Sales Executive\nFulham FC\nSpectator Sports\nLondon",
        detailOnRecord: true,
        experience: [
          {
            title: "Senior Sales Executive",
            company: "Fulham FC",
            location: "London",
            start: "2019-01",
            end: null,
            detail: "Club partnerships",
            source: "linkedin-profile",
          },
        ],
      }),
      saas,
      "verified",
      new Date("2026-11-07T00:00:00.000Z"),
    );
    assert.ok(scored.score <= INDUSTRY_SCORE_CAP);
    assert.match(scored.criteria.find((item) => item.key === "skills")?.reason ?? "", /Spectator Sports|Fulham FC/);
  });

  it("matches CRM and new-business keywords from the must-haves", () => {
    const scored = scoreMatch(
      record({
        haystack: "Sales Executive\nLondon\nHubSpot pipeline and business development",
        detailOnRecord: true,
        industry: "Software Development",
      }),
      { ...spec, mustHave: ["CRM experience", "3+ years new business sales"], niceToHave: [] },
      "verified",
      new Date("2026-11-07T00:00:00.000Z"),
    );
    assert.equal(scored.criteria.find((item) => item.key === "skills")?.score, 100);
  });
});

describe("Interviewa export", () => {
  it("exports every candidate", () => {
    const open: Candidate = {
      id: "1",
      name: "Avery Lang",
      title: "Sales Executive",
      location: "London",
      locationRegion: "London",
      company: "",
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
      openToWork: false,
      openToWorkPostUrl: null,
      firstPassScore: 90,
      enriched: false,
      industry: null,
    };
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
    });
    assert.equal(payload.product, "Interviewa candidate finder");
    assert.equal(payload.candidates.length, 1);
    assert.equal(payload.candidates[0]?.costAttributedUsd, 0.1);
    assert.equal(payload.candidates[0]?.name, "Avery Lang");
  });
});
