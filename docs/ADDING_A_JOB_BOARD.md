# Adding a job board

If 2LLazy does not cover your country yet, this is the most useful thing you
can fix. A board is one file in `src/lib/scrapers/boards/` plus one import and
one line in `src/lib/scrapers/registry.ts`. Nothing else changes — no database
migration, no UI change, no config file.

Read one existing board before you start. `remotive.ts` is the shortest API
board, `cocuma.ts` the shortest HTML board, and `jobstack.ts` shows the minimum
an HTML board can get away with.

## Which flavour is your board?

| The board has… | Use | Model it on |
|---|---|---|
| a public JSON or RSS feed | `fetchJson` / `fetchText` | `remotive.ts` |
| server-rendered listing pages | `runHtmlBoard` with `fetchPage` | `cocuma.ts` |
| listings that only appear after JavaScript runs | `runHtmlBoard` with `pwFetch` and `requiresBrowser: true` | `startupjobs.ts` |

Check for a feed first: `/api/jobs`, `/jobs.json`, `/feed`, `/rss`. An API board
is one request instead of forty, it does not break when the site is restyled,
and it needs no browser.

## The `BoardDefinition`

Every board exports one object of this shape
(`src/lib/scrapers/types.ts`):

```ts
export interface BoardDefinition {
  /** Stable lowercase slug, e.g. "remotive". Unique across the registry. */
  id: string;
  /** Human-readable name shown in the UI, e.g. "Remotive". */
  name: string;
  /** Uppercase value written to JobPosting.source, e.g. "REMOTIVE". */
  source: string;
  /** Board homepage, shown in the UI. */
  homepage: string;
  /** Countries served, or [WORLDWIDE]. */
  countries: CountryCode[];
  /** True when the board lists only remote roles. */
  remoteOnly: boolean;
  /** True when the board needs a real browser (SPA) to return listings. */
  requiresBrowser: boolean;
  /** Env vars the board needs; missing ones make the registry skip it. */
  requiredEnv?: string[];
  /** One-line note surfaced in Settings, e.g. "free API, no key required". */
  note?: string;
  scrape: ScrapeFn;
}
```

Field by field:

- **`id`** is the slug you pass to `--board` on the CLI and the key the registry
  uses. Lowercase, no spaces.
- **`source`** is stored on every posting as `JobPosting.source`. It is a plain
  `String` column, not an enum, precisely so adding a board never requires a
  migration.
- **`countries`** drives selection. `["DE"]` means the board only runs for users
  in Germany. `["CZ", "SK"]` means both. `[WORLDWIDE]` (the exported constant
  `"*"`) means every country — use it only for boards that genuinely serve
  anyone, which in practice means worldwide remote boards. A user in a country
  with no local board still gets every `WORLDWIDE` board, and that baseline is
  what makes the app usable in countries nobody has written a board for.
- **`remoteOnly`** describes the *board*, not the search. It only affects UI
  labels and one selection detail; the ranker handles the user's remote filter.
- **`requiresBrowser: true`** tells the registry the board is useless without
  Playwright. When `PLAYWRIGHT_ENABLED` is not `"true"`, such a board is never
  selected and the Settings screen explains why. Set it only if you have
  actually confirmed a plain GET returns no listings — a browser costs seconds
  per page and rules the board out for everyone who has not enabled Playwright.
- **`requiredEnv`** lists environment variables the board cannot work without.
  `boardsForCountry` calls `missingEnvFor` and skips the board when any is
  missing, so a board with credentials fails at selection time (quietly, with a
  reason in Settings) instead of at request time. Adzuna is the only board that
  uses this today. **Any board needing a paid key does not belong in the default
  path** — see the rule in [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- **`note`** is one line shown to users in Settings. "free API, no key required"
  or "Czech product and tech roles".

## The `ScrapeQuery` you receive

```ts
export interface ScrapeQuery {
  query: string;              // raw user query, never empty
  seniority: Seniority | null; // "Junior" | "Mid" | "Senior" | "Lead" | null
  city: string;               // "" when unset
  country: CountryCode;       // ISO 3166-1 alpha-2 the search targets
  deepSearch: boolean;        // fetch more pages
  remoteOnly: boolean;        // restrict to remote roles
  intent: QueryIntent;        // deterministic structured intent
  signal?: AbortSignal;       // cancels when the client disconnects
}
```

Treat every field as advisory. A board that cannot filter by city should still
return results for the query. Use `q.intent.scrapingKeyword` for URL parameters
when the board has a single search box — it is the best single keyword the
taxonomy could derive ("react.js developer" → "React") — and fall back to
`q.query`. Pass `q.signal` into every fetch so an abandoned search stops
fetching.

## Fail soft — the one rule you cannot break

**A board that cannot do its job returns `[]`. It never throws.**

Boards run under `Promise.allSettled`, but the search still has to survive one
site being down, restyled, rate-limiting you, or returning a payload shaped
differently from last week. `runHtmlBoard` already wraps everything in a
try/catch that warns once and returns `[]`. In an API board you do it yourself:
wrap the fetch, wrap the parse, and use `createWarner` so a dead board leaves
exactly one line in the log rather than one per page.

## An API board

Adapted from `remotive.ts`. The endpoint and field names below are placeholders
— replace them with your board's real ones.

```ts
/**
 * Example Board — free JSON API of German IT jobs, no key required.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  htmlToText,
  isRecord,
  looseString,
  matchesQuery,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const ENDPOINT = "https://api.example-board.de/v1/jobs";
const BOARD_ID = "exampleboard";
const COUNTRY = "DE";

/**
 * Feeds change field types without warning, so read every optional field
 * through `looseString` (accepts null as readily as a missing key) and require
 * only what a posting is worthless without.
 */
const jobSchema = z.object({
  title: z.string().min(1),
  employer: looseString,
  city: looseString,
  body_html: looseString,
  apply_url: z.string().min(1),
  published_at: looseString,
});

/** Exported so a test can assert the URL without touching the network. */
export function buildExampleBoardUrl(q: ScrapeQuery): string {
  const params = new URLSearchParams({
    q: q.intent?.scrapingKeyword || q.query,
    per_page: String(q.deepSearch ? 100 : 50),
  });
  if (q.city) params.set("location", q.city);
  return `${ENDPOINT}?${params.toString()}`;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const url = buildExampleBoardUrl(q);

  let payload: unknown;
  try {
    payload = await fetchJson<unknown>(url, { signal: q.signal });
  } catch (err) {
    warn(`fetch failed for ${url}`, err);
    return [];
  }

  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    warn(`unexpected payload shape from ${url}`);
    return [];
  }

  const jobs: ScrapedJob[] = [];
  for (const item of payload.results) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;      // one bad item never kills the batch
    const raw = parsed.data;

    const description = htmlToText(raw.body_html);
    // Only needed when the API has no server-side search. `matchesQuery` is
    // deliberately permissive — precision is the ranker's job, and
    // over-filtering here starves it of candidates.
    if (!matchesQuery(`${raw.title} ${description}`, q)) continue;

    jobs.push({
      title: str(raw.title),
      company: str(raw.employer) || "Unknown",
      location: str(raw.city) || "Germany",
      description,
      sourceUrl: str(raw.apply_url),
      source: "EXAMPLEBOARD",
      postedAt: toDate(raw.published_at),
      country: COUNTRY,
    });
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const exampleBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Example Board",
  source: "EXAMPLEBOARD",
  homepage: "https://www.example-board.de",
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: false,
  note: "free JSON API, no key required",
  scrape,
};
```

The helpers in `boards/shared.ts` do the tedious parts and none of them throw:

| Helper | What it does |
|---|---|
| `str(value)` | any scalar as a trimmed string, `""` otherwise |
| `num(value)` | a finite positive number, or `undefined` |
| `strList(value)` | an unknown array flattened to non-empty strings |
| `toDate(value)` | unix seconds, unix millis, ISO, or `"YYYY-MM-DD HH:MM:SS"` |
| `htmlToText(html)` | readable plain text, capped at 6000 chars |
| `formatSalaryRange(min, max, currency, unit)` | `"$90,000 - $120,000 per year"`, or `undefined` |
| `workTypeFromText(...parts)` | `"Remote"` / `"Hybrid"` / `"Onsite"` / `""` |
| `resolveCountry(locationText)` | the ISO code a free-form location names, if any |
| `matchesQuery(text, q)` | permissive relevance gate for feeds with no search |
| `sortByLocationPreference(jobs, q)` | reorders (never drops) by city → country → region → worldwide |
| `dedupeByUrl(jobs)` | first posting per source URL, order preserved |
| `capJobs(jobs)` | applies the 120-per-board ceiling |
| `createWarner(id)` | one warning per scrape, not one per page |

For a board that paginates, see `adzuna.ts` — `pageBudget(q.deepSearch)` picks
the page count and `delay(PAGE_DELAY_MS, q.signal)` keeps the requests polite.

## An HTML board

Adapted from `cocuma.ts`. `runHtmlBoard` owns the whole pipeline: listing page
→ job links → detail pages → `ScrapedJob[]`, with cross-page dedupe, a polite
inter-page delay, bounded concurrency, and the fail-soft try/catch.

```ts
/**
 * Example Jobs — German IT board. Server-rendered, so a plain fetch is enough.
 */
import { fetchPage } from "../fetcher";
import { acceptLanguageFor, runHtmlBoard, SENIORITY_SLUGS } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.example-jobs.de";
const COUNTRY = "DE";

export const exampleJobsBoard: BoardDefinition = {
  id: "examplejobs",
  name: "Example Jobs",
  source: "EXAMPLEJOBS",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: false,
  note: "German IT jobs",
  scrape: (q) => {
    const acceptLanguage = acceptLanguageFor(COUNTRY);
    const seniority = q.seniority ? SENIORITY_SLUGS[q.seniority] : "";

    return runHtmlBoard({
      id: "examplejobs",
      source: "EXAMPLEJOBS",
      country: COUNTRY,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Germany",
      buildUrl: (page) => {
        const params = new URLSearchParams({ q: q.query });
        if (seniority) params.set("level", seniority);
        if (page > 1) params.set("page", String(page));
        return `${BASE}/stellen?${params.toString()}`;
      },
      fetchList: (url) => fetchPage(url, { signal: q.signal, acceptLanguage }),
      fetchDetail: (url) => fetchPage(url, { signal: q.signal, acceptLanguage }),
      select: { urlPattern: /example-jobs\.de\/stelle\//i },
      concurrency: 6,
    });
  },
};
```

Notes on the options:

- **`buildUrl(page)`** takes a 1-based page number. Page 1 usually has no `page`
  parameter at all — match whatever the site itself links to.
- **`acceptLanguageFor(country)`** builds an `Accept-Language` header from a
  per-country language table in `helpers.ts`. Local boards serve translated
  markup, and the extractor reads far more out of a page in its native language
  than out of an English fallback. Use it.
- **`SENIORITY_SLUGS`** maps `Junior | Mid | Senior | Lead` to the slugs the
  Czech boards use — note `Mid` → `"medior"`, which is the local word. If your
  board expects different values, write your own small map in your board file
  rather than changing the shared one.
- **`maxPages`** — one page for a normal search, three to five for a deep one,
  is the going rate. Be conservative: each listing page costs one fetch plus up
  to 60 detail fetches.
- **`concurrency`** caps simultaneous detail fetches. Existing boards use 5–6.
- **`refine`** is an optional `(job: ScrapedJob) => ScrapedJob` applied to every
  posting before it is returned, for a fix-up only your board knows about. No
  board needs it today.
- **`delayMs`** is the gap between listing pages; it defaults to 800ms. Do not
  set it lower.

## You probably do not need per-field selectors

This surprises people coming from other scrapers: there is **no** `titleSelector`,
`companySelector` or `salarySelector`, and adding one is almost never the fix.

The detail pages are read by `extractJob` (`src/lib/scrapers/extract.ts`), which
takes structured data over guesses:

1. `schema.org/JobPosting` JSON-LD — published by most boards because Google
   Jobs requires it (confidence 0.95)
2. microdata, the same vocabulary in `itemprop` attributes (0.85)
3. OpenGraph / meta tags / `<h1>` / `<title>` (0.60)
4. heuristics over the visible text: salary regexes, work-type keywords,
   company from breadcrumb or host (0.40)
5. whatever your board already knew — link text, its country (0.20)

So the only board-specific knowledge `runHtmlBoard` really needs is **which
links on the listing page are jobs**. That is `select`:

```ts
select: {
  urlPattern: /example-jobs\.de\/stelle\//i, // strongly preferred, always supply it
  cardSelector: "[class*='job-item'], article", // optional: cleaner titles
  linkSelector: "a.job-link",                   // optional: the anchor inside a card
  limit: 60,                                    // optional, default 60
}
```

- `urlPattern` is the one you should always supply. Without it, a generic
  multilingual set of job-URL shapes is used, which works but is looser.
- `cardSelector` is worth adding when the listing has real cards: a card's own
  heading beats its link text, which is often "Apply" or an icon.
- Navigation, legal and locale links are filtered out for you, tracking
  parameters are stripped, and relevance is **not** decided here. Follow every
  plausible job link and let the ranker in `src/lib/matching` do the filtering,
  where it can be tested.

If a board publishes no JSON-LD and the extraction comes out poor, the fix is
usually a better `cardSelector` (so the hint title is right) or a contribution
to the shared parsers in `src/lib/scrapers/parse/`, not a new per-board
selector API.

## Register it

`src/lib/scrapers/registry.ts` — one import and one entry:

```ts
import { exampleBoard } from "./boards/exampleboard";

const BOARDS: BoardDefinition[] = [
  // …
  exampleBoard,
];
```

That is the whole wiring. Board selection, the Settings screen, the
`--list` CLI flag and `countriesWithLocalBoards()` all read from this array.

## Try it from the terminal

`scripts/scrape.ts` runs boards without a database, a session, or the Next.js
server:

```bash
# every board that applies to Germany
npx tsx scripts/scrape.ts react --country DE

# just yours
npx tsx scripts/scrape.ts react --board exampleboard --country DE

# what is registered for a country, and why anything is disabled
npx tsx scripts/scrape.ts --list --country DE

# more pages, a city filter, a seniority, raw JSON
npx tsx scripts/scrape.ts "node.js" --country DE --city Berlin -s Senior --deep --json
```

There is also `npm run scrape -- react --country DE`, which is the same script.

The output prints per-board timings and error messages, then the ranked
postings with the terms each one matched. What to look for:

- **0 jobs, no error** — your `urlPattern` matched nothing, or the listing needs
  a browser. Check `--list` first; if the board is disabled it never ran.
- **jobs with empty companies or the host name as the company** — the pages
  carry no JSON-LD and extraction fell through to heuristics.
- **everything below the relevance threshold** (printed with a `·`) — the
  postings came back but the ranker is not convinced. Usually the descriptions
  are empty, which means detail extraction is failing.

## Testing without the network

Board tests must not hit the internet: CI runs offline and a test that depends
on a live site fails the day the site changes. Copy the pattern from
`tests/unit/pipeline.test.ts` — mock the fetcher module, serve fixture markup,
assert on the mapped `ScrapedJob`.

```ts
import { describe, expect, it, vi } from "vitest";

const LISTING = `<!doctype html><html><body>
  <div class="job-item"><h3>Senior React Developer</h3>
    <a href="/stelle/senior-react-developer-101">Detail</a></div>
</body></html>`;

const DETAIL = `<!doctype html><html><head>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"JobPosting",
   "title":"Senior React Developer",
   "description":"React, TypeScript and Next.js.",
   "hiringOrganization":{"@type":"Organization","name":"Pixel Labs"},
   "jobLocation":{"@type":"Place","address":{"addressLocality":"Berlin","addressCountry":"DE"}},
   "datePosted":"2026-08-15"}
  </script></head><body><h1>Senior React Developer</h1></body></html>`;

const PAGES: Record<string, string> = {
  "/stellen": LISTING,
  "/stelle/senior-react-developer-101": DETAIL,
};

vi.mock("@/lib/scrapers/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scrapers/fetcher")>();
  const serve = async (url: string) => {
    const html = PAGES[new URL(url).pathname];
    if (!html) throw new Error(`HTTP 404 for ${url}`);
    return { ...actual.parseDocument(html, url), status: 200 };
  };
  return { ...actual, fetchPage: serve, rawFetch: serve };
});

// Imported after the mock so the board picks up the stubbed fetcher.
const { exampleJobsBoard } = await import("@/lib/scrapers/boards/examplejobs");
const { classifyQueryIntent } = await import("@/lib/matching");

describe("examplejobs", () => {
  it("maps a listing page to ScrapedJob", async () => {
    const jobs = await exampleJobsBoard.scrape({
      query: "react",
      seniority: null,
      city: "",
      country: "DE",
      deepSearch: false,
      remoteOnly: false,
      intent: classifyQueryIntent("react"),
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe("Pixel Labs");
    expect(jobs[0].country).toBe("DE");
    expect(jobs[0].source).toBe("EXAMPLEJOBS");
  });
});
```

Longer fixtures go in `tests/fixtures/pages/` (HTML) or `tests/fixtures/feeds/`
(API payloads) and are read with `readFileSync`, the way
`tests/unit/extract.test.ts` does it. `tests/fixtures/feeds/remotive.json` and
`remoteok.json` are hand-authored sample payloads that no test consumes yet — a
first API-board test is a welcome contribution on its own.

Two behaviours worth asserting for any board:

- it returns `[]` rather than throwing when the site is unreachable;
- it does not follow navigation links (`/login`, `/about`, locale switches).

Run them with `npm test`, or `npm run test:watch` while you work.

## Pull request checklist

- [ ] One new file in `src/lib/scrapers/boards/`, under 500 lines, with a module
      comment saying what the board is and why it is scraped the way it is.
- [ ] `id` is a unique lowercase slug; `source` is its uppercase form.
- [ ] `countries` lists real ISO 3166-1 alpha-2 codes, or `[WORLDWIDE]` only if
      the board genuinely serves everyone.
- [ ] `requiresBrowser: true` only if you confirmed a plain GET returns nothing.
- [ ] No API key in the default path. If the board needs credentials, declare
      them in `requiredEnv`, make sure the board is skipped without them, and
      document them in `.env.example`.
- [ ] The board returns `[]` on failure and never throws.
- [ ] Imported and added to `BOARDS` in `src/lib/scrapers/registry.ts`.
- [ ] A test that runs offline.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` all pass.
- [ ] Paste the output of `npx tsx scripts/scrape.ts <query> --board <id> --country XX`
      into the pull request — a few real rows tell a reviewer more than any
      description of the board.

A board for a country that has none yet is worth more than a fifth board for a
country that has four. If you are unsure whether a site is worth adding, open
an issue with the URL and ask.
