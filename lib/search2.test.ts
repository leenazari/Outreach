import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ENRICH_ACTOR, POST_ACTOR, PROFILE_ACTOR } from "./actors";
import type { ActorRunner } from "./apify";
import { profilesToEnrich } from "./enrich";
import { normaliseLinkedInPost, normaliseLinkedInProfile } from "./normalise";
import { parseSpokenSpecRules } from "./parse-speech";
import { searchCandidates } from "./search";
import { linkedInMemberKey } from "./linkedin";
import { canonicalProfileUrl } from "./text";
import type { ParsedSpec, RawCandidate } from "./types";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const shortItems = JSON.parse(readFileSync(join(fixtureDir, "search2-short-profiles.json"), "utf8")) as unknown[];
const fullItems = JSON.parse(readFileSync(join(fixtureDir, "search2-full-profiles.json"), "utf8")) as unknown[];
const postItems = JSON.parse(readFileSync(join(fixtureDir, "search2-posts.json"), "utf8")) as unknown[];

function salesSpec(): ParsedSpec {
  const spoken = parseSpokenSpecRules(
    "Senior Sales Executive, B2B SaaS, London, 3+ years new business sales, CRM experience, recruiting or HR tech a plus",
  );
  return {
    jobTitle: spoken.jobTitle,
    location: spoken.location,
    salaryMin: spoken.salaryMin,
    salaryMax: spoken.salaryMax,
    salaryCurrency: spoken.salaryCurrency || "GBP",
    mustHave: spoken.mustHave.split(/,|\n/).map((part) => part.trim()).filter(Boolean),
    niceToHave: spoken.niceToHave.split(/,|\n/).map((part) => part.trim()).filter(Boolean),
    watchPhrases: [],
    useSampleData: false,
    openToWork: true,
  };
}

describe("search aa42cce1 pipeline", () => {
  it("enriches the top first-pass scores, returns 25, and keeps post links", async () => {
    const enrichQueries: string[] = [];
    const runner: ActorRunner = async (actor, input) => {
      if (actor === PROFILE_ACTOR) return { items: shortItems, run: null };
      if (actor === POST_ACTOR) return { items: postItems, run: null };
      if (actor === ENRICH_ACTOR) {
        const queries = (input.queries as string[]) ?? [];
        enrichQueries.push(...queries);
        const items = fullItems.filter((item) => {
          const record = item as { id?: string; linkedinUrl?: string; originalQuery?: { query?: string } };
          const member = linkedInMemberKey(record.id ?? "");
          const original = canonicalProfileUrl(record.originalQuery?.query ?? null);
          const vanity = canonicalProfileUrl(record.linkedinUrl ?? null);
          return queries.some((query) => {
            const key = canonicalProfileUrl(query);
            return key === original || key === vanity || (member !== null && linkedInMemberKey(query) === member);
          });
        });
        return { items, run: null };
      }
      return { items: [], run: null };
    };

    const result = await searchCandidates(salesSpec(), { token: "present", runActor: runner, enrichTopN: 10 });

    assert.ok(result.candidates.length > 10);
    assert.ok(result.candidates.length <= 25);
    const known = result.candidates.filter((candidate) => candidate.locationStatus !== "unknown");
    const unknown = result.candidates.filter((candidate) => candidate.locationStatus === "unknown");
    assert.deepEqual(result.candidates, [...known, ...unknown]);
    for (const group of [known, unknown]) {
      for (let index = 1; index < group.length; index += 1) {
        assert.ok((group[index - 1]?.score ?? 0) >= (group[index]?.score ?? 0));
      }
    }

    const pool = [
      ...shortItems.map((item) => normaliseLinkedInProfile(item)).filter((item): item is RawCandidate => item !== null),
      ...postItems.map((item) => normaliseLinkedInPost(item, [])).filter((item): item is RawCandidate => item !== null),
    ];
    assert.deepEqual(
      enrichQueries.map((url) => canonicalProfileUrl(url)).sort(),
      profilesToEnrich(pool, salesSpec(), 25).map((url) => canonicalProfileUrl(url)).sort(),
    );
    const gurdeep = result.candidates.find((candidate) => candidate.name === "Gurdeep Gill");
    assert.ok(gurdeep, "Gurdeep should stay on the 25-person shortlist");
    assert.match(gurdeep.openToWorkPostUrl ?? "", /linkedin\.com\/posts\//);
    assert.ok(gurdeep.score < (result.candidates[0]?.score ?? 0));
    assert.equal(gurdeep.industry, null);
    assert.equal(gurdeep.subscores.find((item) => item.key === "skills")?.reason, "not assessed");

    const sharifa = result.candidates.find((candidate) => candidate.name === "Sharifa Sardal");
    assert.equal(sharifa?.enriched, false);
    assert.equal(sharifa?.industry, "IT Services and IT Consulting");
    assert.equal(sharifa?.validation.label, "Not checked (short profile)");

    assert.ok(result.candidates.some((candidate) => !candidate.enriched && candidate.validation.label === "Not checked (short profile)"));

    console.log(
      result.candidates.slice(0, 10).map((candidate) => ({
        name: candidate.name,
        firstPassScore: candidate.firstPassScore,
        score: candidate.score,
        enriched: candidate.enriched,
      })),
    );
  });
});
