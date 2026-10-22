# 2LLazy

2LLazy is a job-search and application tracker for IT roles in the Czech market.
It searches several job boards at once, ranks the results with a transparent keyword score, and keeps your saved jobs, applications, interviews and stats in one place.
Nothing in it calls an AI service. The only models it can use run on an optional local Ollama: for the search profile built from your CV, for rating results, for embeddings, and during auto-apply.

## Features

- One search across Czech job boards, with live progress as each board reports in
- Postings already in the database appear straight away, then fresh ones are added as each board responds
- A deterministic relevance score (title, keywords, location, seniority, recency, salary), with the reasons shown on every card
- Polite scraping: robots.txt respected by default, per-host rate limits, retries with backoff, and a pause for boards that keep failing
- When a board sits a search out, the results say which one and why
- Saved jobs that you move through the application pipeline on the dashboard
- Experimental auto-apply, with adapters for StartupJobs and jobs.cz and a generic form filler elsewhere (see below)
- Monthly interview calendar with optional Google Calendar sync
- Stats on applications and outcomes

## Job boards

| Board | Runs when |
|---|---|
| Jobs.cz | Always. `PLAYWRIGHT_ENABLED=true` adds fuller descriptions for postings that render client-side |
| Cocuma | Always |
| Jobstack | Always |
| Prace.cz | Always. Plain HTML listing, JSON-LD detail pages |
| Web search | Always. Two DuckDuckGo queries per search, pages read for schema.org JobPosting data, robots.txt honoured; sites that yield postings are remembered |
| NoFluffJobs | Always. Postings are kept when located in Czechia or fully remote. The board currently lists no Czech-located roles, so in practice the results are the fully remote ones. Its robots.txt disallows the API; `config/sources.cz.json` opts in to it |
| Company careers | Always. Reads employers' own public job boards on Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee and Workable |
| StartupJobs | `PLAYWRIGHT_ENABLED=true` |
| Skilleto | `PLAYWRIGHT_ENABLED=true` |
| Jooble | `JOOBLE_API_KEY` is set (free key from jooble.org/api/about) |

Ranking learns from you: favourites, applications, "Not interested" and the local model's own ratings train a small per-user ranker (see docs/scraping-v2-plan.md, Phase 5). Nothing leaves the machine. The ranker's similarity feature needs the embedding model, so run `ollama pull nomic-embed-text`. Without it, that feature is silently off.

The companies behind "Company careers" are listed in [config/sources.cz.json](config/sources.cz.json). To add one, add a line such as `{ "ats": "greenhouse", "slug": "jetbrains", "name": "JetBrains" }`, where `ats` is one of `greenhouse`, `lever`, `ashby`, `smartrecruiters`, `recruitee` or `workable`. The same file's `robotsAllow` list holds the robots.txt opt-ins.

The search pipeline lives in `src/lib/jobs`. `registry.ts` lists the boards, `sources/<board>.ts` holds each board's scraper, and `score.ts` holds the ranking. The roadmap and per-board notes are in [docs/scraping-v2-plan.md](docs/scraping-v2-plan.md).

## Auto-apply

The Auto-apply button on the dashboard opens the posting in Playwright, fills the application form and, when it is confident, submits it. It uses a separate, persistent Chromium profile in `.apply-profile`, so it never touches your own browser. StartupJobs and jobs.cz/Teamio have dedicated adapters; every other site goes through a generic form filler.

- Fields are matched by their labels, names and placeholders. A local Ollama, if you run one, maps fields the matcher can't place and drafts the free-text message from your CV text and the job description, in the posting's language. The writer prefers `gemma3:4b`, then `gemma3:12b` and `gemma2:9b`, then other common chat models (`qwen2.5:7b`, `mistral-nemo`, `llama3.1`), then the default model (`ollama pull gemma3:4b` is enough); set `OLLAMA_WRITER_MODEL` to override. Drafts are short and plain, and are redrafted when they contain stock AI phrasing, sentences copied from the ad, or experience the CV does not state. Without Ollama, those fields stay empty.
- The form is submitted only when every required field is filled and the mapping confidence is at least 0.8.
- Otherwise the run stops as NEEDS_MANUAL, with the reason shown and the browser left open on the filled form for you to finish.
- A login wall or a CAPTCHA pauses the run instead. A login wall pauses it before the form is filled. A CAPTCHA pauses it after filling, just before submitting. Either way the application shows as "Needs you" with a screenshot, and the run continues on its own once you sign in or solve the CAPTCHA (or press Continue). Nothing is bypassed; after `APPLY_HUMAN_WAIT_MINUTES` (default 15) the run ends as NEEDS_MANUAL. Paused runs do not block other applications, and every pause is recorded per site.
- Every run saves screenshots, the submitted values (`payload.json`) and a log (`log.txt`) to `uploads/applications/<applicationId>`. The dashboard shows them in the Evidence dialog.
- `POST /api/apply` with `"dryRun": true` fills the form but stops before submitting.

The code is in `src/lib/apply`. The design and current state are in [docs/auto-apply-plan.md](docs/auto-apply-plan.md).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Material UI v5
- Prisma 7 + PostgreSQL
- NextAuth v5 (email and password, or Google)
- Apollo GraphQL endpoint (`/api/graphql`) and server-sent events for search and auto-apply
- Playwright for client-rendered boards and auto-apply

## Prerequisites

1. Node.js 22.12+ (20.19+ also works; Prisma 7 refuses older versions)
2. PostgreSQL with pgvector installed. One early migration (`20260409_improvements`) still creates the `vector` extension, even though a later migration drops every vector column. `vector` is not a trusted extension, so if your app's database role is not a superuser, run `CREATE EXTENSION vector;` in the app database as a superuser first. `pg_trgm` ships with PostgreSQL and needs nothing extra.
3. Optional: Playwright Chromium (`npx playwright install chromium`) and a local Ollama

## Environment variables

Create `.env.local` with the two required values. `.env.local` overrides `.env`, and both are gitignored, so keep real values there and out of the repository.

```env
DATABASE_URL="postgresql://<user>:<password>@localhost:5432/application_fatique?schema=public"
AUTH_SECRET="<random string, e.g. from npx auth secret>"
```

Optional:

| Variable | Enables |
|---|---|
| `PLAYWRIGHT_ENABLED=true` | StartupJobs and Skilleto, and fuller Jobs.cz descriptions. Auto-apply doesn't need it, only the Chromium install |
| `JOOBLE_API_KEY` | The Jooble board |
| `ROBOTS_ALLOW` | Further comma-separated `host/path` exceptions to robots.txt, added to the ones in `config/sources.cz.json` |
| `SEARCH_REFRESH_MINUTES` | How often the background pass re-reads stored postings and expires the ones that are gone (default 180, `0` disables) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google sign-in and Google Calendar sync |
| `APPLY_HEADLESS=true` | Runs auto-apply without a visible browser window |
| `APPLY_PROFILE_DIR` | Puts the auto-apply browser profile somewhere other than `.apply-profile` |
| `APPLY_HUMAN_WAIT_MINUTES` | How long a paused auto-apply run waits for you at a CAPTCHA or login wall (default 15) |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_WRITER_MODEL` | The local Ollama used for search profiles, result ratings and auto-apply (defaults `http://127.0.0.1:11434` and `gemma3:4b`; the writer falls back through the models listed under Auto-apply). On AMD GPUs, start Ollama itself with `OLLAMA_VULKAN=1` |
| `OLLAMA_EMBED_MODEL` | The embedding model behind the ranker's similarity feature (default `nomic-embed-text`) |

## Setup

```bash
npm install
npx prisma migrate deploy
npm run db:generate
npx tsx --env-file=.env.local prisma/seed-test-user.ts
npm run dev
```

Apply migrations with `prisma migrate deploy`, not `npm run db:migrate`. `migrate dev` replays the whole history into a shadow database, and `npm run db:reset` replays it into a fresh schema. Both fail on the `vector` extension unless the app role can create it. To make both work, run `CREATE EXTENSION vector;` in `template1` once as the `postgres` superuser. To write a new migration, use the diff, review, deploy route in [docs/auto-apply-plan.md](docs/auto-apply-plan.md).

There is no sign-up page. `prisma/seed-test-user.ts` creates a local test account; its email and password are at the top of the file. Use it on your own machine only. With the Google variables set, you can sign in with Google instead.

Open [http://localhost:3000](http://localhost:3000) and sign in. Settings is where you set your country and city, which become the search defaults, and upload CVs.

## Routes

| Route | Description |
|---|---|
| `/` | Search jobs with live progress |
| `/favourites` | Saved jobs; move them into the dashboard |
| `/dashboard` | Application pipeline, notes, auto-apply and its evidence |
| `/interviews` | Monthly interview calendar |
| `/stats` | Application statistics |
| `/settings` | Profile, search defaults, CVs and Google Calendar |
| `/login` | Sign in with email and password, or with Google |

## Tests

`npm test` runs the Vitest unit tests, which need no database or network. `npm run test:e2e` runs Playwright. It starts the dev server if one isn't running and signs in as the test account, so it needs the database and the seeded test user.

## Scripts

```bash
npm run dev            # development server
npm run build          # production build
npm run start          # serve the production build
npm run lint           # eslint
npm test               # unit tests (vitest)
npm run test:watch     # unit tests in watch mode
npm run test:coverage  # unit tests with coverage
npm run test:e2e       # end-to-end tests (playwright)
npm run db:migrate     # prisma migrate dev (needs a role that can create vector)
npm run db:generate    # generate the Prisma client
npm run db:studio      # browse the database
npm run db:reset       # wipe the database and re-run every migration (needs a role that can create vector)
```
