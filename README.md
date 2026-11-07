# Interviewa candidate finder

A proof of concept for [Interviewa](https://interviewa.com), a two-way AI video screening platform. A recruiter pastes a job spec and gets a ranked shortlist drawn from public LinkedIn profiles, recent LinkedIn posts, and Indeed resumes.

The app does not email, message, or otherwise contact anyone. Profile links open the public page in a new tab. The app has no database of its own. Apify keeps the actor runs it executes, and the spend page reads those runs back.

Searches are live Apify calls only. There is no sample-data fallback. `APIFY_TOKEN` is set on Vercel for production and preview. A missing token or a failed actor call is shown as the real error. `OPENAI_API_KEY` is only used when reading a free-text spec and never changes search mode.

## What it does

1. The recruiter pastes or types a job spec into an empty box, or dictates it. The server reads that text into a title, location, pay band, must-haves, and nice-to-haves, and the form fills those fields so they can be checked before Search. A field the recruiter edits is left as they left it when the spec is parsed again. **Open to Work** is on unless they turn it off. **Include Indeed** stays off unless they turn it on. The button shows an estimated Apify cost for the toggles that are on. The full spec is kept for scoring. Actor queries use a short title (at most 80 characters) plus the location field, and the results page shows that condensed search, for example “Searched LinkedIn for: marketing executive, London”. A query the actor rejects as too long is sent once more with a shorter title.
2. A server route calls the [Apify API](https://api.apify.com/v2) with `APIFY_TOKEN`. The token never reaches the browser.
3. The actors run in parallel via `Promise.all`. One failure does not drop the others. The shortlist shows up to 25 people.
   - [`harvestapi/linkedin-profile-search`](https://apify.com/harvestapi/linkedin-profile-search) in `Short` mode, one page. Open to Work uses `maxItems: 25` (a full page, same $0.10). Otherwise `maxItems: 10`. LinkedIn does not offer an Open to Work filter outside Recruiter seats. Short profiles only carry `openProfile`, which is not that flag.
   - [`harvestapi/linkedin-post-search`](https://apify.com/harvestapi/linkedin-post-search). With Open to Work on, the queries are `"open to work" <title> <location>` and `"looking for my next role" <title>`, `maxPosts: 15`, `postedLimit: "month"`, about $0.002 a post. Watch phrases are added to that run when they are filled in. With the toggle off, posts run only for watch phrases and stop at five.
   - [`lexis-solutions/resume-indeed-com-scraper`](https://apify.com/lexis-solutions/resume-indeed-com-scraper) for at most three resumes when Include Indeed is on. The actor requires a US residential proxy. This source is best effort.
4. Every returned LinkedIn profile, up to 25, goes to [`harvestapi/linkedin-profile-scraper`](https://apify.com/harvestapi/linkedin-profile-scraper) in `Profile details no email ($4 per 1k)`, about $0.004 each. A person whose location is clearly outside the spec's commute (about 50 miles in the UK, or the same country when the spec says remote) is excluded before that call. The full profile's `openToWork` boolean adds an Open to Work badge. A post author is deduped against the profile results by member id or profile URL, and the post link is kept as evidence.
5. Records are normalised to one shape: name, title, location, profile URL, source, and a signal or CV snippet. Duplicates collapse by profile URL and by normalised name.
6. Must-haves are score criteria, not a hard filter. A short profile that does not mention a requirement is scored as unknown (“not in short profile”), not zero, and stays in the match list. The only hard drop is a clear country contradiction. The rest are scored on title, skills, experience, location, seniority, recency, and the profile check.

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

## Match score

Every person who passes the must-have keyword gate gets a 0–100 match score from `lib/match.ts`. The weights live in `MATCH_WEIGHTS` and sum to 100. Each criterion is scored 0–100, then adds `(score / 100) × weight` points:

| Criterion | Weight | What it compares |
| --- | --- | --- |
| Job title | 25 | Shared words between the spec title and the person's title |
| Skills | 25 | Share of must-haves and nice-to-haves found on the public record. 100 if the spec names none |
| Experience | 15 | Dated months against a years requirement in the spec, or against a two-year default |
| Location | 15 | Whether the public location lines up with the spec |
| Seniority | 10 | How far the title's seniority sits from the spec title |
| Recency | 10 | A recent job change, or a current role that started within 18 months |

High risk caps the score at 49. Needs review does not. Every candidate is shown with the name, profile URL, photo, and source URL the actor returned. The card shows the current company from the full profile, or from the short profile’s current position, rather than a sector guessed from the title. The profile link is `linkedin.com/in/<publicIdentifier>` when the source has one, and the ACwAA link otherwise.

After the short-profile search, up to 25 people who are not outside the commute are sent together to `harvestapi/linkedin-profile-scraper` in full-profile mode with no email, about $0.004 each. Each enriched profile is then scored by a cheap model through Vercel AI Gateway. The score on the card is that model's overall. If the model call fails, the card keeps the older heuristic and says so. A profile that only has an ACwAA id is still included. The full profile is merged back by that id or by `objectUrn` / `entityUrn`, then scored again from skills, about, experience, and current company. A stated industry that clearly conflicts with the spec (for example commercial aviation or luxury jewellery retail against B2B SaaS) scores skills at 0 and caps the overall match at 40 once the full profile is in. A short profile with only the current role is Needs review when the dates are too thin to support a stronger finding. A criterion with no data is left out of the total and shown as “not assessed”; the remaining weights are scaled back to 100. Email search ($0.01) runs for those same profiles only when the email switch is on. Include Indeed is off unless the form turns it on. This app does not log into Indeed.

### Interviewa export

`GET /api/candidates/export` returns every candidate from the latest live search as JSON. `GET /api/candidates/export?format=csv` returns the same rows as CSV. When `INTERVIEWA_WEBHOOK_URL` is set, that JSON is also POSTed after the search, with header `X-Interviewa-Webhook-Secret` set to `INTERVIEWA_WEBHOOK_SECRET`. If the URL is unset, the webhook is not called.

```json
{
  "product": "Interviewa candidate finder",
  "generatedAt": "2026-11-07T12:00:00.000Z",
  "searchId": "uuid",
  "jobTitle": "Sales Executive",
  "location": "London",
  "candidates": [
    {
      "source": "linkedin-profile",
      "score": 91,
      "subScores": [{ "criterion": "title", "weight": 25, "score": 100, "reason": "The title lines up with the spec." }],
      "validationStatus": "verified",
      "name": "Avery Lang",
      "profileUrl": "https://www.linkedin.com/in/example",
      "email": null,
      "summary": "Public snippet",
      "costAttributedUsd": 0.014,
      "sourceUrl": null,
      "title": "Sales Executive",
      "company": "Northwind",
      "locationRegion": "United Kingdom",
      "skills": ["B2B sales"]
    }
  ]
}
```

You can dictate the spec. **Start recording** uses the browser Web Speech API (`en-GB`) and shows a recording indicator with the live words. **Stop recording** puts that transcript into the job spec box, where it can be edited. It does not start a search. After typing pauses, a paste, or Stop recording, the form is filled by `google/gemini-2.5-flash-lite` through AI Gateway. The regex parser is used only if that call fails. Token cost for that read is listed on `/spend`. On Android the recogniser runs one utterance at a time and restarts while recording is still on, and cumulative interim results replace the previous interim instead of being appended. If the form fields are still empty when Search is pressed, the built-in parser fills the gaps. That does not switch the search into sample mode.

## Live only

The search box starts with the last spec kept in this browser, when there is one. Placeholder text is not a spec. The API does not serve sample profiles. If Apify or the token fails, the page shows that error. `Include Indeed` defaults to on.

## Apify spend

The last form is kept in the browser and filled in again on the next visit. **Rerun last search** runs that spec again. The five newest server searches are listed on the form; choosing one loads its spec. `POST /api/searches/{searchId}/rerun` runs a stored spec. `GET /api/searches` lists those five, including each search id.

The log is at [`/spend`](/spend). It lists recent runs of the four actors above, grouped into a search when a small record in the Apify key-value store `interviewa-candidate-finder` ties their run ids together. That record stores the search id, time, job title, location, the submitted form, and run ids. It does not store candidate profiles. If the record is missing, runs that started within a few seconds of each other are grouped instead.

### How the charge is calculated

The total for a run is **`usageTotalUsd`**. Apify’s run object documents this as the amount you actually pay. For the run owner it includes platform usage and/or event costs depending on the pricing model.

Breakdown, in this order:

1. **`eventUsage[event].eventTotalUsd`** and **`eventTitle`**, when Apify includes them. These are the pay-per-event dollars, not a price we multiply ourselves.
2. If `eventUsage` is absent, **`chargedEventCounts` × `pricingInfo.pricingPerEvent.actorChargeEvents[event].eventPriceUsd`** for events that have a flat price on the run. Tier tables are not guessed.
3. **`usageUsd`** (compute, residential proxy, data transfer, and the other platform keys) only when the user pays it: `pricingInfo.isPPEPlatformUsagePaidByUser` is true, or the model is not pay-per-event and `usageUsd` is present. When that flag is false, platform usage is left out because it is not part of what you pay.
4. For a pay-per-result actor, **`pricePerUnitUsd` × item count** is used only when that product equals `usageTotalUsd` exactly.
5. If the lines above do not add up to `usageTotalUsd`, the difference is a remainder line, or the lines are scaled, until the sum matches to the micro-dollar. Scaled lines are marked **allocated**.

`accountedChargedEventCounts` lagging behind `chargedEventCounts`, a missing `usageTotalUsd`, or a run that has not finished means the charge is not final. The first response after a run finishes can still be preliminary, so the search re-reads the run every couple of seconds until `usageTotalUsd` and the charged event counts stop changing. If that total is still below `chargedEventCounts` times the run’s own event price, the log uses the computed event charge. `/spend` always reads the run again. Sample mode never creates a run.

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
| LinkedIn profile search | Short mode, 1 page. Open to Work asks for 25 profiles; otherwise 10. Still one search page. Not Full, never email on this actor. | 1 × search page at $0.10 | **$0.10** |
| LinkedIn post search | Open to Work adds two queries and up to 15 posts. Watch phrases alone stay at 5 posts. No reactions or comments. | 15 × post at $0.002, or 5 × $0.002 | **$0.03** with Open to Work, **about $0.01** for watch phrases only, or $0 if both are off |
| Indeed resumes | At most 3 resumes, and only when Include Indeed is on. US residential proxy is required by the actor. | Actor start $0.01 + 3 × resume at $0.049 | **about $0.16** in events, plus residential proxy traffic if Apify bills it on the run |
| LinkedIn profile detail | Top `ENRICH_TOP_N` at 50 or above, default 10, no email unless that switch is on. | $0.004 × N profiles | **$0.04** at 10, less when fewer URLs clear 50 |

With Open to Work on, Indeed off, and email off, the estimate next to the button is **$0.25**: the $0.10 page, $0.10 for up to 25 full profiles, $0.03 for fifteen posts, and about $0.02 for the AI match. The spend log records each actor run’s `usageTotalUsd` and the AI token cost for that search. A search that also includes Indeed is about **$0.41** in published events before residential proxy.

### Ways to cut it further

- Skip Indeed. That removes the $0.16 event block and the residential proxy, which is the expensive unknown. The shortlist would be LinkedIn only.
- Ask Indeed for one resume instead of three if a single CV signal is enough.
- Leave the watch-phrase box empty when you do not need posts.
- Skip the profile-detail call. Validation then uses only the short profile, the post, and the resume, and more people will land on Needs review because dates are missing.
- Move the Apify account up a tier. Indeed resumes drop to $0.039 / $0.029 / $0.019 on Bronze / Silver / Gold. The LinkedIn search page drops below $0.10 on higher tiers. Post events drop as well.
- Turn Open to Work off when a page of 10 is enough. That drops the post search and keeps `maxItems` at 10. The profile page price stays $0.10 either way.
- Do not raise `takePages` past 1, and do not turn on full-profile or email modes on the search actor. Do not enable post reactions, comments, or LinkedIn auto query segmentation: each extra search page is another $0.10.

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

AI matching calls Vercel AI Gateway through the AI SDK. On Vercel the request OIDC token is read by `@vercel/oidc`. Locally, set `AI_GATEWAY_API_KEY`, or link the project and run `vercel env pull`. `AI_GATEWAY_MODEL` overrides the default `google/gemini-2.5-flash-lite`. A failed call is shown on the results page and those cards keep the heuristic score.

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
## Project layout

- `app/page.tsx` — recruiter UI. The spec box starts empty.
- `app/spend/page.tsx` — Apify spend log
- `app/api/search/route.ts` — candidate search
- `app/api/parse-spec/route.ts` — spoken spec parser
- `lib/parse-speech.ts` — OpenAI JSON extraction and the rule-based fallback
- `lib/speech-control.ts` — speech transcript reducer
- `lib/actors.ts` — actor ids, limits, and input builders
- `lib/apify.ts` — REST client
- `lib/charge.ts` — `usageTotalUsd` and the event breakdown
- `lib/attribute.ts` — per-candidate and per-field attribution
- `lib/validate.ts` — profile check
- `lib/search.ts` — parallel runs, enrichment, and failure handling
- `lib/spend-log.ts` — run history for `/spend`
- `lib/normalise.ts`, `lib/rank.ts`, `lib/sample.ts` — shared candidate shape, scoring, and sample data
