# 2LLazy

2LLazy is a job-search and application tracker for IT roles in the Czech market.
It searches several job boards at once, ranks the results with a transparent keyword score, and keeps your favourites, applications, interviews and stats in one place.

## Core features

- Search startupjobs.cz, jobs.cz, nofluffjobs.com, cocuma.cz, jobstack.it, skilleto.cz and jooble.org with live progress
- Instant results from postings already in the database, topped up live from each board
- Deterministic relevance score (title, keywords, location, seniority, recency, salary) with the reasons shown on every card
- Polite scraping: robots.txt respected by default, per-host rate limits, retries with backoff, and a pause for boards that keep failing
- Save favourites and track them through the application pipeline on the dashboard
- Experimental auto apply: Playwright fills the application form in an isolated browser profile, keeps screenshots as evidence, and stops for you to finish by hand when it isn't confident. CAPTCHAs are never bypassed.
- Monthly interview calendar with optional Google Calendar sync
- Stats on applications and outcomes

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Material UI v5
- Prisma 7 + PostgreSQL
- NextAuth v5 (email/password and Google)
- Apollo GraphQL endpoint (`/api/graphql`) and server-sent events for search and auto apply
- Playwright for client-rendered boards and auto apply
- Optional local Ollama for mapping ambiguous form fields during auto apply

## Prerequisites

1. Node.js 22+
2. PostgreSQL
3. Optional: Playwright Chromium (`npx playwright install chromium`) and a local Ollama

## Environment variables

Create `.env.local` (or `.env`) with:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/application_fatique?schema=public"
AUTH_SECRET="<random string, e.g. from npx auth secret>"
```

Optional:

| Variable | Enables |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in and Google Calendar sync |
| `JOOBLE_API_KEY` | The Jooble board (free key from jooble.org/api/about) |
| `PLAYWRIGHT_ENABLED=true` | Boards that need a real browser (StartupJobs, Skilleto) and richer Jobs.cz descriptions |
| `ROBOTS_ALLOW` | Opt-in exceptions to robots.txt, e.g. `nofluffjobs.com/api/` for NoFluffJobs |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_EMBED_MODEL` | Local models used by auto apply (defaults: `http://127.0.0.1:11434`, `llama3`, `nomic-embed-text`). On AMD GPUs start Ollama itself with `OLLAMA_VULKAN=1`. |
| `APPLY_HEADLESS=true`, `APPLY_PROFILE_DIR` | Run auto apply without a visible window / choose its browser profile folder |

## Setup

```bash
npm install
npm run db:migrate
npm run db:generate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Routes

| Route | Description |
|---|---|
| `/` | Search jobs with live progress |
| `/favourites` | Saved jobs; track them into the dashboard |
| `/dashboard` | Application tracker, notes and auto apply |
| `/interviews` | Monthly interview calendar |
| `/stats` | Application statistics |
| `/settings` | Profile, search defaults, CVs and Google Calendar |
| `/login` | Sign in |

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm test
npm run test:e2e
npm run db:migrate
npm run db:generate
npm run db:studio
npm run db:reset
```
