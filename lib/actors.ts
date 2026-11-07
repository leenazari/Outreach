import type { ActorPlan, ParsedSpec } from "./types";
import { canonicalProfileUrl } from "./text";

export const PROFILE_ACTOR = "harvestapi/linkedin-profile-search";
export const POST_ACTOR = "harvestapi/linkedin-post-search";
export const INDEED_ACTOR = "lexis-solutions/resume-indeed-com-scraper";
export const ENRICH_ACTOR = "harvestapi/linkedin-profile-scraper";
export const ENRICH_MODE = "Profile details no email ($4 per 1k)";
export const ENRICH_EMAIL_MODE = "Profile details + email search ($10 per 1k)";

export const PROFILE_MAX_ITEMS = 10;
export const PROFILE_PAGE_ITEMS = 25;
export const POST_MAX_POSTS = 5;
export const OPEN_TO_WORK_MAX_POSTS = 15;
export const INDEED_MAX_ITEMS = 3;
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

export function openToWorkQueries(spec: Pick<ParsedSpec, "jobTitle" | "location">): string[] {
  const title = spec.jobTitle.trim();
  if (!title) return [];
  const location = spec.location.trim();
  return [
    location ? `"open to work" ${title} ${location}` : `"open to work" ${title}`,
    `"looking for my next role" ${title}`,
  ];
}

export function buildActorPlans(spec: ParsedSpec): ActorPlan[] {
  const openQueries = spec.openToWork === true ? openToWorkQueries(spec) : [];
  const postQueries = [...openQueries, ...spec.watchPhrases];
  const postSkipped = postQueries.length === 0;

  return [
    {
      actor: PROFILE_ACTOR,
      purpose:
        spec.openToWork === true
          ? "One full page of short profiles for this title and location. LinkedIn does not offer an Open to Work filter outside Recruiter, so the page stays at 25 profiles and the same search-page price."
          : "People whose current title and location match the spec. Short profiles keep the search on one results page. The recent-job-change filter is off unless the form turns it on.",
      skipped: false,
      input: {
        profileScraperMode: "Short",
        searchQuery: spec.jobTitle,
        maxItems: spec.openToWork === true ? PROFILE_PAGE_ITEMS : PROFILE_MAX_ITEMS,
        ...(spec.location ? { locations: [spec.location] } : {}),
        currentJobTitles: [spec.jobTitle],
        recentlyChangedJobs: spec.recentlyChangedJobs === true,
        takePages: 1,
      },
    },
    {
      actor: POST_ACTOR,
      purpose:
        openQueries.length > 0
          ? "Posts from the last month where someone says they are open to work or looking for their next role, plus any competitor phrases. At most fifteen posts."
          : "Recent posts that mention the competitor tools or complaint phrases. Skipped when that list is empty. At most five posts, with reactions, comments, and full-profile enrichment left off.",
      skipped: postSkipped,
      input: postSkipped
        ? null
        : {
            searchQueries: postQueries,
            maxPosts: openQueries.length > 0 ? OPEN_TO_WORK_MAX_POSTS : POST_MAX_POSTS,
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
        "Experimental Indeed resume search for at most three resumes. The actor requires a US residential proxy, often returns nothing, and a failed start is still billed. Skipped when Include Indeed is off.",
      skipped: spec.includeIndeed !== true,
      input: spec.includeIndeed !== true ? null : {
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

export function actorLabel(actor: string): string {
  if (actor === PROFILE_ACTOR) return "LinkedIn profile search";
  if (actor === POST_ACTOR) return "LinkedIn post search";
  if (actor === INDEED_ACTOR) return "Indeed resumes";
  if (actor === ENRICH_ACTOR) return "LinkedIn profile detail";
  return actor;
}

export function buildEnrichInput(urls: string[], includeEmail = false): Record<string, unknown> {
  return {
    profileScraperMode: includeEmail ? ENRICH_EMAIL_MODE : ENRICH_MODE,
    queries: urls.slice(0, RESULT_LIMIT),
  };
}

export function linkedinProfileUrls(candidates: { profileUrl: string | null }[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    const raw = candidate.profileUrl?.trim();
    if (!raw || !/linkedin\.com\/in\//i.test(raw)) continue;
    const key = canonicalProfileUrl(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const bare = raw.split("?")[0] ?? raw;
    urls.push(bare);
    if (urls.length >= RESULT_LIMIT) break;
  }
  return urls;
}
