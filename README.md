# Interviewa candidate finder

A proof of concept for [Interviewa](https://interviewa.com), a two-way AI video screening platform. A recruiter pastes a job spec and gets a ranked shortlist drawn from public LinkedIn profiles, recent LinkedIn posts, and Indeed resumes.

The app does not email, message, or otherwise contact anyone. Profile links open the public page in a new tab. The app has no database of its own. Apify keeps the actor runs it executes, and the spend page reads those runs back.

Searches are live Apify calls only. There is no sample-data fallback. `APIFY_TOKEN` is set on Vercel for production and preview. A missing token or a failed actor call is shown as the real error. `OPENAI_API_KEY` is only used when reading a free-text spec and never changes search mode.

## What it does

1. The recruiter pastes or types a job spec into an empty box, or dictates it. The server reads that text into a title, location, pay band, must-haves, and nice-to-haves. An optional phrase list still drives post search. **Include Indeed** is on unless they turn it off.
2. A server route calls the [Apify API](https://api.apify.com/v2) with `APIFY_TOKEN`. The token never reaches the browser.
3. Three actors run in parallel via `Promise.all`. One failure does not drop the others. Limits are set for a shortlist of 10, not a wide scrape.
   - [`harvestapi/linkedin-profile-search`](https://apify.com/harvestapi/linkedin-profile-search) in `Short` mode (not Full, and never Full + email) with one search page and `maxItems: 10`.
   - [`harvestapi/linkedin-post-search`](https://apify.com/harvestapi/linkedin-post-search) with at most three watch phrases, `maxPosts: 5`, `postedLimit: "month"`, short profiles, and reactions and comments off. Skipped when no phrases are given.
   - [`lexis-solutions/resume-indeed-com-scraper`](https://apify.com/lexis-solutions/resume-indeed-com-scraper) for at most three resumes. The actor requires a US residential proxy. This source is best effort.
4. After the shortlist is ranked, up to ten people who have a LinkedIn profile URL are sent to [`harvestapi/linkedin-profile-scraper`](https://apify.com/harvestapi/linkedin-profile-scraper) in `Profile details no email ($4 per 1k)`. That call is only for work history, dates, and connection count. It does not search email.
5. Records are normalised to one shape: name, title, location, profile URL, source, and a signal or CV snippet. Duplicates collapse by profile URL and by normalised name.
6. Anyone missing a must-have is dropped. The match is a case-insensitive substring across title, headline, skills, summary, and snippet. The rest are scored on nice-to-haves, signals, and a profile check.

Signals, then the profile check:

| Signal | Points |
| --- | --- |
| Each nice-to-have match | 15, capped at 60 |
| Changed jobs in the last 90 days | 15 |
| Posted about a watched phrase | 15 |
| Public resume snippet | 10 |
| Profile check: verified consistent | 0 |
| Profile check: needs review | −8 |
| Profile check: high risk | −20 |

Salary is kept on the spec and shown in the summary. Public profiles rarely list pay, so it is not scored. The ranked list is at most 10 people.

You can speak the spec. A microphone button uses the browser Web Speech API (`en-GB`) and shows the live transcript. The recording is sent to `POST /api/parse-spec`, which fills the form for review. It does not start a search. While the mic is listening, “pause” or “pause bot” stops adding words and shows **Paused**. “continue”, “unpause”, or “unpause bot” resumes. Those words are never written into the spec. If `OPENAI_API_KEY` is set, `gpt-4o-mini` extracts the fields as JSON. If it is missing, or the model call fails, a built-in parser reads salaries, UK city names, and phrases after “must have”, “needs”, “essential”, “nice to have”, “ideally”, and “bonus”. That fallback does not switch the search into sample mode.

## Live only

The search box starts empty. Placeholder text is not a spec. The API does not serve sample profiles. If Apify or the token fails, the page shows that error. `Include Indeed` defaults to on.

## Apify spend

The log is at [`/spend`](/spend). It lists recent runs of the four actors above, grouped into a search when a small record in the Apify key-value store `interviewa-candidate-finder` ties their run ids together. That record stores the search id, time, job title, location, and run ids. It does not store candidate profiles. If the record is missing, runs that started within a few seconds of each other are grouped instead.

### How the charge is calculated

The total for a run is **`usageTotalUsd`**. Apify’s run object documents this as the amount you actually pay. For the run owner it includes platform usage and/or event costs depending on the pricing model.

Breakdown, in this order:

1. **`eventUsage[event].eventTotalUsd`** and **`eventTitle`**, when Apify includes them. These are the pay-per-event dollars, not a price we multiply ourselves.
2. If `eventUsage` is absent, **`chargedEventCounts` × `pricingInfo.pricingPerEvent.actorChargeEvents[event].eventPriceUsd`** for events that have a flat price on the run. Tier tables are not guessed.
3. **`usageUsd`** (compute, residential proxy, data transfer, and the other platform keys) only when the user pays it: `pricingInfo.isPPEPlatformUsagePaidByUser` is true, or the model is not pay-per-event and `usageUsd` is present. When that flag is false, platform usage is left out because it is not part of what you pay.
4. For a pay-per-result actor, **`pricePerUnitUsd` × item count** is used only when that product equals `usageTotalUsd` exactly.
5. If the lines above do not add up to `usageTotalUsd`, the difference is a remainder line, or the lines are scaled, until the sum matches to the micro-dollar. Scaled lines are marked **allocated**.

`accountedChargedEventCounts` lagging behind `chargedEventCounts`, a missing `usageTotalUsd`, or a run that has not finished means the charge is not final. The first response after a run finishes can still be preliminary, so the search waits about ten seconds and reads the run again when the time budget allows. `/spend` always reads the run again. Sample mode never creates a run.

### Attribution

Each dataset item gets a share of its run.

- A pay-per-event line whose count equals the number of dataset items is that item’s **per-event charge**.
- Actor-start events, a single search-page event covering many profiles, platform usage, and any remainder are split equally across the items and marked **allocated**.
- One item that supplies more than one field (for example profile and work history from the same search-page charge, or CV and work history from one Indeed resume) splits that item’s dollars across the fields and those field lines are marked **allocated**.
- The profile-detail actor’s per-profile event is the work-history charge.
- People who miss a must-have, or items that do not normalise, stay in **Not on the shortlist** so the candidate lines plus that remainder still equal `usageTotalUsd`.

## Profile check

Each person is checked against the public fields we actually received. The status is **Verified consistent**, **Needs review**, or **High risk**, with the evidence listed. The wording stays neutral: public data can raise a flag, it cannot prove fraud, and a person makes the final call.

The check looks for date ranges that end before they start, overlapping employers, several very short roles, seniority that the dated history does not support, LinkedIn and Indeed disagreeing on the current employer or location, a low connection count, an empty dated history, and a must-have such as “at least 2 years B2B sales” when the dated roles do not cover it. Verified requires at least one dated role and none of those flags.

## Expected cost per search

Published free-plan event prices as of this writing. The page shows the run’s `usageTotalUsd`, which can differ with your Apify plan. Confirm the actor pricing pages before a live run.

| Actor | What this app requests | Published free-plan events | Expected |
| --- | --- | --- | --- |
| LinkedIn profile search | Short mode, 1 page, at most 10 profiles. Not Full, never email. | 1 × search page at $0.10 | **$0.10** |
| LinkedIn post search | At most 3 phrases, 5 posts, no reactions, comments, or full profiles. Skipped with no phrases. | 5 × post at $0.002, actor start about $0.00005, plus $0.001 for an empty query | **about $0.01 to $0.02**, or $0 if skipped |
| Indeed resumes | At most 3 resumes. US residential proxy is required by the actor. | Actor start $0.01 + 3 × resume at $0.049 | **about $0.16** in events, plus residential proxy traffic if Apify bills it on the run |
| LinkedIn profile detail | Only the final shortlist, and only profiles with a LinkedIn URL, at most 10. No email search. | $0.004 × N profiles | **$0.04** at 10, less when fewer URLs survive |

A search with posts, three resumes, and ten profile-detail calls is about **$0.32 in published events before residential proxy**. Indeed’s proxy transfer is the part that can still jump. With no watch phrases the post actor is not called. With no LinkedIn URLs the detail actor is not called.

### Ways to cut it further

- Skip Indeed. That removes the $0.16 event block and the residential proxy, which is the expensive unknown. The shortlist would be LinkedIn only.
- Ask Indeed for one resume instead of three if a single CV signal is enough.
- Leave the watch-phrase box empty when you do not need posts.
- Skip the profile-detail call. Validation then uses only the short profile, the post, and the resume, and more people will land on Needs review because dates are missing.
- Move the Apify account up a tier. Indeed resumes drop to $0.039 / $0.029 / $0.019 on Bronze / Silver / Gold. The LinkedIn search page drops below $0.10 on higher tiers. Post events drop as well.
- Do not raise `takePages`, `maxItems`, or turn on full-profile or email modes. Do not enable post reactions, comments, or full-profile enrichment. Do not enable LinkedIn auto query segmentation: each extra search page is another $0.10.

Grouping uses one key-value write per search in the store you already have. That is a fraction of a cent of platform usage and is not a new service or a new environment variable. It is not part of an actor run’s `usageTotalUsd`.

## Setup

```bash
npm install
```

Create `.env.local` from the example:

```bash
cp .env.example .env.local
```

`APIFY_TOKEN` is required. Without it, the page shows that the token is missing.

`OPENAI_API_KEY` is optional. Without it, spoken specs are parsed with the built-in rules. Do not prefix either variable with `NEXT_PUBLIC_`.

Create a token at [Apify Console → Integrations](https://console.apify.com/settings/integrations).

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The spend log is [http://localhost:3000/spend](http://localhost:3000/spend).

```bash
npm test
npm run build
```

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Framework preset: Next.js. No extra build settings.
3. `APIFY_TOKEN` is already set for production and preview. `OPENAI_API_KEY` is optional and only used by the speech parser.
4. Deploy.

The search route sets `maxDuration = 300` so a live run can wait on Apify and then read the run’s charge. Vercel Hobby caps functions at 60 seconds. On Hobby, lower `maxDuration` in `app/api/search/route.ts` to `60` and `ACTOR_TIMEOUT_SECS` in `lib/actors.ts` to something under that. Pro plans accept 300 seconds.

The route starts each actor with `POST /v2/acts/{actorId}/runs`, polls `GET /v2/actor-runs/{runId}` until it finishes, waits about ten seconds, reads the run again for `usageTotalUsd`, then reads `GET /v2/datasets/{datasetId}/items`. Actors in one search run in parallel, so the wait is the slowest actor, not the sum. The profile-detail call runs after the shortlist and is skipped if the function is nearly out of time.

## Limitations

- **Public data only.** The shortlist is whatever those actors return. Nobody is contacted, and the product has no outreach, email, or messaging.
- **Indeed is unreliable and the costly source.** `lexis-solutions/resume-indeed-com-scraper` is poorly rated. `resumes.indeed.com` often needs an employer login. The actor requires a US residential proxy even for a London search. If it fails or returns nothing, the page says so and still shows the LinkedIn results. Proxy traffic can exceed the event prices above.
- **LinkedIn terms.** These actors are independent of LinkedIn. Using them may conflict with LinkedIn’s user agreement. This demo is for evaluation, not a production sourcing pipeline.
- **UK GDPR.** The app does not keep its own database of people. Apify retains the actor run and its dataset in the account that owns `APIFY_TOKEN`. The spend page reads that data, including names on the dataset items, so you can see what a run cost. The grouping record stores the job title and location, not candidate profiles. Names, titles, and profile URLs are personal data. Using the list to make decisions about real people needs a lawful basis under UK GDPR. Public availability is not that basis. A high-risk flag is not a finding of fraud.
- **Short profiles.** The first profile search uses Short mode. Work-history dates usually come from the later profile-detail call, and only for people who already made the shortlist.
- **Keyword match is literal.** "Figma" matches a substring. It does not understand synonyms.
- **Name dedupe can collapse two people** who share a normalised name.
- **Pause words are commands.** Saying “continue” or “pause” while dictating a spec will not type those words. Phrase the sentence without them.

## Project layout

- `app/page.tsx` — recruiter UI. The spec box starts empty.
- `app/spend/page.tsx` — Apify spend log
- `app/api/search/route.ts` — candidate search
- `app/api/parse-spec/route.ts` — spoken spec parser
- `lib/parse-speech.ts` — OpenAI JSON extraction and the rule-based fallback
- `lib/speech-control.ts` — pause and resume words
- `lib/actors.ts` — actor ids, limits, and input builders
- `lib/apify.ts` — REST client
- `lib/charge.ts` — `usageTotalUsd` and the event breakdown
- `lib/attribute.ts` — per-candidate and per-field attribution
- `lib/validate.ts` — profile check
- `lib/search.ts` — parallel runs, enrichment, and failure handling
- `lib/spend-log.ts` — run history for `/spend`
- `lib/normalise.ts`, `lib/rank.ts`, `lib/sample.ts` — shared candidate shape, scoring, and sample data
