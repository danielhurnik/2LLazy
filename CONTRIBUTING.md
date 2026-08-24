# Contributing

Thanks for looking. This project exists because job hunting is a grind and the
tools that claim to help mostly want a subscription. Anything that makes it
work for more people in more countries is welcome.

## Two rules that will not change

1. **No AI or LLM dependencies.** No model API, no embeddings, no
   "just a small local model". Everything the app does is deterministic code
   that runs offline, costs nothing, and can be unit-tested. A pull request that
   adds one will be declined regardless of how well it works.
2. **No paid API in the default path.** A fresh clone with a database URL must
   do everything the README describes. Optional integrations are allowed when
   they are environment-gated (`requiredEnv` on a board), degrade cleanly when
   the variable is absent, and are documented in `.env.example`.

These are not stylistic preferences. They are what makes the app free to run
and possible to test.

## Getting it running

You need Node.js 20 or newer and a PostgreSQL 14+ database.

```bash
git clone https://github.com/danielhurnik/2llazy.git
cd 2llazy
npm install
cp .env.example .env.local
```

Fill in `DATABASE_URL` and `AUTH_SECRET` in `.env.local`, then:

```bash
npm run db:migrate    # prisma migrate dev — applies migrations
npm run db:generate   # prisma generate — the client the typecheck needs
npm run dev           # http://localhost:3000
```

### A note on the database

Migrations (`prisma.config.ts`) and the seed script (`prisma/seed.ts`, via
`pg`) talk to Postgres over ordinary TCP and work against any server, local
included.

The running app does not. `src/lib/prisma.ts` builds its client with
`@prisma/adapter-neon`, which speaks Neon's serverless WebSocket protocol. A
Neon connection string works as-is; a plain local `postgresql://localhost:5432/…`
will let you migrate and seed but the app itself will fail to connect. Either
use a free Neon database for development, or run a WebSocket proxy in front of
your local Postgres. If you would rather the app worked against a plain local
server, that is a real and useful contribution — open an issue first so we can
agree on the approach.

### Signing in locally

There is no sign-up page. `/login` offers Google OAuth (needs
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and email + password, checked with
bcrypt against the `User` table. For local development the quickest path is to
create a user by hand:

```bash
# from the repo root, so node finds bcryptjs
node -e "console.log(require('bcryptjs').hashSync('devpassword', 10))"
npm run db:studio    # open the User table, add a row with that hash in `password`
```

Then sign in with that email and `devpassword`.

### Sample data

```bash
npx tsx prisma/seed.ts
```

The seed attaches sample postings, applications and interviews to the oldest
existing user, or to `SEED_USER_ID` if you set it. It only creates the
`demo@2llazy.local` account when the database has no users at all. Every write
is an upsert or guarded, so it is safe to re-run.

## Tests

```bash
npm test              # vitest run — unit and pipeline tests
npm run test:watch    # while you work
npm run test:coverage
npm run test:e2e      # playwright — starts the dev server itself if one is
                      # not already up, so it needs a working database and a
                      # user to sign in as
```

The unit tests never touch the network or the database. `tests/unit/pipeline.test.ts`
stubs the fetcher and drives the whole chain — country detection, board
selection, listing, detail pages, extraction, ranking — against fixture markup.
That is the test to copy when you add anything to the scraping path.

Before opening a pull request:

```bash
npm run lint
npm run typecheck
npm test
```

CI runs the same three on every push and pull request.

## The board CLI

Adding or debugging a board does not need the app, a database, or a session:

```bash
npx tsx scripts/scrape.ts react --country DE
npx tsx scripts/scrape.ts "node.js" --country CZ --board jobscz --deep
npx tsx scripts/scrape.ts --list --country BR
```

It prints per-board timings and errors, then the ranked results with the terms
each one matched. When a board silently breaks because a site changed its
markup, this is how you find out which one.

## Code style

The house rules, also in `CLAUDE.md`:

- **Read a file before editing it.** Especially in `src/lib/scrapers` and
  `src/lib/matching`, where the module comments explain why something is
  written the way it is.
- **Keep files under 500 lines.** If a board file is growing past that, the
  shared part belongs in `boards/shared.ts` or `boards/helpers.ts`.
- **Validate input at system boundaries.** API route bodies, board payloads,
  request headers. Board feeds change field types without warning — read them
  through zod with the lenient fragments in `boards/shared.ts`, never assume a
  shape.
- **Nothing in the repository root.** Code goes in `src/`, tests in `tests/`,
  docs in `docs/`, one-off tooling in `scripts/`.
- **Do not create files you do not need**, and do not add documentation nobody
  asked for. Prefer editing what exists.
- **Never commit secrets.** `.env.local` is ignored; keep it that way.
- **Explain the judgement calls in comments.** Tuning constants, selector
  choices and fallback orders should say *why*, so the next person can argue
  with them in a pull request instead of reverse-engineering them.

Practical conventions that come from the existing code rather than a linter:
functions stay small, errors are handled where they happen, and anything that
touches the network fails soft — a broken board returns `[]` and warns once,
it never throws into a search.

## Where things are

```
src/app/            Next.js App Router pages and API routes
src/lib/scrapers/   board registry, fetchers, extraction, parsers
src/lib/matching/   taxonomy, query intent, BM25 ranking
src/lib/geo/        country data and detection
prisma/             schema, migrations, seed
scripts/scrape.ts   board smoke-test CLI
tests/unit/         vitest, offline
tests/e2e/          playwright
docs/               architecture and the board guide
```

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) traces one search from the
request to the results and explains why each piece works the way it does. Read
it before changing anything in the search path.

## Good first contributions

**Add a job board for your country.** This is the most useful thing anyone can
do here, and it is deliberately small: one file, one line in the registry.
[`docs/ADDING_A_JOB_BOARD.md`](docs/ADDING_A_JOB_BOARD.md) walks through both
flavours with code you can copy. A country with no local board benefits far
more than one that already has four.

Other things that need doing:

- **Fix a broken board.** Sites change their markup constantly. Run
  `npx tsx scripts/scrape.ts <query> --country XX` and see which ones return
  nothing.
- **Improve the taxonomy.** `src/lib/matching/taxonomy-data.ts` is 42
  hand-written entries. Missing a stack you work in, or a role that keeps
  ranking wrong? That file is where it is fixed, and it is plain data.
- **Add a board test.** `tests/fixtures/feeds/` holds sample API payloads that
  no test consumes yet.
- **Add country data.** `src/lib/geo/data.ts` maps countries to their cities,
  languages and aliases, and drives location matching. Local spellings are
  welcome.

## Opening a pull request

Keep it to one thing. Say what you changed and why, and if it touches a board
or the ranker, paste real output — a few rows from `scripts/scrape.ts`, or the
before/after ordering for a search. That tells a reviewer more than a
description does.

If you are unsure whether something fits, open an issue first. That is cheaper
than writing code that gets declined.

Report security issues privately as described in
[`SECURITY.md`](SECURITY.md), not in a public issue. By participating you agree
to the [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
