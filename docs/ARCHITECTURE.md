# Architecture

How a search travels through 2LLazy, and why each piece works the way it does.

Everything described here is deterministic: the same request against the same
pages produces the same results. There are no model calls anywhere in the path,
which is what makes it free to run, testable offline, and explainable to the
person reading the results.

## The whole flow

```
  POST /api/scrape
        |
        v
  auth + rate limit + body validation        src/app/api/scrape/route.ts
        |
        v
  country detection                          src/lib/geo/detect.ts
  explicit > profile > geo header > Accept-Language > default
        |
        v
  board selection  boardsForCountry(DE)      src/lib/scrapers/registry.ts
  local boards first, then worldwide remote boards
        |
        +--------------------+--------------------+
        v                    v                    v
   API board            HTML board           HTML board          (in parallel,
   fetchJson            listing page         listing page         Promise.allSettled)
        |                    |                    |
        |               selectJobLinks       selectJobLinks       parse/listing.ts
        |                    |                    |
        |               detail pages         detail pages         fetcher.ts / pwFetch
        |                    |                    |
        |                    v                    v
        |               extractJob            extractJob          extract.ts
        |          JSON-LD > microdata > meta > heuristics
        |                    |                    |
        +--------------------+--------------------+
                             |
                             v
                    BM25 ranking + domain rules   src/lib/matching/score.ts
                             |
              score >= 0.18? --- no --> dropped
                             | yes
                             v
                    upsert into Postgres          JobPosting (by sourceUrl)
                             |
                             v
                    SSE "job" event to the browser
                             |
                             v
              after every board reports in:
              Postgres full-text pass over the cache
              ranked by the same scorer, emitted with isStale
                             |
                             v
                    SSE "complete"
```

## 1. The request

`src/app/api/scrape/route.ts`, `POST /api/scrape`. Node runtime,
`maxDuration = 300`.

- `auth()` (next-auth) must return a session with a user id, otherwise 401.
- An in-memory per-IP rate limiter allows one search every 10 seconds. It is a
  `Map` in module scope, so it resets on restart and does not survive across
  instances — deliberately simple, not a security boundary.
- The body carries `query`, `skillLevel`, `city`, `country`, `deepSearch`,
  `remoteOnly`, `salaryMin`, `salaryMax`. A query with no letters or digits is
  rejected with 400 rather than run against every board for a guaranteed-empty
  result.
- The response is `text/event-stream`. The route returns immediately with a
  `TransformStream` readable and keeps writing events into it.

## 2. Country detection

`src/lib/geo/detect.ts`. Board selection needs an ISO country before any
scraping starts, and the app has to work for someone who has never opened the
settings page. `detectCountry` takes the best evidence available, first hit
wins:

| Priority | `via` | Source |
|---|---|---|
| 1 | `explicit` | `country` in the request body |
| 2 | `profile` | the country saved on the user's profile |
| 3 | `geo-header` | `x-vercel-ip-country`, `cf-ipcountry`, `x-country-code`, `x-geo-country`, `x-appengine-country`, then Netlify's base64 `x-nf-geo` |
| 4 | `accept-language` | region subtag (`cs-CZ` → CZ), or a language spoken in essentially one country (`cs` → CZ) |
| 5 | `default` | `DEFAULT_COUNTRY` in `src/lib/geo/countries.ts`, which is `US` |

Nothing here throws. A malformed header is weaker evidence, never an error.
CDN placeholders (`XX`, `T1`, `ZZ`) are ignored. Bare languages spoken across
many markets — `en`, `es`, `fr`, `pt`, `ar`, `zh` — are deliberately *not*
mapped, because guessing "es" as Spain would send a user in Mexico to the wrong
boards.

The detected country and how it was detected both go out in the first SSE
event, so the UI can say "searching Germany, detected from your browser".

## 3. Board selection

`boardsForCountry(country, opts)` in `src/lib/scrapers/registry.ts`. A board
runs when all of these hold:

- it lists the country in `countries`, or lists `WORLDWIDE` (`"*"`);
- every name in its `requiredEnv` is set (`missingEnvFor` returns empty);
- it does not need a browser, or `PLAYWRIGHT_ENABLED === "true"`.

The result is sorted local-first, then by name. Local boards carry the postings
a user in that country can actually take, and they start streaming before the
worldwide boards catch up.

The worldwide remote boards are the reason the app is useful in a country
nobody has written a local board for yet: every country gets at least
Remotive, RemoteOK, Jobicy, Himalayas and We Work Remotely.
`tests/unit/pipeline.test.ts` asserts exactly that for CZ, DE, BR, KE, NZ and
the nonexistent code ZZ.

`boardStatus(country)` returns the same information for the Settings screen,
including the boards that would *not* run and a `disabledReason` a user can act
on ("Set ADZUNA_APP_ID and ADZUNA_APP_KEY to enable").

## 4. Scraping

Every board is a `BoardDefinition` with a `scrape: (q: ScrapeQuery) => Promise<ScrapedJob[]>`.
They run together under `Promise.allSettled`, and each one emits a `progress`
event when it starts and a `scraperDone` event when it finishes, pass or fail.

There are two flavours:

- **API boards** (`remotive.ts`, `remoteok.ts`, `arbeitnow.ts`, `jobicy.ts`,
  `himalayas.ts`, `weworkremotely.ts`, `adzuna.ts`) fetch JSON or RSS, validate
  each item with a lenient zod schema, and map it onto `ScrapedJob`. The shared
  helpers in `boards/shared.ts` do the normalisation: HTML to text, salary
  formatting, date parsing across unix seconds/millis/ISO, country resolution
  from free-form location text.
- **HTML boards** (`cocuma.ts`, `jobstack.ts`, `startupjobs.ts`, `jobscz.ts`,
  `nofluffjobs.ts`, `skilleto.ts`, `jooble.ts`) hand `runHtmlBoard` a URL
  builder, a fetcher and a link pattern. It walks listing pages, picks job
  links, fetches detail pages under a concurrency cap, and runs extraction.

Both flavours fail soft. A board that cannot be reached warns once and returns
`[]`; it never throws into the search. One dead site must not take down a
search that four other boards are answering.

`requiresBrowser: true` boards go through `pwFetch`
(`src/lib/scrapers/playwright-browser.ts`), which renders the page in Chromium.
When `PLAYWRIGHT_ENABLED` is not `"true"` the registry never selects them in
the first place, and `pwFetch` falls back to a plain GET if it is called
anyway.

## 5. Deterministic extraction

`src/lib/scrapers/extract.ts`. This is the piece that replaced the model. Four
layers run in order of trustworthiness, each filling only the gaps the previous
one left, and each carrying a confidence:

| Layer | `via` | Confidence | What it reads |
|---|---|---|---|
| 1 | `jsonld` | 0.95 | `schema.org/JobPosting` in `<script type="application/ld+json">` |
| 2 | `microdata` | 0.85 | the same vocabulary in `itemprop` attributes |
| 3 | `meta` | 0.60 | OpenGraph, `<meta name="description">`, `<h1>`, `<title>` |
| 4 | `heuristic` | 0.40 | salary regexes, work-type keywords, company from breadcrumb or host |
| — | `hint` | 0.20 | what the board already knew: link text, its own country |

Most boards publish JSON-LD because Google Jobs requires it, so in practice
layer 1 answers most pages with authoritative, already-structured fields. The
lower layers exist for the boards that do not.

Two details worth knowing before you touch this file:

- `fill()` never overwrites a value that is already set, and the record's `via`
  becomes the *best* layer that contributed anything.
- The board's hint is applied **last**, not first. Seeding it up front would let
  a board's `defaultLocation: "Czech Republic"` win over the `"Praha, CZ"` the
  posting actually published.

`extractJob` never throws. A page that defeats every layer still yields a
record built from the hint, marked `via: "hint"` with confidence 0.2, so a
caller can tell the difference between "we read this" and "we guessed this".

Link selection (`src/lib/scrapers/parse/listing.ts`) is deterministic too. A
board supplies a `urlPattern` and optionally a `cardSelector`; without either,
a generic set of job-URL shapes across several languages (`/job/`, `/nabidka/`,
`/oferta/`, `/stellen/`, `/vaga/`, `/rpd/`…) does the job. Navigation, legal
and locale links are filtered out, tracking parameters are stripped so the same
posting dedupes to one URL, and relevance is deliberately *not* decided here —
every plausible link is followed and the ranker filters afterwards, where it
can be tested.

## 6. Ranking

`src/lib/matching/`. Three files matter:

- `taxonomy-data.ts` — 42 hand-written entries (React, Django, Kubernetes, QA…)
  each with `aliases`, `strong`, `related`, `negative`, `includedTitles` and
  `excludedTitles`. This is the knowledge an embedding model used to supply
  implicitly: that React implies JSX and Redux and *not* Kubernetes.
- `intent.ts` — `classifyQueryIntent(query, skillLevel)` turns the search box
  into a `QueryIntent`: category, seniority, weighted terms, negative terms,
  title include/exclude lists, and the single best `scrapingKeyword` for board
  URLs. A query the taxonomy has never seen falls back to literal term
  matching, which is worse at inference but instant and stable.
- `score.ts` — BM25 with field weighting, plus the domain rules.

The BM25 core: `K1 = 1.2`, `B = 0.75`, a title hit worth 3 description hits,
IDF built over the current result set (`buildCorpusStats`), and a coverage
factor so a posting that matched one incidental keyword does not score like one
that matched the whole term set. The raw total is squashed into 0–1.

Then the domain rules, each of which is a named constant at the top of the file
so it can be argued with in a pull request:

| Rule | Effect |
|---|---|
| negative term in the title | −55% of the score, and stops there |
| negative terms in the body | ×0.92 each, up to 6 |
| title matches an excluded role (and no included one) | ×0.15 |
| seniority mismatch | ×0.65 |
| seniority match | +0.06 |
| `remoteOnly` search, non-remote posting | ×0.35 |
| posting in the searched city | +0.08 |
| posting in the searched country | +0.04 (out of country and not remote: −0.06) |
| salary inside the requested range | +0.08 (salary published at all: +0.02) |
| posted in the last 60 days | up to +0.07, full weight inside 14 days |

`RELEVANCE_THRESHOLD` is 0.18. Below it, a result is not shown. The value is
calibrated against the fixture corpus in `tests/unit/matching-score.test.ts`: a
posting whose title names the searched role lands around 0.5–0.8, a passing
mention lands around 0.2–0.35, and an unrelated posting ("IT Director", "Sales
Engineer") lands below 0.15.

Every `ScoreResult` carries `matched` (the query terms actually found) and
`reasons` (`title mentions react, hooks`, `Junior role, you asked for Senior`,
`posted this week`). Both are sent to the browser and shown on the card. A bad
ranking is therefore something a user can see and report, not an opaque number
to argue with.

## 7. Streaming

The route writes SSE frames as the search progresses:

| Event | When |
|---|---|
| `meta` | first, with the detected country, how it was detected, and the boards about to run |
| `progress` | a board started, a board's results are being ranked, the cache pass started |
| `job` | one ranked posting, with `score`, `matched`, `reasons`, `isNew` |
| `scraperDone` | one board finished — carries `doneCount` / `total` for the progress bar |
| `scrapersDone` | every board has reported in |
| `error` | one board failed; the search continues |
| `complete` | last, with the total emitted |

Results are deduplicated across boards by `sourceUrl` as they are emitted, since
two boards often syndicate the same posting.

## 8. Cache and the full-text pass

Every emitted posting is upserted into the `JobPosting` table keyed by
`sourceUrl`. `firstSeenAt` is deliberately never updated, so the "new" badge
keeps meaning "first appeared in the last 24 hours".

After the live boards finish, the route runs one more pass over what is already
stored:

```sql
WHERE to_tsvector('simple', title || ' ' || company || ' ' || description)
      @@ plainto_tsquery('simple', $query)
ORDER BY (country = $country) DESC, "scrapedAt" DESC
LIMIT 300
```

The `'simple'` configuration is used rather than `'english'` because the cache
holds Czech, Polish, German and English postings side by side, and English
stemming mangles the rest. Postgres narrows the table to at most 300
candidates; the *same* lexical ranker then scores them and the best 80 above
the threshold are emitted with `isStale: true`. A cached hit and a fresh hit
are therefore ranked on identical terms — the cache is a second source of
candidates, not a second ranking system.

## Why it is built this way

**It costs nothing to run.** No per-request token spend, no key to rotate, no
rate limit but the job boards' own. Someone looking for work can run this on a
laptop or a free tier and it keeps working.

**It is testable offline.** `tests/unit/pipeline.test.ts` stubs the fetcher and
drives country detection → board selection → listing → detail → extraction →
ranking against fixture markup, with no network. That test would have been
impossible with a model in the middle: you cannot assert on a
non-deterministic ranking, and mocking the model would have meant testing the
mock.

**It is explainable.** Every result carries the terms it matched and the
reasons it was ranked where it was. When a search ranks badly, a contributor
can open `taxonomy-data.ts` or `score.ts`, see exactly which rule did it, and
fix it in a pull request. That was never possible with cosine similarity over
embeddings.

## What used to be here

The git history contains an earlier version built around OpenAI and LangChain.
If you go looking, this is what was there and what replaced it — the module
header comments in each file say the same thing:

| Old | New |
|---|---|
| `gpt-4o-mini` read each job page and guessed `{title, company, location, salary, description, workType}` | `src/lib/scrapers/extract.ts` — JSON-LD, microdata, meta tags, heuristics, with a confidence per layer |
| The whole listing page was handed to GPT with "which of these links are jobs?" | `src/lib/scrapers/parse/listing.ts` — `cardSelector` / `urlPattern`, plus generic multilingual job-URL shapes |
| Query intent came from a small static table with a `gpt-4o-mini` fallback | `src/lib/matching/taxonomy-data.ts` (42 entries) plus literal term matching for anything unknown |
| Ranking was cosine similarity over OpenAI embeddings, with an "anti-query" embedding for out-of-domain postings | `src/lib/matching/score.ts` — BM25 with field weighting, plus explicit negative terms and excluded titles |
| `openai`, `@langchain/core`, `@langchain/openai`, `@langchain/langgraph` dependencies | removed from `package.json` |

The old approach filtered relevance *while* reading the page, which meant a bad
prompt silently dropped good jobs and nobody could tell. The current split —
follow every plausible link, then rank in one testable place — exists because
of that.

## Where things live

```
src/app/api/scrape/route.ts      the SSE search endpoint (steps 1, 4, 7, 8)
src/lib/geo/                     country data, detection (step 2)
src/lib/scrapers/registry.ts     board registry and selection (step 3)
src/lib/scrapers/boards/         one file per board; helpers.ts and shared.ts
src/lib/scrapers/fetcher.ts      plain HTTP fetching, retries, page parsing
src/lib/scrapers/playwright-browser.ts   optional browser rendering
src/lib/scrapers/parse/          jsonld, html, listing, salary, worktype
src/lib/scrapers/extract.ts      the four extraction layers (step 5)
src/lib/matching/                taxonomy, intent, BM25 scoring (step 6)
scripts/scrape.ts                run boards from the terminal, no DB, no server
tests/unit/pipeline.test.ts      the whole chain with the network stubbed
```

Adding coverage for a new country is one file in `boards/` and one line in
`registry.ts` — see [`ADDING_A_JOB_BOARD.md`](ADDING_A_JOB_BOARD.md).
