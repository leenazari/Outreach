import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    assert.equal(parseSpokenSpecRules("bonus: company car").niceToHave, "company car");
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
