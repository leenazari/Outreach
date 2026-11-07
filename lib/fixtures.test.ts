import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { applyEnrichment, selectEnrichmentTargets } from "./enrich";
import { linkedInMemberKey } from "./linkedin";
import { normaliseLinkedInProfile } from "./normalise";
import { parseSpokenSpecRules } from "./parse-speech";
import { rankCandidates } from "./rank";
import type { ParsedSpec, RawCandidate } from "./types";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const shortItems = JSON.parse(readFileSync(join(fixtureDir, "short-profiles.json"), "utf8")) as Record<string, unknown>[];
const fullItems = JSON.parse(readFileSync(join(fixtureDir, "full-profiles.json"), "utf8")) as Record<string, unknown>[];

function salesSpec(): ParsedSpec {
  const spoken = parseSpokenSpecRules(
    "Senior Sales Executive, B2B SaaS, London, 3+ years new business sales, CRM experience, recruiting or HR tech a plus",
  );
  return {
    jobTitle: spoken.jobTitle,
    location: spoken.location,
    salaryMin: spoken.salaryMin,
    salaryMax: spoken.salaryMax,
    salaryCurrency: spoken.salaryCurrency,
    mustHave: spoken.mustHave.split(/,|\n/).map((part) => part.trim()).filter(Boolean),
    niceToHave: spoken.niceToHave.split(/,|\n/).map((part) => part.trim()).filter(Boolean),
    watchPhrases: [],
    useSampleData: false,
  };
}

function withoutQuery(item: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...item };
  delete copy.originalQuery;
  return copy;
}

describe("live Apify fixtures", () => {
  it("joins ACw and ACo ids on the shared member segment and changes the score", () => {
    const spec = salesSpec();
    const short = normaliseLinkedInProfile(shortItems[0]);
    const full = normaliseLinkedInProfile(withoutQuery(fullItems[0]));
    assert.ok(short && full);
    assert.equal(linkedInMemberKey(String(shortItems[0]?.id)), linkedInMemberKey(String(fullItems[0]?.id)));
    assert.notEqual(short.profileUrl, full.profileUrl);
    applyEnrichment([short], [full]);
    const after = rankCandidates([short], spec).candidates[0];
    assert.equal(after?.profileUrl, "https://www.linkedin.com/in/arjun-ahluwalia-acsi");
    assert.equal(after?.company, "Dealscribe");
    assert.ok((after?.score ?? 100) <= 40);
  });

  it("enriches the five highest first-pass scores, not the lower ties", () => {
    const spec = salesSpec();
    const raw = shortItems.map((item) => normaliseLinkedInProfile(item)).filter((item): item is RawCandidate => item !== null);
    const ranked = rankCandidates(raw, spec);
    assert.equal(
      ranked.candidates.some((candidate) => candidate.validation.status === "risk"),
      false,
    );
    const picked = selectEnrichmentTargets(ranked.candidates, 5).map((candidate) => candidate.name);
    assert.equal(picked.includes("Howard Campbell"), false);
    assert.equal(picked.includes("Paul Reader"), false);
    assert.ok(picked.includes("Lucy Hitchinson"));
    assert.ok(picked.includes("Sharifa Sardal"));
    for (const candidate of ranked.candidates) {
      assert.equal("companyType" in candidate, false);
      assert.notEqual(candidate.company, "Sales");
    }
  });

  it("caps airline and luxury retail matches at 40 once the full profile is merged", () => {
    const spec = salesSpec();
    const raw = shortItems.map((item) => normaliseLinkedInProfile(item)).filter((item): item is RawCandidate => item !== null);
    const full = fullItems.map((item) => normaliseLinkedInProfile(withoutQuery(item))).filter((item): item is RawCandidate => item !== null);
    const before = new Map(rankCandidates(raw, spec).candidates.map((candidate) => [candidate.name, candidate.score]));
    applyEnrichment(raw, full);
    const after = rankCandidates(raw, spec);
    for (const name of ["Howard Campbell", "Paul Reader"]) {
      const candidate = after.candidates.find((item) => item.name === name);
      assert.ok(candidate);
      assert.ok(candidate.score <= 40);
      assert.ok((before.get(name) ?? 0) <= 40);
      assert.match(candidate.subscores.find((item) => item.key === "skills")?.reason ?? "", /does not match the spec/);
    }
    assert.equal(after.candidates.find((item) => item.name === "Howard Campbell")?.company, "SAUDIA AIRLINES");
    assert.equal(after.candidates.find((item) => item.name === "Paul Reader")?.company, "Graff");
  });
});
