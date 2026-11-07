# Interviewa candidate finder

A proof of concept for [Interviewa](https://interviewa.com), a two-way AI video screening platform. A recruiter pastes a job spec and gets a ranked shortlist drawn from public LinkedIn profiles, recent LinkedIn posts, and Indeed resumes.

The app does not email, message, or otherwise contact anyone. Profile links open the public page in a new tab. Nothing is stored.

## What it does

1. The recruiter enters a job title, location, salary range, must-haves, nice-to-haves, and an optional list of competitor tools or complaint phrases.
2. A server route calls the [Apify API](https://api.apify.com/v2) with `APIFY_TOKEN`. The token never reaches the browser.
3. Three actors run in parallel via `Promise.allSettled`. One failure does not drop the others.
   - [`harvestapi/linkedin-profile-search`](https://apify.com/harvestapi/linkedin-profile-search) with `locations`, `currentJobTitles`, `recentlyChangedJobs`, and `maxItems: 10`.
   - [`harvestapi/linkedin-post-search`](https://apify.com/harvestapi/linkedin-post-search) with `searchQueries` built from the watch phrases, `maxPosts: 10`, and `postedLimit: "month"`. Skipped when no phrases are given.
   - [`lexis-solutions/resume-indeed-com-scraper`](https://apify.com/lexis-solutions/resume-indeed-com-scraper) with a `resumes.indeed.com` `startUrls` entry built from the title and location, `maxItems: 10`, and `proxyConfiguration`. This actor is best effort.
4. Records are normalised to one shape: name, title, location, profile URL, source, and a signal or CV snippet. Duplicates collapse by profile URL and by normalised name.
5. Anyone missing a must-have is dropped. The match is a case-insensitive substring across title, headline, skills, summary, and snippet. The rest are scored on nice-to-haves and signals, with a short why-breakdown.

Signals:

| Signal | Points |
| --- | --- |
| Each nice-to-have match | 15, capped at 60 |
| Changed jobs in the last 90 days | 15 |
| Posted about a watched phrase | 15 |
| Public resume snippet | 10 |

Salary is kept on the spec and shown in the summary. Public profiles rarely list pay, so it is not scored. Each search returns at most 10 ranked people, and each actor is capped at 10 items.

You can speak the spec. A microphone button uses the browser Web Speech API (`en-GB`) and shows the live transcript. The recording is sent to `POST /api/parse-spec`, which fills the form for review. It does not start a search. If `OPENAI_API_KEY` is set, a small model (`gpt-4o-mini`) extracts the fields as JSON. If it is missing, or the model call fails, a built-in parser reads salaries (`45 grand`, `45k`, `£45,000`), UK city names, and phrases after “must have”, “needs”, “essential”, “nice to have”, “ideally”, and “bonus”. Job titles come from “looking for a …”.

## Sample mode

Turn on **Use sample data**, or run without `APIFY_TOKEN`. The API returns fictional profiles through the same ranker and labels them **Sample data**. No actors are called and no credits are spent.

The form is prefilled with a London Sales Executive spec: £40,000 to £50,000, three must-haves (based in London, at least two years of B2B sales, a full UK driving licence), and three nice-to-haves (SaaS or tech sales, CRM tools, a job change in the last six months).

## Setup

```bash
npm install
```

Create `.env.local` from the example:

```bash
cp .env.example .env.local
```

`APIFY_TOKEN` is optional. Without it, every search uses sample data.

`OPENAI_API_KEY` is optional. Without it, spoken specs are parsed with the built-in rules instead of a model. Do not prefix either variable with `NEXT_PUBLIC_`.

Create a token at [Apify Console → Integrations](https://console.apify.com/settings/integrations). Do not prefix it with `NEXT_PUBLIC_`.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run build
```

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Framework preset: Next.js. No extra build settings.
3. Add `APIFY_TOKEN` under Project → Settings → Environment Variables. Leave it empty if you only want the sample demo. `OPENAI_API_KEY` is optional and only used by the speech parser.
4. Deploy.

The search route sets `maxDuration = 300` so a live run can wait on Apify. Vercel Hobby caps functions at 60 seconds. On Hobby, lower `maxDuration` in `app/api/search/route.ts` to `60` and `ACTOR_TIMEOUT_SECS` in `lib/actors.ts` to something under that, or the platform will reject the higher limit. Pro plans accept 300 seconds.

The route uses the Node.js runtime and `POST /v2/acts/{actorId}/run-sync-get-dataset-items`. Actors run in parallel, so the wait is the slowest actor, not the sum.

## Rough Apify cost per search

Prices below are the public free-plan rates at the time of writing. Store discounts on paid plans are lower. Confirm them on each actor page before a live run.

| Source | What this app requests | Rough free-plan cost |
| --- | --- | --- |
| LinkedIn profile search | 1 page, up to 10 short profiles (`profileScraperMode: "Short"`) | about $0.10 per search page |
| LinkedIn post search | up to 5 phrases × 10 posts from the last month, no reactions or comments | about $0.002 per post, so about $0.10, plus a tiny actor-start fee |
| Indeed resumes | up to 10 resumes | about $0.049 per resume on the free plan (about $0.50) plus residential proxy traffic, which Apify bills separately and is often the expensive part |

A cautious live search is often under $1 when Indeed returns nothing. It can climb if the residential proxy is busy. Sample mode costs nothing. This app never selects `Full + email search`.

## Limitations

- **Public data only.** The shortlist is whatever those actors return. Nobody is contacted, and the product has no outreach, email, or messaging.
- **Indeed is unreliable.** `lexis-solutions/resume-indeed-com-scraper` is poorly rated (about 2/5). `resumes.indeed.com` often needs an employer login. The actor also asks for a US residential proxy even for a London search. If it fails or returns nothing, the page says so and still shows the LinkedIn results.
- **LinkedIn terms.** These actors are independent of LinkedIn. Using them may conflict with LinkedIn’s user agreement. This demo is for evaluation, not a production sourcing pipeline.
- **UK GDPR.** Results are not stored. Names, titles, and profile URLs are personal data. Keeping a database of them, or using the list to make decisions about real people, needs a lawful basis under UK GDPR. Public availability is not that basis.
- **Short profiles.** Profile search uses Short mode to cap cost. Must-have matching can only see fields the actor actually returns, which may be a headline rather than skills and a summary.
- **Keyword match is literal.** "Figma" matches a substring. It does not understand synonyms.
- **Name dedupe can collapse two people** who share a normalised name.

## Project layout

- `app/page.tsx` — recruiter UI
- `app/api/search/route.ts` — candidate search
- `app/api/parse-spec/route.ts` — spoken spec parser
- `lib/parse-speech.ts` — OpenAI JSON extraction and the rule-based fallback
- `lib/actors.ts` — actor ids and input builders
- `lib/apify.ts` — REST client
- `lib/search.ts` — parallel runs and failure handling
- `lib/normalise.ts`, `lib/rank.ts`, `lib/sample.ts` — shared candidate shape, scoring, and sample data
