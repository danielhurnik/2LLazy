# Scraping v2 — Czech-first, free, local-only

Status: **Phase 0 landed 2026-10-13** (see "Phase 0 — delivered" at the end). Scope: replace the
per-site GPT-driven scrape pipeline with a source registry + deterministic matching that runs on
the user's own machine at zero API cost.

Decisions taken since the proposal:
- **Ollama is allowed** (free, local): Phase 2's search profile uses it via the shared `src/lib/ollama.ts`
  client (native `/api/chat` with JSON schema, explicit `num_ctx`; `OLLAMA_VULKAN=1` puts llama3 8B on
  the RX 6600 XT at ~45 tok/s). Ranking stays deterministic; `nomic-embed-text` (768-dim) is an optional
  later signal, not a replacement vector column.
- **robots.txt is honoured by default**; NoFluffJobs' JSON API (`/api/`, disallowed) runs only with
  `ROBOTS_ALLOW=nofluffjobs.com/api/` (or `ROBOTS_POLICY=ignore`). Cocuma's keyword search is disallowed,
  so its listing is read unfiltered and matched locally.
- Local PG 18: `prisma migrate dev` fails on the shadow DB (`vector` is untrusted). Working path:
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → review →
  `prisma migrate deploy` → `prisma generate` → **restart the dev server** (the client is cached on
  `globalThis`).

## Constraints

- **Czech Republic first.** Registry is country-keyed so other countries are additive later.
- **Free all the way.** No SerpAPI/JSearch/paid LLM calls in the search path. OpenAI stays
  optional (cover letters) and must not be required for search.
- **Local only.** The Next.js server runs on the user's PC, so scraping already happens from the
  user's device/IP. That kills the "browser extension" idea (not needed) and makes politeness
  mandatory (it's the user's home IP that gets banned).
- **DB: local PostgreSQL 18** (`localhost:5432`, db `application_fatique`, role `app_fatique`), being set
  up by a parallel session. pgvector 0.8.7 is compiled and installed there, so the schema stays as is
  until Phase 4 (do **not** pull the embedding drop forward). `pg_trgm` 1.6 is present and trusted →
  the app role can `CREATE EXTENSION` it inside a migration. `src/lib/prisma.ts` already uses
  `PrismaPg` over a `pg` Pool — build on it, don't edit it, and never import `@neondatabase/serverless`,
  `@prisma/adapter-neon` or `ws` (they are being removed). `DATABASE_URL` lives in `.env.local`
  (gitignored, takes precedence over `.env`); scripts load it via
  `node --env-file=.env.local --env-file=.env` — never hardcode or print it.
- Ollama 0.22 is installed with `llama3:latest` pulled → free local LLM for the one structured
  call we keep (search-profile extraction).

## What is wrong today (measured)

| Issue | Evidence |
|---|---|
| Every search is fully live, ~50 s | `POST /api/scrape 200 in 48–54 s` in dev logs |
| 2 GPT calls per board page + 1 GPT call per job detail + 1 embedding per new job | `extractRelevantJobsFromPage` / `extractJobFromText` in all 7 scrapers (`src/lib/scrapers/*.ts`), `generateEmbedding` in `src/app/api/scrape/route.ts` |
| Playwright used for pages that are plain-fetchable | Jobs.cz listing returns 200 + 25 `data-jobad-id` cards to a plain GET |
| No country anywhere | `cz.jooble.org`, `/cz/jobs/...` hard-coded; `UserProfile` has no country/city |
| Duplicate rows per search | Jobs.cz detail URLs carry `?searchId=…&rps=…`; `sourceUrl` is the unique key → new row every search |
| Ranking solves the wrong problem | Cosine similarity reorders ~50 results; recall (coverage) is the real gap |
| Misnamed health check | `checkOllamaHealth()` in `src/lib/ai.ts` only checks `OPENAI_API_KEY` |

## Source inventory for CZ (verified 2026-10-13 from this machine)

| Source | Access | Verified | Needs |
|---|---|---|---|
| **NoFluffJobs** | `POST https://nofluffjobs.com/api/search/posting?region=cz&salaryCurrency=CZK&salaryPeriod=month&limit=N&offset=M` body `{"rawSearch":"…"}` | ✅ returns structured `postings[]` + `criteriaSearch` (category, seniority, city) | nothing |
| **Jobs.cz** | plain GET `https://www.jobs.cz/prace/<city>/?q[]=…` → 25 cards/page (`data-jobad-id`, `/rpd/<id>/` links); detail plain GET | ✅ fetchable without Playwright; ❌ no JSON-LD | cheerio extractor for detail; strip `searchId`/`rps` from URLs |
| **Jooble** | official API `POST https://cz.jooble.org/api/<key>` `{keywords, location, page}` | HTML is 403 (bot-protected); API is free with a key | `JOOBLE_API_KEY` (free signup at jooble.org/api/about) |
| **StartupJobs** | SSR Nuxt payload in listing HTML (no XHR for offers; only `/api/feature-flags`) | ⚠️ data location in payload unverified | parse `__NUXT_DATA__` / `_payload.json`; Playwright fallback |
| Cocuma, Skilleto, Jobstack | existing HTML scrapers | working today | keep, remove GPT calls |
| Remotive (+ Jobicy, RemoteOK) | keyless JSON APIs | reachable | remote-only roles; optional |
| **ATS feeds** — Recruitee `https://<co>.recruitee.com/api/offers/`, Greenhouse `boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true`, Lever `api.lever.co/v0/postings/<co>?mode=json`, Ashby `api.ashbyhq.com/posting-api/job-board/<co>` | keyless JSON | standard endpoints, not yet probed | seed list `config/sources.cz.json` + auto-discovery (Phase 3) |
| **Web discovery** | DuckDuckGo HTML (`https://html.duckduckgo.com/html/?q=…`, keyless) → fetch hits → schema.org `JobPosting` JSON-LD | not probed | politeness + cache; Brave Search free tier optional (key) |

Dropped: Arbeitnow (0 Czech jobs in 900), SerpAPI/JSearch (paid), LinkedIn/Indeed (blocked, no free API),
the LLM "browse the internet" agent (already retired → `/api/scrape/agent` returns 410).

## Target architecture

```
src/lib/jobs/
  sources/types.ts      JobSource { id, countries, kind, fetch(ctx): AsyncIterable<RawJob> }
  sources/registry.ts   sourcesFor(country) + per-source circuit breaker
  sources/<board>.ts    nofluffjobs, jobscz, jooble, startupjobs, cocuma, skilleto, jobstack, remotive
  sources/ats/*.ts      recruitee, greenhouse, lever, ashby (one file each, config-driven)
  sources/web/*.ts      duckduckgo.ts (discovery), jsonld.ts (generic JobPosting extractor)
  http.ts               polite fetch: per-host queue (concurrency 2, ≥500 ms gap), robots.txt,
                        429/403 backoff, on-disk cache in dev (.cache/http/, gitignored)
  normalize.ts          RawJob → NormalizedJob (salary → min/max/CZK/month, city, country, remote, skills[])
  dedupe.ts             canonicalUrl(), jobKey(company+title+city), contentHash()
  profile.ts            buildSearchProfile(user, query): Ollama JSON → zod; fallback = static QueryIntent table + keyword heuristics
  score.ts              scoreJob(profile, job) → { score 0–1, reasons[] }
  pipeline.ts           runSearch({ country, profile, live }) → AsyncIterable<SSEEvent>  (DB-first, then live top-up)
  repo.ts               upsert / query helpers
src/app/api/scrape/route.ts   thin SSE wrapper over pipeline; event shape unchanged
scripts/refresh-jobs.ts       background refresh (npx tsx), --watch for a long-running local worker
config/sources.cz.json        ATS seed list + board toggles;  config/refresh.cz.json  (country × role seeds)
tests/unit/jobs/*.test.ts     normalize, dedupe, score, jsonld, per-source mappers (fixtures in tests/fixtures/)
```

The SSE event contract (`progress | job | scraperDone | complete | error`) stays, so the search page
and `ScrapeProgressContext` need no changes. All files stay under 500 lines.

### Search profile ("the neural map of the user")

One structured call, cached per user, invalidated on CV upload or query change:

```ts
SearchProfile {
  titles: string[]          // accepted title patterns (seeded from QueryIntent.includedTitles)
  excludedTitles: string[]  // hard reject
  skills: string[]          // from CV (readCvText) + query
  seniority: "junior"|"mid"|"senior"|"lead"|"any"
  country: "CZ"; cities: string[]; remote: "only"|"ok"|"no"
  languages: string[]       // cs/en — postings in other languages are down-ranked
}
```

Built by Ollama `llama3` (`format: "json"`, zod-validated, one retry) from CV text + query + profile
country/city. When Ollama is down: static `STATIC_INTENTS` table + keyword heuristics — search still works.

### Scoring (deterministic, explainable)

Additive, normalised to 0–1, each contribution recorded as a reason string shown in the UI later:
title match 0.35 · skill overlap 0.25 · location/remote 0.15 · seniority 0.10 · recency 0.10 ·
salary present 0.05. `excludedTitles` → hard reject. Wire field stays `similarity` (0–1) so
`JobCard`, GraphQL schema and resolvers keep working during the redesign; `matchReasons: string[]`
is added. Embeddings are no longer written; the `embedding` columns are dropped in Phase 4.

### Data model changes (Prisma migrations)

**Sequencing:** no schema changes from this plan until the DB session confirms `prisma migrate deploy`
(existing 14 migrations; history has duplicate `*_init` / `*_add_role_profiles` entries it will verify
first) and `prisma/seed-test-user.ts` have run on the local DB. The first migration here starts with
`CREATE EXTENSION IF NOT EXISTS pg_trgm;`.

- `JobPosting`: `country String @default("CZ")`, `city String?`, `remote Boolean?`, `salaryMin Int?`,
  `salaryMax Int?`, `salaryCurrency String?`, `skills String[]`, `contentHash String?`,
  `@@index([country, scrapedAt])`. `sourceUrl` becomes the canonical URL (tracking params stripped).
- `UserProfile`: `country String @default("CZ")`, `city String?`, `searchProfile Json?`,
  `searchProfileUpdatedAt DateTime?`.
- `JobSource` enum: add `REMOTIVE`, `ATS`, `WEB` (and `JOOBLE` if missing).
- New `DiscoveredSource { kind, company, endpoint, country, lastSeenAt, enabled }` for sources learned
  by web discovery (Phase 3).

### Search flow

1. Build/load `SearchProfile`.
2. **DB-first**: query `JobPosting` by country + title/skill ILIKE (pg_trgm later), last 30 days → score →
   stream immediately (target < 1 s to first result).
3. **Live top-up**: for every source whose cache for (source, country, profile key) is older than the
   TTL (6 h), run it; new/updated jobs are normalised, deduped, upserted, scored and streamed.
   Target < 20 s with zero LLM calls in the loop.
4. `complete`. Per-source failures surface as `error` events (as today) and trip that source's breaker.

### Politeness (non-negotiable on a home IP)

Per-host concurrency 2, ≥500 ms between requests, robots.txt honoured, exponential backoff on
429/403, per-source circuit breaker, dev HTTP cache on disk, Playwright only where unavoidable
(StartupJobs fallback). Personal, non-commercial, local use; no redistribution.

## Phases

### Phase 0 — Skeleton + country (≈1 day)
- `src/lib/jobs/{sources/types,registry,http,normalize,dedupe,repo,pipeline}.ts`.
- Wrap the 7 existing scrapers as `JobSource`s; replace GPT page/detail extraction with cheerio where the
  listing already yields title+URL; delete `extractRelevantJobsFromPage` usage.
- `country` param: route → pipeline → registry (`ScrapeProgressContext.startSearch` gains `country`,
  defaulting to the profile; no UI control yet).
- Canonical-URL fix for Jobs.cz (stops duplicate rows).
- **Accept:** search returns ≥ today's results with **zero OpenAI calls** in the scrape path; `tsc`, `eslint`, `vitest` green.

### Phase 1 — Free structured CZ sources (≈1–2 days)
- NoFluffJobs API source (map `criteriaSearch` from profile: category, seniority, city).
- Jobs.cz plain-fetch source (listing + cheerio detail extractor, fixtures from real pages).
- Jooble API source behind `JOOBLE_API_KEY` (skipped cleanly when unset).
- StartupJobs payload source (verify payload format; Playwright fallback).
- ATS sources + `config/sources.cz.json` seeded with ~20–30 Czech tech companies on Recruitee/Greenhouse/Lever/Ashby.
- **Accept:** ≥3× results for "Frontend Developer" / CZ vs today; each source has a mapper unit test with a fixture.

### Phase 2 — Profile + scoring + DB-first (≈1–2 days)
- `profile.ts` (Ollama + fallback), `score.ts`, DB-first pipeline, stop writing embeddings.
- GraphQL: add `matchReasons`; favourites resolver (`src/graphql/resolvers.ts:57`) uses stored score instead of cosine.
- Replace the misnamed `checkOllamaHealth` with a real Ollama ping used by the Settings AI-status card.
- **Accept:** first results < 1 s on a warm DB; no OpenAI calls during search; results ordered by score with reasons.

### Phase 3 — Web discovery + source learning (≈1–2 days)
- `duckduckgo.ts` (query templates per profile title × city), `jsonld.ts` (generic `JobPosting` extractor, OpenGraph fallback).
- Learn `DiscoveredSource`s from hits on `*.recruitee.com`, `boards.greenhouse.io/<x>`, `jobs.lever.co/<x>`, `jobs.ashbyhq.com/<x>`; use them in later refreshes.
- **Accept:** a search surfaces jobs absent from every configured board; discovered sources appear in the next refresh run.

### Phase 4 — Background refresh + cleanup (≈1 day)
- `scripts/refresh-jobs.ts` driven by `config/refresh.cz.json`; npm scripts `jobs:refresh`, `jobs:watch`; add `tsx` devDependency.
- Delete superseded scrapers, `src/lib/scrapers/extract.ts`, embedding code; migration dropping `embedding` columns and the pgvector requirement.
- **Accept:** `npm run build && npm test` green; e2e search smoke passes; a cold search after a refresh run is answered from the DB.

### UI (after the visual redesign lands — coordinate with the fork session)
Country/city selector defaulting from the profile; score + reasons on `JobCard`; sources used in the
status line; Settings: profile country/city, "Rebuild search profile", real Ollama status.

## Risks / open points

- **Jooble key** — free, but needs a signup by the user; everything else is keyless.
- **Markup drift** (Jobs.cz, StartupJobs) — fixtures + per-source breaker; failures stay per-source, never fatal.
- **llama3 8B JSON reliability** — `format: "json"` + zod + one retry, then heuristic fallback. A smaller/faster
  model (`llama3.2:3b`) is an optional swap.
- **Home-IP bans** — politeness + caching are part of Phase 0, not an afterthought.
- **Local DB cutover in flight** — Phase 0 code is schema-independent; migrations wait for the DB session's
  green light (see Sequencing above).

## Decisions needed

1. Jooble: sign up for the free API key (yes/no — plan works without it).
2. Ollama model: keep `llama3` or pull `llama3.2:3b` for speed.
3. ~~Neon vs local Postgres~~ — resolved: local PostgreSQL 18 (see Constraints).
4. Drop the unused `RoleProfile` table together with the vector columns (nothing in `src/` reads it;
   only `prisma/seed.ts` writes it), or keep it as a seed-only reference list.

Out of scope: browser extension, paid APIs, other countries (additive via the registry), auto-apply.

## Phase 0 — delivered (2026-10-13)

- `src/lib/jobs/`: `sources/types.ts`, `events.ts`, `http.ts` (per-host lanes, robots, backoff, dev cache),
  `dedupe.ts`, `normalize.ts`, `score.ts`, `intent.ts`, `repo.ts`, `pipeline.ts`, `breaker.ts`, `registry.ts`,
  `sources/{jobscz,jobstack,cocuma,startupjobs,skilleto,nofluffjobs,jooble,match}.ts`.
- `src/app/api/scrape/route.ts` is a thin SSE wrapper; `ScrapeProgressContext` sends `country`.
- OpenAI is gone from the search path: `queryIntent.ts` is offline (`lookupIntent`), `resolvers.searchJobs`
  uses keyword search + the score, `prisma/seed.ts` seeds role profiles without embeddings; deleted
  `lib/ai.ts`, `lib/ragProfiles.ts`, `lib/similarity.ts`, `lib/scrapers/{extract,types,…boards}.ts`.
- Migration `20261013211000_scraping_v2_phase0`: pg_trgm, JobPosting structured columns + index,
  UserProfile country/city/searchProfile, CoverLetter dropped.
- Tests: `tests/unit/jobs/{dedupe,normalize,score,jobscz}.test.ts` + rewritten `queryIntent.test.ts`.
- Measured: "React" → 35 results (27 fresh / 8 cached), "Python" in Brno → 61, no source errors,
  zero LLM calls. Jobs.cz tracking URLs are canonicalised (no duplicate rows).
- Known gaps for Phase 1: StartupJobs card gives no company (selector); Skilleto returns nothing
  (SPA selectors); Jobs.cz descriptions are meta-description only unless Playwright is on.

### Phase 0 follow-ups (2026-10-13, evening)

- Boards that sit a search out are reported as a dedicated SSE event `sourceSkipped` (not a `progress`
  line); `ScrapeProgressContext` exposes them as `skippedSources: string[]` for the UI's skipped-boards note.
  Verified: a "Frontend Developer" search streams 2 skip reasons (NoFluffJobs robots opt-in, Jooble key),
  34 jobs, `complete`.
- Leftover-reference audit of `src/`: no OpenAI / LangChain / embedding / cover-letter code remains in the
  search path. The only "embedding" mentions are the LLM skill alias list in `normalize.ts` and the Ollama
  embed helper in `src/lib/ollama.ts` (auto-apply session's, unused by search).
- Still to drop (schema, needs a migration — sequenced after the auto-apply session's `apply_v2_phase1`):
  `extensions = [pgvector]`, `JobPosting.embedding`, `RoleProfile.embedding`, `RoleProfile.antiEmbedding`.
  Nothing reads or writes them. Removing them also removes the pgvector dependency, so `prisma migrate dev`
  (shadow DB) works again on this box. `RoleProfile` itself is only touched by `prisma/seed.ts`; whether to
  drop the whole table is a user decision (see Decisions needed).
- Ownership while the cleanup pass runs: cleaner session sweeps `src/lib/jobs/**`, `queryIntent.ts`,
  `resolvers.ts`, `tests/unit/jobs/**`; Phase 1 source fixes (`sources/{startupjobs,skilleto,jobscz}.ts`)
  start when that sweep is done.

### Phase 1 — source fixes delivered (2026-10-19)

- Migration `20261013233000_drop_vector_columns`: `JobPosting.embedding`, `RoleProfile.embedding`,
  `RoleProfile.antiEmbedding` dropped; `postgresqlExtensions` / `extensions = [pgvector]` removed from the
  schema. The `vector` extension stays installed (owned by the `postgres` superuser; harmless, unused).
  `prisma migrate dev` works again because the shadow DB no longer needs pgvector.
- **StartupJobs**: the offer anchor is the whole card — company (`line-clamp`), title (bold block minus the
  HOT badge), and a `<ul>` of salary / work mode / city / employment type are read off the listing, so
  details carry company, location, salary and workType. Detail text comes from the `.tiptap` rich-text
  container (no more cookie banner in descriptions).
- **Skilleto**: cards are `[class*='_job_']` with `/jobs/<slug>` links (not `/pozice/`); company, location
  and salary come off the card; `/skill/<slug>` falls back to `/role/<slug>` when a query is a role name.
- **Jobs.cz**: every current result is an `/rpd/` link that redirects to a company-branded page. Three page
  variants are handled: server-rendered branded (`.cp-detail__content`), widget-rendered branded
  (`.m-detail__description` inside `#vacancy-detail`, needs Playwright), and native jobs.cz
  (`[data-jobad='body']`, plain fetch). Page chrome is never used as a description any more; the meta
  description is the last fallback before the listing summary.
- **Jobstack**: a card without a company label no longer stores its street address as the company.
- **Scoring**: a job whose city is known and differs from the requested city has its total halved
  (`OTHER_CITY_TOTAL_MULTIPLIER`, reason "Located in Praha, not Brno"), so same-city / remote / unknown-city
  jobs rank above it even with a weaker title. Regression test in `score.test.ts`.
- **Pipeline** (cleaner session): a job first sent as cached is re-sent as live once a board confirms it,
  and the client replaces the stale copy; the per-source circuit breaker is now actually wired.
- Cocuma only matches titles of its ~60 listed jobs (no search endpoint allowed by robots); Jooble still
  needs the free `JOOBLE_API_KEY`.

### Phase 1 — sources finished, Phase 2 — search profile delivered (2026-10-20)

- **RoleProfile dropped** (migration `20261019214000_drop_role_profile_add_web_sources`), `JobSource`
  gained `ATS` and `WEB`, and a `WebDomain` table records hosts that yielded postings (used by web discovery).
- **Company careers (ATS)**: `sources/ats.ts` + `sources/atsAdapters.ts` read the public JSON of Greenhouse,
  Lever, Ashby, SmartRecruiters, Recruitee and Workable for the employers in `config/sources.cz.json`
  (every slug verified live; add a company with one line). A posting is kept when it is located in the
  country or remote without a single-country qualifier (plain "Remote", "Europe", "EMEA", "Global"), and when
  its title or description mentions the query. "React" → 26 postings from 11 employers.
- **Robots opt-ins moved into config**: `robotsAllow` in `config/sources.cz.json` (NoFluffJobs API on by
  default); `ROBOTS_ALLOW` in `.env` still adds more.
- **NoFluffJobs**: its API ignores `region=cz` and its Czech site serves the same Central-European pool, and
  the city filters for Prague/Brno return zero, so there is no Czech-located inventory. The source now keeps
  fully remote postings (labelled "Remote (POL)" when every listed office is abroad), paginates with
  `pageTo/pageSize` (the API ignores `limit/offset`), filters by title, de-duplicates per job rather than per
  listed city, and caps at 60 per search.
- **Search profile (Phase 2)**: `src/lib/jobs/profile.ts` builds `UserProfile.searchProfile` from the
  uploaded CV — deterministic first (titles from title-like lines, skills via `extractSkills`, seniority from
  title words or years of experience, city, remote preference, languages), then refined by Ollama `llama3`
  via `ollamaChatJson` when the local server answers (≈19 s on this machine; falls back silently). Server
  actions in `src/lib/actions/searchProfileActions.ts`; Settings card `SearchProfileCard`.
- **Scoring with the profile**: 15 % of the total comes from shared skills (70 %) and title fit (30 %) with
  reasons "Matches your CV skills (…)" and "Title fits your CV"; the CV seniority is used when the search
  says "Any level". Without a profile the scores are unchanged. Both the streaming search and the GraphQL
  `searchJobs` load the profile once per request.
- Known data quirk: a CV row written outside Prisma carried a local-time timestamp stored as UTC (about two
  hours in the future), so `readCvText` picked it over a newer upload; rows written by the app are fine.
