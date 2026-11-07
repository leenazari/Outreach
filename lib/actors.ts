import type { ActorPlan, ParsedSpec } from "./types";
import { canonicalProfileUrl } from "./text";
import { extractTitle } from "./parse-speech";

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
export const RESULT_LIMIT = 25;
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

export const SEARCH_QUERY_MAX = 80;

export function shortJobTitle(title: string): string {
  const derived = extractTitle(title);
  const words = (derived || title).replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return words.join(" ").slice(0, SEARCH_QUERY_MAX);
}

function coreKeywords(spec: Pick<ParsedSpec, "jobTitle" | "mustHave" | "niceToHave">, title: string): string[] {
  const keywords: string[] = [];
  const titleKey = title.toLowerCase();
  for (const phrase of [...spec.mustHave, ...spec.niceToHave]) {
    if (keywords.length >= 2) break;
    const cleaned = phrase.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length > 24 || (/\d/.test(cleaned) && /year/i.test(cleaned))) continue;
    if (titleKey.includes(cleaned.toLowerCase())) continue;
    keywords.push(cleaned);
  }
  return keywords;
}

export function buildProfileSearchQuery(spec: Pick<ParsedSpec, "jobTitle" | "mustHave" | "niceToHave">): string {
  const title = shortJobTitle(spec.jobTitle);
  const query = [title, ...coreKeywords(spec, title)].join(" ").replace(/\s+/g, " ").trim();
  return query.slice(0, SEARCH_QUERY_MAX);
}

function capPhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX);
}

export function openToWorkQueries(spec: Pick<ParsedSpec, "jobTitle" | "location">): string[] {
  const title = shortJobTitle(spec.jobTitle);
  if (!title) return [];
  const location = spec.location.trim();
  const withPlace = location ? `"open to work" ${title} ${location}` : `"open to work" ${title}`;
  return [capPhrase(withPlace), capPhrase(`"looking for my next role" ${title}`)];
}

function firstWords(value: string, count: number): string {
  return value.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean).slice(0, count).join(" ").slice(0, 40);
}

export function shortenActorInput(input: Record<string, unknown>): Record<string, unknown> {
  const next = { ...input };
  if (typeof next.searchQuery === "string") next.searchQuery = firstWords(next.searchQuery, 2);
  if (Array.isArray(next.currentJobTitles)) {
    next.currentJobTitles = next.currentJobTitles.map((item) => (typeof item === "string" ? firstWords(item, 2) : item));
  }
  if (Array.isArray(next.searchQueries)) {
    next.searchQueries = next.searchQueries.map((item) => (typeof item === "string" ? capPhrase(item).slice(0, 40) : item));
  }
  if (Array.isArray(next.startUrls)) {
    next.startUrls = next.startUrls.map((item) => {
      if (!item || typeof item !== "object" || !("url" in item) || typeof item.url !== "string") return item;
      try {
        const parsed = new URL(item.url);
        const query = parsed.searchParams.get("q");
        if (query) parsed.searchParams.set("q", firstWords(query, 2));
        return { ...item, url: parsed.toString() };
      } catch {
        return item;
      }
    });
  }
  return next;
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
        searchQuery: buildProfileSearchQuery(spec),
        maxItems: spec.openToWork === true ? PROFILE_PAGE_ITEMS : PROFILE_MAX_ITEMS,
        ...(spec.location ? { locations: [spec.location] } : {}),
        currentJobTitles: [shortJobTitle(spec.jobTitle)],
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
            searchQueries: postQueries.map((phrase) => capPhrase(phrase)),
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
        startUrls: [{ url: buildIndeedResumeSearchUrl(shortJobTitle(spec.jobTitle), spec.location) }],
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
