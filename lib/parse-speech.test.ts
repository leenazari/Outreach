import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildActorPlans, buildProfileSearchQuery, PROFILE_ACTOR, SEARCH_QUERY_MAX } from "./actors";
import { interpretTranscript, parseSpokenSpecRules } from "./parse-speech";
import { salaryLabel } from "./parse";
import { rankCandidates } from "./rank";
import type { ParsedSpec, RawCandidate } from "./types";

describe("spoken spec parser", () => {
  it("reads a plain English sales request", () => {
    const parsed = parseSpokenSpecRules(
      "I'm looking for a sales guy in London, 45 grand, must have B2B experience",
    );
    assert.equal(parsed.jobTitle, "sales guy");
    assert.equal(parsed.location, "London");
    assert.equal(parsed.salaryMin, "45000");
    assert.equal(parsed.salaryMax, "");
    assert.equal(parsed.salaryCurrency, "GBP");
    assert.equal(parsed.mustHave, "B2B experience");
    assert.equal(parsed.niceToHave, "");
  });

  it("reads ranges, 45k, essentials, and nice-to-haves", () => {
    const ranged = parseSpokenSpecRules(
      "looking for an account executive in Manchester, £40,000 to £50,000, essential full UK driving licence, ideally SaaS sales",
    );
    assert.equal(ranged.jobTitle, "account executive");
    assert.equal(ranged.location, "Manchester");
    assert.equal(ranged.salaryMin, "40000");
    assert.equal(ranged.salaryMax, "50000");
    assert.equal(ranged.mustHave, "full UK driving licence");
    assert.equal(ranged.niceToHave, "SaaS sales");

    assert.equal(parseSpokenSpecRules("budget is 45k").salaryMin, "45000");
    assert.equal(parseSpokenSpecRules("needs a CRM and a driving licence").mustHave, "CRM\ndriving licence");
    assert.equal(
      parseSpokenSpecRules("must have CRM experience, B2B SaaS, £45,000 to £55,000").mustHave,
      "CRM experience\nB2B SaaS",
    );
    assert.equal(parseSpokenSpecRules("bonus: company car").niceToHave, "company car");
  });

  it("derives a short title from a long voice spec", () => {
    const filler = "who can own campaigns, talk to founders, and build a team that sells into mid-market companies across the UK. ";
    const voice = `I'm looking for a marketing executive ${filler.repeat(12)} in London, hybrid, 5+ years, must have CRM experience, B2B SaaS`;
    assert.ok(voice.length > 600);
    const parsed = parseSpokenSpecRules(voice);
    assert.equal(parsed.jobTitle, "marketing executive");
    assert.equal(parsed.location, "London");
    assert.equal(parsed.seniority, "");
    assert.equal(parsed.yearsExperience, "5");
    assert.match(parsed.industry, /SaaS/i);
    assert.equal(parsed.workplace, "Hybrid");
    assert.ok(parsed.jobTitle.length <= 80);
    assert.equal(parsed.jobTitle.includes(filler.slice(0, 40)), false);
    const query = buildProfileSearchQuery({
      jobTitle: voice,
      mustHave: parsed.mustHave.split("\n").filter(Boolean),
      niceToHave: [],
    });
    assert.ok(query.length <= SEARCH_QUERY_MAX);
    assert.ok(query.length <= 300);
    assert.match(query, /^marketing executive/i);
    assert.equal(query.toLowerCase().includes("founders"), false);
    const plans = buildActorPlans({
      jobTitle: voice,
      location: parsed.location,
      salaryMin: "",
      salaryMax: "",
      salaryCurrency: "GBP",
      mustHave: parsed.mustHave.split("\n").filter(Boolean),
      niceToHave: [],
      watchPhrases: [],
      useSampleData: false,
      openToWork: true,
    });
    const profile = plans.find((plan) => plan.actor === PROFILE_ACTOR);
    assert.equal(profile?.input && (profile.input as { searchQuery: string }).searchQuery, query);
    assert.deepEqual(profile?.input && (profile.input as { locations?: string[] }).locations, ["London"]);
    assert.ok(!JSON.stringify(profile?.input).includes(voice.slice(0, 120)));
  });

  it("reads a pasted spec that does not say looking for", () => {
    const parsed = parseSpokenSpecRules(
      "Senior Sales Executive, B2B SaaS, London, 3+ years new business sales, CRM experience, recruiting or HR tech a plus",
    );
    assert.equal(parsed.jobTitle, "Senior Sales Executive");
    assert.equal(parsed.location, "London");
    assert.match(parsed.mustHave, /B2B SaaS/);
    assert.match(parsed.mustHave, /3\+ years new business sales/);
    assert.match(parsed.mustHave, /CRM experience/);
    assert.match(parsed.niceToHave, /recruiting or HR tech/);
    assert.equal(parsed.jobTitle.length > 0, true);
  });

  it("uses the rule parser when no OpenAI key is set", async () => {
    const parsed = await interpretTranscript(
      "I'm looking for a sales guy in London, 45 grand, must have B2B experience",
      "  ",
    );
    assert.equal(parsed.parser, "rules");
    assert.equal(parsed.location, "London");
  });

  it("formats the default salary band", () => {
    assert.equal(
      salaryLabel({ salaryMin: "40000", salaryMax: "50000", salaryCurrency: "GBP" }),
      "£40,000 to £50,000",
    );
  });
});

describe("result cap", () => {
  it("returns at most 25 ranked candidates", () => {
    const spec: ParsedSpec = {
      jobTitle: "Sales Executive",
      location: "London",
      salaryMin: "40000",
      salaryMax: "50000",
      salaryCurrency: "GBP",
      mustHave: [],
      niceToHave: [],
      watchPhrases: [],
      useSampleData: true,
    };
    const records: RawCandidate[] = Array.from({ length: 30 }, (_, index) => ({
      name: `Person ${String(index).padStart(2, "0")}`,
      title: "Sales Executive",
      location: "London",
      profileUrl: `https://www.linkedin.com/in/person-${index}`,
      sources: ["linkedin-profile"],
      snippet: "Sales",
      haystack: "Sales",
      recentlyChangedJobs: false,
      competitorOrComplaintPost: false,
      cvFound: false,
      matchedWatchPhrases: [],
      sample: false,
    }));
    const ranked = rankCandidates(records, spec);
    assert.equal(ranked.matched, 30);
    assert.equal(ranked.candidates.length, 25);
  });
});
