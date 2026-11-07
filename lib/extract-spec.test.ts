import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSpec, fieldsFromExtraction, type SpecExtraction } from "./extract-spec";

const marketing: SpecExtraction = {
  jobTitle: "Marketing Executive",
  seniority: "senior",
  location: "London",
  workMode: "hybrid",
  officeDays: "3",
  salaryMin: "45000",
  salaryMax: "55000",
  salaryCurrency: "GBP",
  yearsExperience: "5",
  mustHaves: ["CRM", "new business"],
  niceToHaves: ["HubSpot"],
  industry: "B2B SaaS",
  keySkills: ["CRM"],
  searchTitle: "Marketing Executive CRM",
};

const sales: SpecExtraction = {
  jobTitle: "Sales Executive",
  seniority: "senior",
  location: "Manchester",
  workMode: "onsite",
  officeDays: "",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "",
  yearsExperience: "2",
  mustHaves: ["full UK driving licence"],
  niceToHaves: ["company car"],
  industry: "",
  keySkills: [],
  searchTitle: "Sales Executive",
};

const design: SpecExtraction = {
  jobTitle: "Product Designer",
  seniority: "",
  location: "New York",
  workMode: "remote",
  officeDays: "",
  salaryMin: "80000",
  salaryMax: "",
  salaryCurrency: "USD",
  yearsExperience: "",
  mustHaves: ["Figma"],
  niceToHaves: ["user research"],
  industry: "fintech",
  keySkills: ["Figma"],
  searchTitle: "Product Designer Figma",
};

describe("spec extraction", () => {
  it("maps three spoken specs into form fields", async () => {
    const cases = [
      {
        transcript:
          "Um I'm looking for a I'm looking for a senior marketing executive in London, hybrid three days a week, at least five years, they need CRM and new business, ideally HubSpot, B2B SaaS, forty five to fifty five k",
        output: marketing,
        years: "5",
        workplace: "Hybrid, 3 days in office",
        must: /CRM/,
        nice: "HubSpot",
      },
      {
        transcript:
          "I'm looking for a I'm looking for a senior sales guy in Manchester, has to have a full UK driving licence, a company car would be a plus, office based, at least 2 years",
        output: sales,
        years: "2",
        workplace: "Office",
        must: /driving licence/,
        nice: "company car",
      },
      {
        transcript:
          "We need a remote product designer in New York, budget is 80k dollars, Figma is essential, user research would be nice, fintech",
        output: design,
        years: "",
        workplace: "Remote",
        must: /Figma/,
        nice: "user research",
      },
    ];
    for (const sample of cases) {
      let seen = "";
      const parsed = await extractSpec(sample.transcript, {
        extract: async ({ transcript }) => {
          seen = transcript;
          return { output: sample.output, inputTokens: 400, outputTokens: 120, usd: 0.0001 };
        },
      });
      assert.equal(seen, sample.transcript);
      assert.equal(parsed.fields.parser, "gateway");
      assert.equal(parsed.fields.jobTitle, sample.output.jobTitle);
      assert.equal(parsed.fields.yearsExperience, sample.years);
      assert.equal(parsed.fields.workplace, sample.workplace);
      assert.match(parsed.fields.mustHave, sample.must);
      assert.equal(parsed.fields.niceToHave, sample.nice);
      assert.equal(parsed.fields.location, sample.output.location);
      assert.equal(parsed.usage?.inputTokens, 400);
    }
    assert.equal(fieldsFromExtraction(marketing).searchTitle, "Marketing Executive CRM");
    assert.equal(fieldsFromExtraction(marketing).salaryCurrency, "GBP");
    assert.equal(fieldsFromExtraction(design).salaryCurrency, "USD");
  });

  it("uses the regex parser when the model call fails", async () => {
    const parsed = await extractSpec("I'm looking for a sales guy in London, must have B2B experience", {
      extract: async () => {
        throw new Error("AI Gateway authentication failed: No authentication provided");
      },
    });
    assert.equal(parsed.fields.parser, "rules");
    assert.equal(parsed.fields.jobTitle, "sales guy");
    assert.equal(parsed.fields.location, "London");
    assert.match(parsed.fields.mustHave, /B2B experience/);
    assert.equal(parsed.usage, null);
  });
});
