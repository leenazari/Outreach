import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEnrichment, enrichmentQuery, selectEnrichmentTargets } from "./enrich";
import { scoreMatch } from "./match";
import { normaliseLinkedInProfile } from "./normalise";
import { rankCandidates } from "./rank";
import type { ParsedSpec } from "./types";

const spec: ParsedSpec = {
  jobTitle: "Sales Executive",
  location: "London",
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "GBP",
  mustHave: ["B2B SaaS", "CRM"],
  niceToHave: [],
  watchPhrases: [],
  useSampleData: false,
};

describe("enrichment selection", () => {
  it("sorts by score and keeps the top five at or above 50, including an ACwAA id", () => {
    const picked = selectEnrichmentTargets(
      [
        { name: "Arjun Ahluwalia", score: 49, profileUrl: "https://www.linkedin.com/in/arjun-ahluwalia" },
        { name: "Cameron Stebbing", score: 48, profileUrl: "https://www.linkedin.com/in/cameron-stebbing" },
        { name: "Lucy Hitchinson", score: 47, profileUrl: "https://www.linkedin.com/in/lucy-hitchinson" },
        { name: "Sharifa Sardal", score: 74, profileUrl: null, linkedinIds: ["ACwAAASharifa01"] },
        { name: "Russell Cox", score: 71, profileUrl: "https://www.linkedin.com/in/ACwAAARussell1" },
        { name: "Roshan Vashi", score: 68, profileUrl: "https://www.linkedin.com/in/roshan-vashi" },
        { name: "Mina Cole", score: 61, profileUrl: "https://www.linkedin.com/in/mina-cole" },
        { name: "Owen Blake", score: 55, profileUrl: "https://www.linkedin.com/in/owen-blake" },
      ],
      5,
    );
    assert.deepEqual(
      picked.map((person) => person.name),
      ["Sharifa Sardal", "Russell Cox", "Roshan Vashi", "Mina Cole", "Owen Blake"],
    );
    assert.equal(enrichmentQuery(picked[0]!), "https://www.linkedin.com/in/ACwAAASharifa01");
  });
});

describe("enriched profile merge", () => {
  it("joins a full profile by ACwAA id and changes the match score", () => {
    const short = normaliseLinkedInProfile({
      id: "ACwAAASharifa01",
      firstName: "Sharifa",
      lastName: "Sardal",
      headline: "Sales Executive",
      linkedinUrl: "https://www.linkedin.com/in/ACwAAASharifa01",
      location: { linkedinText: "London, United Kingdom" },
      currentPositions: [{ title: "Sales Executive", companyName: "Short Co" }],
    });
    const full = normaliseLinkedInProfile({
      id: "ACwAAASharifa01",
      objectUrn: "urn:li:fsd_profile:ACwAAASharifa01",
      publicIdentifier: "sharifa-sardal",
      firstName: "Sharifa",
      lastName: "Sardal",
      headline: "Sales Executive",
      linkedinUrl: "https://www.linkedin.com/in/sharifa-sardal",
      originalQuery: { query: "https://www.linkedin.com/in/ACwAAASharifa01", url: "https://www.linkedin.com/in/ACwAAASharifa01" },
      about: "B2B SaaS new business sales and CRM",
      industry: { name: "Computer Software" },
      skills: [{ name: "CRM" }, { name: "B2B SaaS" }],
      currentPosition: [
        {
          position: "Sales Executive",
          companyName: "Acme SaaS",
          description: "B2B SaaS sales and CRM",
          startDate: { year: 2022, month: 1 },
        },
      ],
      experience: [
        {
          position: "Account Executive",
          companyName: "Old SaaS",
          description: "B2B SaaS and CRM",
          startDate: { year: 2018, month: 1 },
          endDate: { year: 2022, month: 1 },
        },
      ],
      location: { linkedinText: "London, United Kingdom" },
    });
    assert.ok(short && full);
    const before = rankCandidates([short], spec).candidates[0]?.score ?? 0;
    applyEnrichment([short], [full]);
    const after = rankCandidates([short], spec).candidates[0];
    assert.notEqual(after?.score, before);
    assert.equal(after?.company, "Acme SaaS");
    assert.equal(after?.profileUrl, "https://www.linkedin.com/in/sharifa-sardal");
    assert.ok((after?.score ?? 0) > before);
  });

  it("scores a clearly unrelated industry below a matching one once the profile is enriched", () => {
    const saas = normaliseLinkedInProfile({
      id: "ACwAAASaaS0001",
      publicIdentifier: "saas-seller",
      firstName: "Mina",
      lastName: "Cole",
      headline: "Sales Executive",
      about: "B2B SaaS and CRM",
      industry: { name: "Computer Software" },
      skills: [{ name: "CRM" }, { name: "B2B SaaS" }],
      location: { linkedinText: "London, United Kingdom" },
      experience: [
        {
          position: "Sales Executive",
          companyName: "Acme SaaS",
          description: "B2B SaaS sales and CRM",
          startDate: { year: 2019, month: 1 },
        },
      ],
    });
    const aviation = normaliseLinkedInProfile({
      id: "ACwAAAAviation1",
      publicIdentifier: "aviation-seller",
      firstName: "Owen",
      lastName: "Blake",
      headline: "Sales Executive",
      about: "Commercial aviation sales",
      industry: { name: "Airlines/Aviation" },
      skills: [{ name: "Sales" }],
      location: { linkedinText: "London, United Kingdom" },
      experience: [
        {
          position: "Sales Executive",
          companyName: "British Airways",
          description: "Commercial aviation sales",
          startDate: { year: 2019, month: 1 },
        },
      ],
    });
    assert.ok(saas && aviation);
    saas.enriched = true;
    aviation.enriched = true;
    const when = new Date("2026-11-07T00:00:00.000Z");
    const saasScore = scoreMatch(saas, spec, "verified", when);
    const aviationScore = scoreMatch(aviation, spec, "verified", when);
    assert.ok(aviationScore.score <= 40);
    assert.ok(aviationScore.score < saasScore.score);
    const skills = aviationScore.criteria.find((item) => item.key === "skills");
    assert.match(skills?.reason ?? "", /Airlines\/Aviation/);
    assert.match(skills?.reason ?? "", /B2B software/);
    assert.equal(skills?.score, 0);
  });
});
