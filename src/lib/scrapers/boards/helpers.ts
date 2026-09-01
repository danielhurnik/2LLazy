/**
 * Shared plumbing for HTML job boards.
 *
 * Every HTML board repeats the same three chores: walk listing pages politely,
 * fetch each detail page under a concurrency cap, and stop early once a page
 * holds nothing that was not already scraped. Factoring them out leaves each
 * board file with the only genuinely board-specific knowledge — its URL shape,
 * its selectors and its page budget.
 */
import type { FetchedPage } from "../fetcher";
import { extractJob } from "../extract";
import { selectJobLinks, type JobLink } from "../parse/listing";
import type { CountryCode, ScrapedJob, Seniority, WorkType } from "../types";

/** Freshness window reused by the deep-search early exit. */
const DEFAULT_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Seniority slugs used by the Czech boards (Cocuma, Jobstack, StartupJobs).
 * "medior" is the local word for mid-level — a plain "mid" returns nothing.
 */
export const SENIORITY_SLUGS: Record<Seniority, string> = {
  Junior: "junior",
  Mid: "medior",
  Senior: "senior",
  Lead: "lead",
};

/**
 * Primary language per country, used to build an `Accept-Language` header.
 * Local boards serve translated markup, and the extractor reads far more out
 * of a page in its native language than out of an English fallback.
 *
 * Deliberately local: `src/lib/geo` is about user location, not HTTP headers.
 */
const PRIMARY_LANGUAGE: Record<string, string> = {
  CZ: "cs", SK: "sk", PL: "pl", DE: "de", AT: "de", CH: "de", NL: "nl", BE: "nl",
  FR: "fr", ES: "es", IT: "it", PT: "pt", RO: "ro", HU: "hu", BG: "bg", HR: "hr",
  RS: "sr", GR: "el", SE: "sv", NO: "no", DK: "da", FI: "fi", EE: "et", LV: "lv",
  LT: "lt", UA: "uk", TR: "tr", IL: "he", AE: "ar", EG: "ar", MA: "fr", ID: "id",
  MY: "ms", TH: "th", VN: "vi", JP: "ja", KR: "ko", HK: "zh", TW: "zh", BR: "pt",
  AR: "es", CL: "es", CO: "es", MX: "es", PE: "es", UY: "es",
};

/** `Accept-Language` header for a board serving `country`. */
export function acceptLanguageFor(country: CountryCode | undefined): string {
  const code = (country ?? "").toUpperCase();
  const language = PRIMARY_LANGUAGE[code];
  if (!language) return "en-US,en;q=0.9";
  return `${language}-${code},${language};q=0.9,en;q=0.8`;
}

/** CSS/regex hints handed to `selectJobLinks`; one set per board. */
export interface LinkSelectors {
  cardSelector?: string;
  linkSelector?: string;
  urlPattern?: RegExp;
  limit?: number;
}

/**
 * Fetches detail pages in bounded-concurrency batches and maps them to
 * `ScrapedJob`, dropping every page that fails or yields no title. One dead
 * posting must never take the rest of the page down with it.
 */
export async function fetchJobDetails(
  links: JobLink[],
  opts: {
    source: string;
    country: CountryCode;
    fetcher: (url: string) => Promise<FetchedPage>;
    concurrency?: number;
    signal?: AbortSignal;
    defaultLocation?: string;
  },
): Promise<ScrapedJob[]> {
  const { source, country, fetcher, concurrency = 5, signal, defaultLocation = "" } = opts;
  const jobs: ScrapedJob[] = [];

  for (let i = 0; i < links.length; i += concurrency) {
    if (signal?.aborted) break;
    const batch = links.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (link): Promise<ScrapedJob | null> => {
        const page = await fetcher(link.url);
        const extracted = extractJob(page, {
          url: link.url,
          title: link.title,
          company: "",
          location: defaultLocation,
        });
        const title = (extracted.title || link.title || "").trim();
        if (!title) return null;
        return {
          title,
          company: (extracted.company || "").trim(),
          location: (extracted.location || defaultLocation).trim(),
          description: extracted.description || "",
          sourceUrl: link.url,
          source,
          salary: (extracted.salary || "").trim() || undefined,
          workType: toWorkType(extracted.workType),
          postedAt: extracted.postedAt ?? undefined,
          country: extracted.country || country,
        };
      }),
    );
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) jobs.push(result.value);
    }
  }

  return jobs;
}

/** Narrows whatever the extractor reported to the `WorkType` union. */
function toWorkType(raw: string | null | undefined): WorkType | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "onsite" || value === "on-site") return "Onsite";
  return undefined;
}

/**
 * Runs a page loop with early exit, dedupe across pages and a polite
 * inter-page delay. A failure on page 1 is fatal (the board is unreachable and
 * the caller should report it); a failure later just ends the walk, keeping
 * whatever the earlier pages produced.
 */
export async function paginate<T>(opts: {
  maxPages: number;
  delayMs?: number;
  signal?: AbortSignal;
  /** Dedupe key; defaults to the item's `sourceUrl` or `url` field. */
  keyOf?: (item: T) => string | undefined;
  onPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>;
}): Promise<T[]> {
  const { maxPages, delayMs = 800, signal, onPage } = opts;
  const keyOf = opts.keyOf ?? defaultKey;
  const collected: T[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    if (signal?.aborted) break;

    let result: { items: T[]; hasMore: boolean };
    try {
      result = await onPage(page);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }

    for (const item of result.items) {
      const key = keyOf(item);
      if (key !== undefined) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      collected.push(item);
    }

    if (!result.hasMore) break;
    if (page < maxPages) await sleep(delayMs, signal);
  }

  return collected;
}

function defaultKey(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const record = item as Record<string, unknown>;
  const key = record.sourceUrl ?? record.url;
  return typeof key === "string" ? key : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    // Removed on normal completion so a shared signal does not leak listeners.
    const onAbort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * True when every URL on this page was already scraped inside the freshness
 * window, which means a deeper walk would only re-fetch what the database
 * already has.
 *
 * Prisma is imported dynamically so importing a board never drags the database
 * client into contexts that do not need it (tests, edge runtimes).
 */
export async function pageAlreadyFresh(urls: string[], withinMs = DEFAULT_FRESH_MS): Promise<boolean> {
  if (urls.length === 0) return false;
  try {
    const { prisma } = await import("@/lib/prisma");
    const freshCount = await prisma.jobPosting.count({
      where: {
        sourceUrl: { in: urls },
        scrapedAt: { gte: new Date(Date.now() - withinMs) },
      },
    });
    return freshCount === urls.length;
  } catch {
    // No database in this context — never let bookkeeping stop a search.
    return false;
  }
}

/** Stateful cross-page filter keeping the first occurrence of each URL. */
export function newLinkDeduper(): (links: JobLink[]) => JobLink[] {
  const seen = new Set<string>();
  return (links) =>
    links.filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    });
}

/** Everything `runHtmlBoard` needs to walk one board end to end. */
export interface HtmlBoardOptions {
  /** Board slug, used only in the failure warning. */
  id: string;
  /** Value written to `ScrapedJob.source`. */
  source: string;
  /** Country tag applied to jobs the extractor could not place itself. */
  country: CountryCode;
  maxPages: number;
  deepSearch: boolean;
  signal?: AbortSignal;
  /** Listing URL for a 1-based page number. */
  buildUrl: (page: number) => string;
  fetchList: (url: string) => Promise<FetchedPage>;
  fetchDetail: (url: string) => Promise<FetchedPage>;
  select?: LinkSelectors;
  delayMs?: number;
  concurrency?: number;
  defaultLocation?: string;
  /** Board-specific fix-up applied to every job before it is returned. */
  refine?: (job: ScrapedJob) => ScrapedJob;
}

/**
 * The whole HTML-board pipeline: listing page → job links → detail pages →
 * `ScrapedJob[]`. Fails soft — a board that throws warns once and returns an
 * empty array, so one broken site can never break a search.
 */
export async function runHtmlBoard(opts: HtmlBoardOptions): Promise<ScrapedJob[]> {
  const dedupe = newLinkDeduper();

  try {
    return await paginate<ScrapedJob>({
      maxPages: opts.maxPages,
      delayMs: opts.delayMs,
      signal: opts.signal,
      onPage: async (page) => {
        const listing = await opts.fetchList(opts.buildUrl(page));
        const links = dedupe(selectJobLinks(listing, opts.select));
        if (links.length === 0) return { items: [], hasMore: false };

        const jobs = await fetchJobDetails(links, {
          source: opts.source,
          country: opts.country,
          fetcher: opts.fetchDetail,
          concurrency: opts.concurrency,
          signal: opts.signal,
          defaultLocation: opts.defaultLocation,
        });

        const items = opts.refine ? jobs.map(opts.refine) : jobs;
        // A deep search walks many pages; stop as soon as a page is entirely
        // made of postings the database already holds.
        const hasMore = opts.deepSearch
          ? !(await pageAlreadyFresh(links.map((link) => link.url)))
          : true;
        return { items, hasMore };
      },
    });
  } catch (err) {
    console.warn(`[${opts.id}] scrape failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
