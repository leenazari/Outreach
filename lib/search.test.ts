import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTOR_TIMEOUT_SECS,
  buildActorPlans,
  buildEnrichInput,
  buildIndeedResumeSearchUrl,
  ENRICH_ACTOR,
  INDEED_ACTOR,
  POST_ACTOR,
  PROFILE_ACTOR,
} from "./actors";
import { buildActorRunsUrl, type ActorRunner } from "./apify";
import { MissingApifyTokenError, searchCandidates } from "./search";
import { normaliseIndeedResume, normaliseLinkedInProfile } from "./normalise";
import { parsePhraseList, parseSearchRequest } from "./parse";
import { dedupeCandidates, matchIsOpen, rankCandidates } from "./rank";
import type { ParsedSpec, RawCandidate } from "./types";
import { canonicalProfileUrl } from "./text";

const spec: ParsedSpec = {
  jobTitle: "Senior Product Designer",
  location: "London",
  salaryMin: "70000",
  salaryMax: "90000",
  salaryCurrency: "GBP",
  mustHave: ["Figma", "user research", "design systems"],
  niceToHave: ["B2B SaaS", "accessibility", "workshop facilitation"],
  watchPhrases: ["Greenhouse", "ATS is painful", "Lever"],
  useSampleData: true,
};

function raw(overrides: Partial<RawCandidate> & Pick<RawCandidate, "name" | "haystack">): RawCandidate {
  return {
    title: "Senior Product Designer",
    location: "London",
    profileUrl: null,
    sources: ["linkedin-profile"],
    snippet: overrides.haystack,
    recentlyChangedJobs: false,
    competitorOrComplaintPost: false,
    cvFound: false,
    matchedWatchPhrases: [],
    sample: false,
    ...overrides,
  };
}

describe("actor inputs", () => {
  it("uses the store field names and keeps the runs small", () => {
    const plans = buildActorPlans(spec);
    const profile = plans.find((plan) => plan.actor === PROFILE_ACTOR);
    const posts = plans.find((plan) => plan.actor === POST_ACTOR);
    const indeed = plans.find((plan) => plan.actor === INDEED_ACTOR);

    assert.equal(profile?.skipped, false);
    assert.deepEqual(profile?.input, {
      profileScraperMode: "Short",
      searchQuery: "Senior Product Designer",
      maxItems: 10,
      locations: ["London"],
      currentJobTitles: ["Senior Product Designer"],
      recentlyChangedJobs: true,
      takePages: 1,
    });
    assert.equal(JSON.stringify(profile?.input).includes("email"), false);

    assert.deepEqual(posts?.input, {
      searchQueries: ["Greenhouse", "ATS is painful", "Lever"],
      maxPosts: 5,
      postedLimit: "month",
      sortBy: "date",
      profileScraperMode: "short",
      scrapeReactions: false,
      scrapeComments: false,
    });

    const indeedInput = indeed?.input as {
      startUrls: { url: string }[];
      maxItems: number;
      proxyConfiguration: { useApifyProxy: boolean; apifyProxyGroups: string[]; apifyProxyCountry: string };
    };
    assert.equal(indeedInput.maxItems, 3);
    assert.equal(indeedInput.proxyConfiguration.apifyProxyCountry, "US");
    assert.equal(indeedInput.proxyConfiguration.useApifyProxy, true);
    assert.deepEqual(indeedInput.proxyConfiguration.apifyProxyGroups, ["RESIDENTIAL"]);
    assert.match(indeedInput.startUrls[0]?.url ?? "", /resumes\.indeed\.com\/search\?/);
    assert.match(indeedInput.startUrls[0]?.url ?? "", /q=Senior\+Product\+Designer/);
    assert.match(indeedInput.startUrls[0]?.url ?? "", /l=London/);
  });

  it("skips Indeed when Include Indeed is off", () => {
    const indeed = buildActorPlans({ ...spec, includeIndeed: false }).find((plan) => plan.actor === INDEED_ACTOR);
    assert.equal(indeed?.skipped, true);
    assert.equal(indeed?.input, null);
  });

  it("skips post search when no phrases are given", () => {
    const posts = buildActorPlans({ ...spec, watchPhrases: [] }).find((plan) => plan.actor === POST_ACTOR);
    assert.equal(posts?.skipped, true);
    assert.equal(posts?.input, null);
  });

  it("builds the run endpoint without putting a token in the URL", () => {
    const url = buildActorRunsUrl(PROFILE_ACTOR, ACTOR_TIMEOUT_SECS);
    assert.equal(
      url,
      "https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/runs?timeout=240&waitForFinish=60",
    );
    assert.deepEqual(buildEnrichInput(["https://www.linkedin.com/in/ada"]), {
      profileScraperMode: "Profile details no email ($4 per 1k)",
      queries: ["https://www.linkedin.com/in/ada"],
    });
    assert.equal(url.includes("token"), false);
    assert.match(buildIndeedResumeSearchUrl("Nurse", "Manchester"), /q=Nurse/);
    assert.match(buildIndeedResumeSearchUrl("Nurse", "Manchester"), /l=Manchester/);
  });
});

describe("ranking", () => {
  it("drops must-have misses, scores signals, and dedupes Avery", async () => {
    let calls = 0;
    const runner: ActorRunner = async () => {
      calls += 1;
      return { items: [], run: null };
    };
    const result = await searchCandidates(spec, { token: "secret", runActor: runner, demo: true });

    assert.equal(calls, 0);
    assert.equal(result.mode, "sample");
    assert.deepEqual(
      result.candidates.map((candidate) => [candidate.name, candidate.score]),
      [
        ["Avery Lang", 60],
        ["Riley Chen", 47],
        ["Priya Shah", 32],
        ["Morgan Adeyemi", 0],
      ],
    );
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.validation.status),
      ["verified", "review", "review", "risk"],
    );
    assert.equal(matchIsOpen(80), true);
    assert.equal(matchIsOpen(79), false);
    assert.equal(result.spend.totalUsd, 0);
    assert.equal(result.spend.settled, true);
    assert.equal(result.stats.collected, 8);
    assert.equal(result.stats.afterDedupe, 6);
    assert.equal(result.stats.droppedForMustHave, 2);
    assert.equal(result.candidates[0]?.sources.length, 2);
    assert.equal(result.candidates[0]?.recentlyChangedJobs, true);
    assert.equal(result.candidates[0]?.competitorOrComplaintPost, true);
    assert.equal(result.candidates[1]?.cvFound, true);
    assert.equal(result.candidates.every((candidate) => candidate.sample), true);
    assert.match(result.candidates[0]?.why.map((reason) => reason.label).join(" "), /Must-have: Figma/);
    assert.match(result.candidates[0]?.why.map((reason) => reason.label).join(" "), /Greenhouse/);
  });

  it("matches phrases case-insensitively and dedupes by name and profile URL", () => {
    assert.equal(
      canonicalProfileUrl("https://www.linkedin.com/in/Sample-Avery-Lang/?miniProfileUrn=abc"),
      "linkedin.com/in/sample-avery-lang",
    );

    const ranked = rankCandidates(
      [
        raw({
          name: "Samira Okonkwo",
          haystack: "Figma, user research, design systems",
          sources: ["indeed-resume"],
          cvFound: true,
          profileUrl: null,
        }),
        raw({
          name: "Samira  Okonkwo",
          haystack: "design-systems and Figma. user research. B2B SaaS",
          profileUrl: "https://www.linkedin.com/in/samira/",
          recentlyChangedJobs: true,
        }),
      ],
      spec,
    );

    assert.equal(ranked.afterDedupe, 1);
    assert.equal(ranked.candidates[0]?.score, 32);
    assert.equal(ranked.candidates[0]?.validation.status, "review");
    assert.deepEqual(ranked.candidates[0]?.sources, ["indeed-resume", "linkedin-profile"]);
    assert.equal(dedupeCandidates([]).length, 0);
  });

  it("parses comma and newline lists", () => {
    assert.deepEqual(parsePhraseList("Figma, user research\ndesign systems, Figma"), [
      "Figma",
      "user research",
      "design systems",
    ]);
    const missing = parseSearchRequest({ location: "London" });
    assert.equal(missing.ok, false);
  });
});

describe("live failures", () => {
  it("keeps the other sources when Indeed fails or comes back empty", async () => {
    const calls: string[] = [];
    const runner: ActorRunner = async (actor) => {
      calls.push(actor);
      if (actor === ENRICH_ACTOR || actor === INDEED_ACTOR) {
        if (actor === INDEED_ACTOR) throw new Error("login wall");
        return { items: [], run: null };
      }
      if (actor === POST_ACTOR) {
        return {
          items: [
          {
            type: "post",
            content: "Greenhouse has been miserable this month.",
            author: {
              type: "profile",
              name: "Morgan Adeyemi",
              info: "Product designer",
              linkedinUrl: "https://www.linkedin.com/in/sample-morgan",
            },
          },
        ],
          run: null,
        };
      }
      return {
        items: [
          {
            firstName: "Avery",
            lastName: "Lang",
            position: "Senior Product Designer. Figma, user research, design systems, accessibility",
            linkedinUrl: "https://www.linkedin.com/in/sample-avery",
            location: { linkedinText: "London, United Kingdom" },
            summary: "Reach me at avery@example.com",
          },
        ],
        run: null,
      };
    };

    const result = await searchCandidates(
      { ...spec, useSampleData: false },
      { token: "server-token", runActor: runner },
    );

    assert.equal(result.mode, "live");
    assert.deepEqual(calls.sort(), [ENRICH_ACTOR, INDEED_ACTOR, POST_ACTOR, PROFILE_ACTOR].sort());
    assert.equal(result.candidates.some((candidate) => candidate.name === "Avery Lang"), true);
    assert.equal(result.candidates.some((candidate) => candidate.sample), false);
    assert.equal(
      result.candidates.some((candidate) => JSON.stringify(candidate).includes("avery@example.com")),
      false,
    );
    assert.equal(
      result.notices.some((notice) => notice.source === "indeed-resume" && notice.level === "warning"),
      true,
    );
    assert.match(result.notices.find((notice) => notice.source === "indeed-resume")?.message ?? "", /login wall/);
  });

  it("does not call actors without a token, and skips posts when no phrases are given", async () => {
    const calls: string[] = [];
    const runner: ActorRunner = async (actor) => {
      calls.push(actor);
      if (actor === INDEED_ACTOR || actor === ENRICH_ACTOR) return { items: [], run: null };
      return {
        items: [
          {
            firstName: "Priya",
            lastName: "Shah",
            headline: "Figma, user research, design systems",
            linkedinUrl: "https://www.linkedin.com/in/priya",
          },
        ],
        run: null,
      };
    };

    await assert.rejects(
      () => searchCandidates({ ...spec, useSampleData: true }, { token: "  ", runActor: runner }),
      MissingApifyTokenError,
    );
    assert.equal(calls.length, 0);

    calls.length = 0;
    const live = await searchCandidates(
      { ...spec, useSampleData: true, watchPhrases: [] },
      { token: "present", runActor: runner },
    );
    assert.deepEqual(calls, [PROFILE_ACTOR, INDEED_ACTOR, ENRICH_ACTOR]);
    assert.equal(live.mode, "live");
    assert.equal(
      live.notices.some((notice) => notice.source === "indeed-resume"),
      true,
    );
    assert.equal(live.candidates[0]?.name, "Priya Shah");
  });
});

describe("normalisers", () => {
  it("does not treat an Indeed job title as a person's name and strips contact details", () => {
    const resume = normaliseIndeedResume({
      name: "Lead Software Engineer",
      currentTitle: "Lead Software Engineer",
      location: "London",
      skills: ["Figma", "user research"],
      highlights: ["design systems"],
    });
    assert.equal(resume?.name, "Name not published");
    assert.equal(resume?.cvFound, true);
    assert.equal(resume?.profileUrl, null);

    const profile = normaliseLinkedInProfile({
      firstName: "Ada",
      lastName: "Lovelace",
      position: "Designer",
      summary: "Write to ada@example.com or 415-555-0134",
      linkedinUrl: "https://www.linkedin.com/in/ada",
      currentPositions: [{ title: "Designer", tenureAtPosition: { numMonths: 1 } }],
    });
    assert.equal(profile?.recentlyChangedJobs, true);
    assert.equal(profile?.snippet.includes("ada@example.com"), false);
    assert.match(profile?.snippet ?? "", /email removed/);
    assert.match(profile?.snippet ?? "", /phone removed/);
  });
});
