# 2LLazy

A job-search and application tracker for developers. It scrapes job boards,
ranks the results against your search, and tracks every application from
"found it" through to the interview.

**No AI. No API keys. No paid services.** Everything the app does — finding
jobs, reading job pages, ranking results, drafting cover letters — is plain
deterministic code you can read, test and fix. Point it at a Postgres database
and it runs.

## Why

Looking for a developer job is a grind, and most tools that claim to help
either want a subscription or quietly send your CV to somebody's model. This
one does neither. It is free to run, free to fork, and it works the same on
your laptop as it does on a server.

## What it does

- **Searches job boards for your country.** Board selection is driven by where
  you are: local boards where they exist, plus worldwide remote boards
  everywhere. A developer in Nairobi and a developer in Prague both get
  results.
- **Reads job pages properly.** Most boards publish
  [`schema.org/JobPosting`](https://schema.org/JobPosting) structured data.
  The extractor reads that first, then microdata, then meta tags, then falls
  back to heuristics — so title, company, salary and work type come out clean
  without anything guessing.
- **Ranks results and tells you why.** A BM25 lexical ranker scores postings
  against a hand-built skill taxonomy. Every result shows which of your search
  terms it actually matched, so a bad ranking is something you can see and
  report rather than shrug at.
- **Tracks applications.** Favourites, a status pipeline, interview calendar,
  and cover-letter drafts assembled from your CV and the posting.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Material UI v5
- Prisma 7 + PostgreSQL
- Apollo GraphQL endpoint (`/api/graphql`) and SSE routes for streaming
- Cheerio for parsing, Playwright (optional) for JavaScript-heavy boards

## Requirements

1. Node.js 20+
2. PostgreSQL 14+

That is the whole list.

## Setup

```bash
git clone https://github.com/danielhurnik/2llazy.git
cd 2llazy
npm install
cp .env.example .env.local     # fill in DATABASE_URL and a password
npm run db:migrate
npm run db:generate
npm run dev
```

Open <http://localhost:3000>.

## Configuration

Required:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | NextAuth signing secret (any long random string) |
| `ADMIN_PASSWORD` | The password you log in with |

Optional — everything still works without these:

| Variable | What it unlocks |
|---|---|
| `PLAYWRIGHT_ENABLED=true` | Renders JavaScript-heavy boards, which adds several sources |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna's free tier, adding local boards in ~19 countries |
| `DEFAULT_COUNTRY` | Fallback country when yours cannot be detected |

See [`.env.example`](.env.example) for the full annotated list.

## Trying a board from the terminal

Adding or debugging a board does not need the app running:

```bash
npx tsx scripts/scrape.ts react --country DE
npx tsx scripts/scrape.ts "node.js" --country CZ --board jobscz --deep
npx tsx scripts/scrape.ts --list --country BR
```

## Routes

| Route | Description |
|---|---|
| `/` | Search jobs, with live progress as each board reports in |
| `/favourites` | Saved jobs; promote them into the tracker |
| `/dashboard` | Application pipeline and cover-letter drafts |
| `/interviews` | Monthly interview and reminder calendar |
| `/stats` | Where your applications are going |
| `/settings` | Profile, CV uploads, country, and which boards are active |

## Contributing

Job boards change their markup constantly, and no one person can keep up with
every country. **Adding a board is one file** — see
[`docs/ADDING_A_JOB_BOARD.md`](docs/ADDING_A_JOB_BOARD.md). If the app does not
cover your country yet, that is the most useful thing you can fix.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has setup and style;
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how a search flows
through the system.

Two rules that will not change:

1. **No AI or LLM dependencies.**
2. **No paid API in the default path.** Optional integrations must be
   environment-gated and degrade cleanly when they are absent.

## Scripts

```bash
npm run dev          # development server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # unit tests (vitest)
npm run test:e2e     # end-to-end tests (playwright)
npm run db:migrate   # apply migrations
npm run db:studio    # browse the database
```

## Licence

MIT — see [`LICENSE`](LICENSE).
