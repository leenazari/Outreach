import type { ActorPlan, ParsedSpec } from "./types";

export const PROFILE_ACTOR = "harvestapi/linkedin-profile-search";
export const POST_ACTOR = "harvestapi/linkedin-post-search";
export const INDEED_ACTOR = "lexis-solutions/resume-indeed-com-scraper";

export const PROFILE_MAX_ITEMS = 10;
export const POST_MAX_POSTS = 10;
export const INDEED_MAX_ITEMS = 10;
export const RESULT_LIMIT = 10;
export const ACTOR_TIMEOUT_SECS = 240;

export function buildIndeedResumeSearchUrl(title: string, location: string): string {
  const params = new URLSearchParams({
    q: title,
    l: location,
    nl: "false",
    start: "0",
    sort: "date",
  });
  return `https://resumes.indeed.com/search?${params.toString()}`;
}

export function buildActorPlans(spec: ParsedSpec): ActorPlan[] {
  const postSkipped = spec.watchPhrases.length === 0;

  return [
    {
      actor: PROFILE_ACTOR,
      purpose:
        "People whose current title and location match the spec, limited to those who changed jobs in the last 90 days. Short profiles keep the search on one results page.",
      skipped: false,
      input: {
        profileScraperMode: "Short",
        searchQuery: spec.jobTitle,
        maxItems: PROFILE_MAX_ITEMS,
        locations: [spec.location],
        currentJobTitles: [spec.jobTitle],
        recentlyChangedJobs: true,
        takePages: 1,
      },
    },
    {
      actor: POST_ACTOR,
      purpose:
        "Recent posts that mention the competitor tools or complaint phrases. Skipped when that list is empty. Reactions and comments stay off.",
      skipped: postSkipped,
      input: postSkipped
        ? null
        : {
            searchQueries: spec.watchPhrases,
            maxPosts: POST_MAX_POSTS,
            postedLimit: "month",
            sortBy: "date",
            profileScraperMode: "short",
            scrapeReactions: false,
            scrapeComments: false,
          },
    },
    {
      actor: INDEED_ACTOR,
      purpose:
        "Best-effort Indeed resume search built from the title and location. The actor asks for a US residential proxy even when the role is elsewhere, and the site may require an employer login.",
      skipped: false,
      input: {
        startUrls: [{ url: buildIndeedResumeSearchUrl(spec.jobTitle, spec.location) }],
        maxItems: INDEED_MAX_ITEMS,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"],
          apifyProxyCountry: "US",
        },
      },
    },
  ];
}
