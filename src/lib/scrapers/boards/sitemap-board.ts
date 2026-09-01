/**
 * The generic non-browser board walker.
 *
 * This is what replaces Playwright. A single-page job board renders its
 * *listing* in the browser, which is why the old code needed Chromium — but it
 * also publishes a sitemap (for Google) and server-renders every *detail* page
 * with `schema.org/JobPosting` markup (for Google Jobs). Those two facts
 * together mean a plain HTTP client can collect the whole board:
 *
 *   robots.txt → sitemap index → job URLs → detail pages → JSON-LD → jobs
 *
 * It is slower per posting than an API but costs nothing, needs no browser
 * binary, and — because sitemaps carry `lastmod` — a repeat run only fetches
 * what actually changed. That incremental property is what keeps a daily
 * ingest well under any board's rate limit.
 */
import { extractJob } from "../extract";
import { fetchPage, fetchText, fetchXml } from "../fetcher";
import { isAllowed, parseRobots, type RobotsRules, PERMISSIVE } from "../http/robots";
import { configureHost } from "../http/limiter";
import { discoverFromSitemap, fallbackSitemapUrls, type SitemapEntry } from "../discovery/sitemap";
import type { CountryCode, IngestContext, ScrapedJob, WorkType } from "../types";

export interface SitemapBoardOptions {
  /** Board slug, used in warnings. */
  id: string;
  /** Value written to `ScrapedJob.source`. */
  source: string;
  /** Origin to read robots.txt and sitemaps from, e.g. `https://www.jobs.cz`. */
  origin: string;
  /** Country tag for postings the extractor cannot place itself. */
  country: CountryCode;
  /** Job-detail URL shape for this board. */
  urlPattern: RegExp;
  /** Only open child sitemaps matching this — boards publish many kinds. */
  sitemapPattern?: RegExp;
  /** Explicit sitemap URLs, when robots.txt does not advertise the right one. */
  sitemapUrls?: string[];
  acceptLanguage?: string;
  /** Board-specific fix-up applied to each posting. */
  refine?: (job: ScrapedJob) => ScrapedJob;
}

/** Cached robots rules per origin, so one run reads each robots.txt once. */
const robotsCache = new Map<string, Promise<RobotsRules>>();

async function loadRobots(origin: string, signal?: AbortSignal): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const promise = (async (): Promise<RobotsRules> => {
    try {
      const text = await fetchText(`${origin.replace(/\/+$/, "")}/robots.txt`, {
        signal,
        retries: 1,
      });
      const rules = parseRobots(text);

      // A stated Crawl-delay is the host telling us its preferred pace. Obey it
      // when it is slower than our default; never speed up because of it.
      if (rules.crawlDelaySeconds && rules.crawlDelaySeconds > 0) {
        const host = new URL(origin).host;
        configureHost(host, {
          requestsPerSecond: Math.min(1 / rules.crawlDelaySeconds, 1.5),
          concurrency: 1,
        });
      }
      return rules;
    } catch {
      // No robots.txt, or unreachable: crawl conservatively rather than not at all.
      return { ...PERMISSIVE };
    }
  })();

  robotsCache.set(origin, promise);
  return promise;
}

/** Sitemap URLs to try, preferring the ones the host advertises itself. */
function sitemapCandidates(opts: SitemapBoardOptions, rules: RobotsRules): string[] {
  const advertised = rules.sitemaps.filter((url) =>
    opts.sitemapPattern ? opts.sitemapPattern.test(url) || /sitemap/i.test(url) : true,
  );
  return [...(opts.sitemapUrls ?? []), ...advertised, ...fallbackSitemapUrls(opts.origin)];
}

function toWorkType(raw: string | null | undefined): WorkType | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "remote") return "Remote";
  if (value === "hybrid") return "Hybrid";
  if (value === "onsite" || value === "on-site") return "Onsite";
  return undefined;
}

/**
 * Collects a board through its sitemap, yielding postings as they are read.
 *
 * Never throws: a board that cannot be reached yields nothing and warns once,
 * exactly like the live scrapers, so one dead board cannot end an ingest run.
 */
export async function* ingestViaSitemap(
  opts: SitemapBoardOptions,
  ctx: IngestContext,
): AsyncGenerator<ScrapedJob> {
  const warn = (message: string) => console.warn(`[${opts.id}] ${message}`);

  let rules: RobotsRules;
  try {
    rules = await loadRobots(opts.origin, ctx.signal);
  } catch {
    rules = { ...PERMISSIVE };
  }

  let entries: SitemapEntry[] = [];
  let staleTotal = 0;
  for (const candidate of sitemapCandidates(opts, rules)) {
    if (ctx.signal?.aborted) return;
    if (!isAllowed(rules, candidate)) continue;
    let stale = 0;
    try {
      ({ entries, stale } = await discoverFromSitemap(candidate, {
        urlPattern: opts.urlPattern,
        sitemapPattern: opts.sitemapPattern,
        since: ctx.since,
        limit: ctx.limit,
        signal: ctx.signal,
        fetchXml: (url) => fetchXml(url, { signal: ctx.signal, acceptLanguage: opts.acceptLanguage }),
      }));
    } catch {
      continue;
    }
    staleTotal += stale;
    if (entries.length > 0) break;
    // The sitemap matched job URLs, all older than `since`: it is healthy and
    // nothing changed. Probing the remaining candidates would spend a request
    // per guess to rediscover the same quiet day.
    if (stale > 0) break;
  }

  if (entries.length === 0) {
    if (staleTotal > 0) {
      ctx.onProgress?.(
        `${opts.id}: nothing changed since ${ctx.since?.toISOString() ?? "the last run"}`,
      );
    } else {
      warn(`no job URLs discovered from ${opts.origin} — sitemap missing or pattern too narrow`);
    }
    return;
  }

  ctx.onProgress?.(`${opts.id}: ${entries.length} job URLs discovered`);

  let yielded = 0;
  for (const entry of entries) {
    if (ctx.signal?.aborted) return;
    if (yielded >= ctx.limit) return;
    if (!isAllowed(rules, entry.url)) continue;

    try {
      // Detail pages are server-rendered for Google Jobs, so a plain GET is
      // enough — this is the request Playwright used to be needed for.
      const page = await fetchPage(entry.url, {
        signal: ctx.signal,
        acceptLanguage: opts.acceptLanguage,
        conditional: true,
      });

      const extracted = extractJob(page, { url: entry.url, country: opts.country });
      const title = extracted.title.trim();
      // No title means the page was not a posting — a category page caught by a
      // loose URL pattern, or a listing that has since been taken down.
      if (!title) continue;

      const job: ScrapedJob = {
        title,
        company: extracted.company.trim(),
        location: extracted.location.trim(),
        description: extracted.description,
        sourceUrl: entry.url,
        source: opts.source,
        salary: extracted.salary.trim() || undefined,
        workType: toWorkType(extracted.workType),
        postedAt: extracted.postedAt ?? entry.lastModified ?? undefined,
        country: extracted.country || opts.country,
      };

      yielded++;
      yield opts.refine ? opts.refine(job) : job;
    } catch (err) {
      // One unreachable posting is normal on a board of thousands.
      if (ctx.signal?.aborted) return;
      warn(`skipped ${entry.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Test seam: forget cached robots rules between runs. */
export function resetRobotsCache(): void {
  robotsCache.clear();
}
