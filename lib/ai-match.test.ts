import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENRICH_ACTOR, PROFILE_ACTOR } from "./actors";
import type { ActorRunner } from "./apify";
import { normaliseAiMatch, scoreCandidatesWithAi, tokenCostUsd, type AiMatch } from "./ai-match";
import { rankCandidates } from "./rank";
import { searchCandidates } from "./search";
import type { ParsedSpec, RawCandidate } from "./types";

const spec: ParsedSpec = {
  jobTitle: "Sales Executive",
  location: "London",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: ["CRM", "new business"],
  niceToHave: [],
  industry: "B2B SaaS",
  workplace: "Hybrid",
  watchPhrases: [],
  useSampleData: false,
  specText: "Sales executive in London selling HR software to mid-market companies. Must have CRM and new business.",
};

function person(name: string, location: string): RawCandidate {
  return {
    name,
    title: "Sales Executive",
    location,
    profileUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
    company: "Northwind",
    industry: "Computer Software",
    headline: "New business",
    about: "Sold HR software",
    skills: ["CRM"],
    sources: ["linkedin-profile"],
    snippet: "Sold HR software",
    haystack: "CRM new business HR software",
    recentlyChangedJobs: false,
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    experience: [
      {
        title: "Account Executive",
        company: "Northwind",
        industry: "Computer Software",
        location: "London",
        start: "2021-01",
        end: null,
        detail: "Sold HR software to mid-market teams and used CRM.",
        source: "linkedin-profile",
      },
    ],
  };
}

const match: AiMatch = {
  relevantExperienceYears: 4,
  roleRelevance: 90,
  industrySimilarity: 88,
  seniorityFit: 80,
  skillsMatch: 70,
  matchedSkills: ["CRM"],
  missingSkills: ["new business"],
  locationFit: 100,
  overall: 86,
  reason: "4 years selling HR software to mid-market; CRM and new business",
};

describe("AI match", () => {
  it("uses the model overall and leaves a failed call on the heuristic", async () => {
    const records = [person("Ada North", "London"), person("Bea South", "Reading")];
    const ranked = rankCandidates(records, spec);
    const seen: string[] = [];
    const spend = await scoreCandidatesWithAi(ranked.candidates, records, spec, {
      concurrency: 2,
      judge: async ({ profile }) => {
        seen.push(profile);
        if (profile.includes("Bea South")) throw new Error("model failed");
        return { match, inputTokens: 1000, outputTokens: 200, usd: 0.0002 };
      },
    });
    assert.equal(seen.length, 2);
    const ada = ranked.candidates.find((candidate) => candidate.name === "Ada North");
    const bea = ranked.candidates.find((candidate) => candidate.name === "Bea South");
    assert.equal(ada?.score, 86);
    assert.equal(ada?.scoreSource, "ai");
    assert.equal(ada?.matchReason, match.reason);
    assert.deepEqual(ada?.matchedSkills, ["CRM"]);
    assert.deepEqual(ada?.missingSkills, ["new business"]);
    assert.equal(bea?.scoreSource, "heuristic");
    assert.match(bea?.matchReason ?? "", /Heuristic score/);
    assert.equal(spend.calls, 2);
    assert.equal(spend.failed, 1);
    assert.equal(spend.inputTokens, 1000);
    assert.equal(tokenCostUsd("google/gemini-2.5-flash-lite", 1_000_000, 0), 0.1);
  });

  it("does not send someone outside the commute to the model", async () => {
    const judged: string[] = [];
    const runner: ActorRunner = async (actor) => {
      if (actor === PROFILE_ACTOR) {
        return {
          items: [
            {
              firstName: "Ada",
              lastName: "North",
              headline: "Sales",
              linkedinUrl: "https://www.linkedin.com/in/ada-north",
              location: { linkedinText: "London, United Kingdom" },
            },
            {
              firstName: "Cara",
              lastName: "Far",
              headline: "Sales",
              linkedinUrl: "https://www.linkedin.com/in/cara-far",
              location: { linkedinText: "Manchester, United Kingdom" },
            },
          ],
          run: null,
        };
      }
      if (actor === ENRICH_ACTOR) return { items: [], run: null };
      return { items: [], run: null };
    };
    const result = await searchCandidates(spec, {
      token: "present",
      runActor: runner,
      aiMatch: true,
      judge: async ({ profile }) => {
        judged.push(profile);
        return { match: { ...match, overall: 91 }, inputTokens: 10, outputTokens: 5, usd: 0.00001 };
      },
    });
    assert.equal(result.stats.excludedForLocation, 1);
    assert.equal(result.candidates.some((candidate) => candidate.name === "Cara Far"), false);
    assert.equal(judged.length, 1);
    assert.match(judged[0] ?? "", /Ada North/);
    assert.equal(result.candidates[0]?.score, 91);
    assert.equal(result.spend.llm?.calls, 1);
    assert.equal(result.spend.runs.some((run) => run.label === "AI match"), true);
  });

  it("clamps a score into 0 to 100", () => {
    assert.equal(normaliseAiMatch({ ...match, overall: 140, reason: "  too   long  " }).overall, 100);
  });
});
