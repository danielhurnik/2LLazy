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
- **Reads employers' own job boards.** Greenhouse, Lever, Ashby,
  SmartRecruiters, Recruitee and Workable all publish their customers' boards
  as public JSON, so postings arrive straight from the company — usually the
  day the role opens, before any aggregator has it.
- **Reads job pages properly.** Most boards publish
  [`schema.org/JobPosting`](https://schema.org/JobPosting) structured data.
  The extractor reads that first, then microdata, then meta tags, then falls
  back to heuristics — so title, company, salary and work type come out clean
  without anything guessing.
- **Ranks results and tells you why.** A BM25 lexical ranker scores postings
  against a hand-built skill taxonomy. Every result shows which of your search
  terms it actually matched, so a bad ranking is something you can see and
  report rather than shrug at.
- **Tracks applications.** Favourites, a status pipeline, and a monthly
  interview calendar that can sync to Google Calendar.
- **Helps with the application itself.** Cover-letter drafts assembled from
  your CV and the posting, and a CV match report that shows which of the
  posting's requirements your CV already covers — quoting the line that covers
  it — and which it does not. Nothing is rewritten and nothing is invented.
- **Auto-apply, where it is safe to.** With Playwright enabled, the dashboard
  can fill a StartupJobs application form for you. A field it cannot place is
  left empty, never guessed. On every other board the button opens the posting
  so you can apply by hand.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Material UI v5
- Prisma 7 + PostgreSQL
- Auth.js v5 (email and password, optional Google sign-in)
- Apollo GraphQL endpoint (`/api/graphql`) and server-sent events for streaming
- Cheerio for parsing, Playwright (optional) for JavaScript-heavy boards and
  auto-apply

## Requirements

1. Node.js 20+
2. PostgreSQL 14+

That is the whole list. Playwright is optional; see
[Configuration](#configuration).

## Setup

```bash
git clone https://github.com/danielhurnik/2LLazy.git
cd 2LLazy
npm install
```

Create `.env.local` with the two required values:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/twollazy?schema=public"
AUTH_SECRET="<any long random string>"
```

Generate a secret with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

Then create the schema, collect some jobs and start the app:

```bash
npm run db:migrate
npm run db:generate
npm run ingest -- --country CZ
npm run dev
```

Swap `CZ` for your own country's two-letter code. You can skip the ingest step
and search straight away, but your first results then come only from what the
live search can fetch in a few seconds.

There is no sign-up page. For a local account, run
`npx tsx prisma/seed-test-user.ts`, which creates `test@test.com` with the
password `testtest`. Use it on your own machine only. Then open
<http://localhost:3000> and sign in. With the Google variables set, signing in
with Google creates your account instead. On a server, follow
[Create the first account](docs/SELF_HOSTING.md#3-create-the-first-account).
`npx tsx prisma/seed.ts` adds sample postings, applications and interviews to
look around with.

<details>
<summary>If <code>db:migrate</code> fails on the <code>vector</code> extension</summary>

The migration history predates this rewrite and one early migration still
creates the pgvector extension, even though nothing uses vectors any more. If
your Postgres does not have pgvector installed, skip the history entirely:

```bash
npx prisma db push     # builds the current schema directly
npm run db:indexes     # adds the two search indexes db push cannot create
```

</details>

## Configuration

Required:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Session signing secret (any long random string) |
| `AUTH_URL` | Production only: the public URL, e.g. `https://jobs.example.com`. Behind a reverse proxy, sign-in fails with `UntrustedHost` without it. Not needed in development |

Optional — everything still works without these:

| Variable | What it unlocks |
|---|---|
| `PLAYWRIGHT_ENABLED=true` | Live search on JavaScript-heavy boards (Jooble, StartupJobs, Jobs.cz, SEEK and others) and auto-apply. Run `npx playwright install chromium` once. Ingestion does not need it: it reaches those boards through their sitemaps |
| `APPLY_HEADFUL=true` | Shows the auto-apply browser window, so you can watch the form being filled |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Adzuna's free tier, adding a local board in 19 countries |
| `DEFAULT_COUNTRY` | Fallback country when yours cannot be detected (default `US`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google sign-in and Google Calendar sync for interviews |

See [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the full annotated list.

## Collecting jobs

Scraping runs as a script, not inside a web request — a polite crawl takes
minutes and serverless functions are capped at seconds. The script has no
deadline, paces itself per host, and needs no browser:

```bash
npm run ingest -- --country CZ            # collect into the database
npm run ingest -- --country DE --limit 200
npm run ingest -- --country BR --dry-run  # scrape without writing
npm run ingest -- --help                  # every option
```

It is incremental: a repeat run only fetches postings the board says have
changed (`--full` walks everything again). Schedule it with cron, or use the
included GitHub Actions workflow
([`.github/workflows/ingest.yml`](.github/workflows/ingest.yml)). It runs twice
a day for CZ, DE, GB and US, can be started by hand for any country, and needs
one repository secret: `DATABASE_URL`.

A search in the app runs a short live pass over the boards — under 20 seconds
— and then answers from the database. Whatever the boards miss in that time,
the ingester has usually already collected.

### Trying a single board

Debugging a board does not need the app or a database:

```bash
npm run scrape -- react --country DE
npm run scrape -- "node.js" --country CZ --board jobscz --deep
npm run scrape -- --list --country BR
```

## Self-hosting

The app is meant to run on your own machine and your own domain — there is no
hosting provider in the loop and no managed database. Put `AUTH_SECRET` (and,
behind a proxy, `AUTH_URL`) in a `.env` file next to `docker-compose.yml`, then:

```bash
docker compose up -d                         # PostgreSQL, migrations, app
docker compose run --rm ingest --country CZ  # collect jobs for one country
```

[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) covers TLS, the reverse proxy,
scheduling the ingester and backups. `/api/health` reports whether the app and
its database are up.

## Routes

| Route | Description |
|---|---|
| `/` | Search jobs, with live progress as each board reports in |
| `/favourites` | Saved jobs; promote them into the tracker |
| `/dashboard` | Application pipeline, cover letters, CV match reports and auto-apply |
| `/interviews` | Monthly interview and reminder calendar |
| `/stats` | Where your applications are going |
| `/settings` | Profile, CV uploads, country, Google Calendar, and which boards are active |
| `/login` | Sign in with email and password, or with Google |

## Contributing

Job boards change their markup constantly, and no one person can keep up with
every country. **Adding a board is one file** — see
[`docs/ADDING_A_JOB_BOARD.md`](docs/ADDING_A_JOB_BOARD.md). If the app does not
cover your country yet, that is the most useful thing you can fix.

[`CONTRIBUTING.md`](CONTRIBUTING.md) has setup and style;
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how a search flows
through the system; [`docs/JOB_SOURCES.md`](docs/JOB_SOURCES.md) catalogues
every board we read and every one worth adding next.

Two rules that will not change:

1. **No AI or LLM dependencies.**
2. **No paid API in the default path.** Optional integrations must be
   environment-gated and degrade cleanly when they are absent.

## Scripts

```bash
npm run dev               # development server
npm run build             # production build
npm run start             # serve the production build
npm run lint              # eslint
npm run typecheck         # tsc --noEmit
npm test                  # unit tests (vitest)
npm run test:e2e          # end-to-end tests (playwright)
npm run ingest            # collect jobs into the database
npm run scrape            # try one board from the terminal
npm run verify:employers  # check the employer ATS slugs still resolve
npm run db:migrate        # apply migrations
npm run db:generate       # generate the Prisma client
npm run db:indexes        # add the search indexes after a db push
npm run db:studio         # browse the database
npm run db:reset          # wipe the database and re-run every migration
```

## Licence

MIT — see [`LICENSE`](LICENSE).
