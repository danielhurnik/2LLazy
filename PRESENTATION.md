# 2LLazy — Job Search Without the Middleman

> *Finding work is hard enough. The tool shouldn't cost you a subscription or your data.*

---

## Overview

**2LLazy** is a full-stack web application that searches job boards, ranks the
results against what you actually asked for, and tracks every application from
"found it" to the interview.

It runs on **no AI, no API keys and no paid services**. Every part of the
pipeline — finding listings, reading job pages, ranking results, drafting cover
letters — is deterministic code you can read, test and fix. Give it a Postgres
database and it runs, on a laptop or a server, for free.

It is also **country-aware**: the set of job boards a search hits is chosen from
the searching user's country. Local boards where they exist, worldwide remote
boards everywhere else, so the app is useful to a developer in Nairobi or São
Paulo and not only to one in Prague.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLIENT  (React 19 / MUI v5)                      │
│  Search  │  Dashboard  │  Favourites  │  Interviews  │  Stats  │ Settings│
└──────────┬──────────────────────────────────────────────────────────────┘
           │  fetch / SSE / GraphQL
┌──────────▼──────────────────────────────────────────────────────────────┐
│                  SERVER  (Next.js 16 App Router — Node runtime)         │
│                                                                          │
│  POST /api/scrape ──► country detect ─► board registry ─► SSE stream    │
│  GET  /api/boards ──► which boards cover this country, and why not      │
│  POST /api/graphql ─► Apollo Server ─► Postgres full-text search        │
│  POST /api/cover-letter/stream ──► template composer ──► SSE            │
│  POST /api/cv-adjust/stream ─────► CV match report ──────► SSE          │
│  POST /api/uploads ──► CV storage (PostgreSQL bytea)                    │
└──────────┬──────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────┐
│                         SCRAPING PIPELINE                                │
│                                                                          │
│  boardsForCountry(CZ) ─┬─► local boards   (Jobs.cz, StartupJobs, …)     │
│                        └─► worldwide      (Remotive, RemoteOK, …)       │
│                                    │                                     │
│         listing page ─► selectJobLinks() ─► detail pages                 │
│                                    │                                     │
│         extractJob():  JSON-LD → microdata → meta → heuristics          │
│                                    │                                     │
│         scoreJob():    BM25 + taxonomy + domain rules ─► 0–1 + reasons  │
└──────────┬──────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                       │
│  Prisma 7  ──►  PostgreSQL                                               │
│  JobPosting  Application  CoverLetter  Interview                         │
│  CalendarEvent  CvDocument  UserProfile  UserFavourite                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| UI | Material UI v5 + Emotion |
| Data | Prisma 7, PostgreSQL |
| API | Apollo GraphQL (`/api/graphql`), SSE routes for streaming |
| Parsing | Cheerio |
| Rendering | Playwright (optional — only for JavaScript-heavy boards) |
| Testing | Vitest (unit + network-stubbed integration), Playwright (e2e) |

No model provider. No vector database. No paid API in the default path.

---

## Core Features

### 1. Country-aware job search

Boards are entries in a registry, each declaring the countries it serves:

```ts
export const jobsCzBoard: BoardDefinition = {
  id: "jobscz", name: "Jobs.cz", source: "JOBSCZ",
  countries: ["CZ"], remoteOnly: false, requiresBrowser: true,
  scrape: (q) => runHtmlBoard({ /* … */ }),
};
```

`boardsForCountry("DE")` returns the German-capable boards plus every worldwide
board, local ones first. The user's country comes from an explicit choice, then
their profile, then request geo headers your proxy sets (`x-country-code`,
`cf-ipcountry` and friends), then `Accept-Language`. Jooble alone contributes a local
site in roughly sixty countries.

Adding a board is one file and one registry line — no migration, because
`JobPosting.source` is a plain string rather than a database enum.

### 2. Deterministic extraction

Most boards publish `schema.org/JobPosting` as JSON-LD so Google Jobs can index
them. That structured data is authoritative and free to read, which is what
makes dropping the model viable. Four layers run in order of trustworthiness,
each filling only the gaps the previous one left:

| Layer | Confidence | Source |
|---|---|---|
| JSON-LD | 0.95 | `<script type="application/ld+json">` |
| Microdata | 0.85 | `itemprop` attributes |
| Meta / OpenGraph | 0.60 | `og:title`, `og:description`, `<h1>` |
| Heuristics | 0.40 | salary regexes, work-type keywords, breadcrumbs |

The parser handles the shapes real boards emit: `@graph` wrappers, `@type` as an
array, `hiringOrganization` as a bare string, `jobLocation` as a list, salary as
either `value` or `minValue`/`maxValue`, and JSON that does not quite parse.
Nothing throws — a page that defeats every layer still yields a usable record.

### 3. Explainable ranking

Relevance is BM25 over a hand-written taxonomy of ~45 roles and technologies,
each with aliases, strong and related terms, out-of-domain terms, and title
include/exclude lists. On top sit the domain rules: title matches count triple,
negative terms penalise, an excluded job title cuts the score sharply, seniority
mismatches demote, and recency, city, country and salary nudge.

Searching "react" over the test corpus:

```
  73%  Senior React Developer
  42%  Frontend Engineer (React)
  26%  Fullstack Developer (React / Node.js)
· 12%  Vue.js Developer
·  1%  IT Director            ← mentions React twice; correctly filtered
·  1%  Technical Recruiter    ← hires React devs; correctly filtered
```

Every result carries the terms it matched and a short list of reasons, so a bad
ranking is something a user can see and report rather than an opaque number to
argue with. That is a genuine improvement over the embedding score it replaced.

### 4. Cover letters and CV match reports

The cover letter is a **template filled from your CV and the posting** — matched
skills become bullets, unknowns become `«…»` placeholders you fill in, and the
signature comes from your CV. Localised for English, Czech, German, Polish,
Spanish and French. It never claims to have written anything for you.

CV tailoring was replaced by a **match report**: which of the posting's
keywords appear in your CV, quoting the line that carries each one, and which do
not. Rewriting somebody's CV is exactly the thing a model does confidently and
wrongly; this does the honest half and leaves the writing to the person whose
career it is.

### 5. Application lifecycle tracker

Favourites, a status pipeline (Pending → Applied → Interview → Offer / Rejected),
an interview and reminder calendar with optional Google Calendar sync, and a
stats page.

---

## Data Model

```prisma
model JobPosting {
  id          String    @id @default(cuid())
  title       String
  company     String
  location    String?
  country     String?   // ISO 3166-1 alpha-2
  description String    @db.Text
  sourceUrl   String    @unique
  source      String    // board id from the registry — no enum, no migration
  salary      String?
  workType    String?
  postedAt    DateTime?
  scrapedAt   DateTime  @default(now())
  firstSeenAt DateTime  @default(now())

  @@index([source])
  @@index([country, scrapedAt])
  // plus a GIN full-text index and a pg_trgm title index, created as raw SQL
}
```

The `vector(1536)` embedding column and the whole `RoleProfile` table are gone —
they existed only to hold model output. Ranking is lexical now, so the schema
carries a `'simple'`-configuration full-text index instead, chosen over
`'english'` because the cache holds Czech, Polish, German and English side by
side.

---

## API Surface

| Endpoint | Purpose |
|---|---|
| `POST /api/scrape` | Country-aware search; streams `meta`, `progress`, `job`, `complete` |
| `GET /api/boards` | Boards covering a country, and why the rest are skipped |
| `POST /api/graphql` | Queries, favourites, applications, interviews |
| `POST /api/cover-letter/stream` | Composed cover-letter draft |
| `POST /api/cv-adjust/stream` | CV ↔ posting match report |
| `POST /api/uploads` | CV upload (magic-byte validated) |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `AUTH_SECRET` | ✅ | Session signing secret (any long random string) |
| `PLAYWRIGHT_ENABLED` | ⬜ | Renders JavaScript-heavy boards; adds sources |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | ⬜ | Adzuna free tier — local boards in ~19 countries |
| `DEFAULT_COUNTRY` | ⬜ | Fallback when the user's country cannot be detected |
| `ENCRYPTION_KEY` | ⬜ | 64-char hex, for the encryption helpers |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ⬜ | Google Calendar sync |

There is no AI or model key, because there is nothing to point one at.
See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the annotated list.

---

## Local Setup

```bash
npm install
# create .env.local — DATABASE_URL and AUTH_SECRET are enough
npm run db:migrate
npm run dev                  # → http://localhost:3000
```

Try a board straight from the terminal, no server and no database needed:

```bash
npx tsx scripts/scrape.ts react --country DE
npx tsx scripts/scrape.ts --list --country BR
```

---

## Project Structure

```
src/
├── app/                         # App Router pages + API routes
│   ├── page.tsx                 # Search page (SSE consumer)
│   ├── dashboard/ favourites/ interviews/ stats/ settings/
│   └── api/
│       ├── scrape/route.ts      # Country-aware SSE search
│       ├── boards/route.ts      # Board coverage for a country
│       ├── graphql/route.ts     # Apollo Server handler
│       ├── cover-letter/stream/ # Template composer stream
│       ├── cv-adjust/stream/    # CV match report stream
│       └── uploads/             # CV binary storage
├── components/                  # Shared MUI components
├── graphql/                     # Schema + resolvers
├── lib/
│   ├── geo/                     # Country data and detection
│   ├── matching/                # Taxonomy, intent, BM25 scoring
│   ├── scrapers/
│   │   ├── registry.ts          # Board registry, country selection
│   │   ├── boards/              # One file per job board
│   │   ├── parse/               # JSON-LD, salary, work type, listings
│   │   ├── extract.ts           # Layered extraction
│   │   └── fetcher.ts           # HTTP + Playwright fetching
│   ├── coverLetter.ts  cvMatch.ts
│   └── data/  actions/          # Server data access and actions
scripts/scrape.ts                # Board smoke-test CLI
docs/                            # Architecture, adding a job board
```

---

## What used to be here

This project was previously built around OpenAI. The git history still shows it,
so for anyone reading back:

| Removed | Replaced by |
|---|---|
| GPT-4o-mini picking job links off listing pages | Per-board CSS selectors and job-URL patterns |
| GPT-4o-mini extracting job fields from page text | JSON-LD → microdata → meta → heuristics |
| `text-embedding-3-small` + cosine similarity | BM25 over a hand-written skill taxonomy |
| GPT-4o-mini query intent classification | Static taxonomy with token expansion |
| GPT-4o cover letters | Template composed from your CV and the posting |
| GPT-4o CV rewriting | CV ↔ posting keyword match report |
| LangGraph auto-apply agent | Removed (its endpoints already returned 410) |

The result costs nothing to run, works offline in tests, and can explain every
result it produces.
