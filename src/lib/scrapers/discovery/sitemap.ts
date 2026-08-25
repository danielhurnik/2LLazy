/**
 * Job-URL discovery through sitemaps — the replacement for rendering a
 * single-page app in a browser.
 *
 * The reason this works: a board's *listing* page may be client-rendered, but
 * its *job detail* pages are server-rendered with `schema.org/JobPosting`
 * markup, because every board wants Google Jobs to index them. So a browser was
 * only ever needed to answer one question — which job URLs exist — and a
 * sitemap answers that directly, in a format the board publishes on purpose.
 *
 * Sitemaps also carry `lastmod`, which makes incremental scraping possible: a
 * daily run can fetch only the postings that changed since the last one instead
 * of walking every listing page again. That is a far bigger saving than any
 * amount of parallelism, and it is the main reason this path does not get rate
 * limited.
 */
import * as cheerio from "cheerio";

export interface SitemapEntry {
  url: string;
  lastModified: Date | null;
}

export interface SitemapDocument {
  /** Child sitemaps, when this was a `<sitemapindex>`. */
  sitemaps: SitemapEntry[];
  /** Page URLs, when this was a `<urlset>`. */
  urls: SitemapEntry[];
}

function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Parses either a `<sitemapindex>` or a `<urlset>`. Never throws: a truncated
 * or malformed document yields whatever entries were readable.
 */
export function parseSitemap(xml: string): SitemapDocument {
  const result: SitemapDocument = { sitemaps: [], urls: [] };
  if (!xml || typeof xml !== "string") return result;

  try {
    const $ = cheerio.load(xml, { xmlMode: true });

    $("sitemapindex > sitemap").each((_, el) => {
      const loc = $(el).find("loc").first().text().trim();
      if (loc) result.sitemaps.push({ url: loc, lastModified: toDate($(el).find("lastmod").first().text()) });
    });

    $("urlset > url").each((_, el) => {
      const loc = $(el).find("loc").first().text().trim();
      if (loc) result.urls.push({ url: loc, lastModified: toDate($(el).find("lastmod").first().text()) });
    });

    // Some boards omit the wrapper element or use a default namespace that
    // trips the child selector; fall back to a flat scan.
    if (result.sitemaps.length === 0 && result.urls.length === 0) {
      $("url").each((_, el) => {
        const loc = $(el).find("loc").first().text().trim();
        if (loc) result.urls.push({ url: loc, lastModified: toDate($(el).find("lastmod").first().text()) });
      });
      $("sitemap").each((_, el) => {
        const loc = $(el).find("loc").first().text().trim();
        if (loc) result.sitemaps.push({ url: loc, lastModified: toDate($(el).find("lastmod").first().text()) });
      });
    }
  } catch {
    // A sitemap we cannot parse simply contributes nothing.
  }

  return result;
}

export interface DiscoverOptions {
  /** Only return URLs matching this — the board's job-detail URL shape. */
  urlPattern: RegExp;
  /** Ignore entries whose `lastmod` is older than this. */
  since?: Date | null;
  /** Cap on returned job URLs. */
  limit?: number;
  /** How many child sitemaps to open from an index. */
  maxSitemaps?: number;
  /**
   * Only follow child sitemaps whose own URL matches. Boards publish sitemaps
   * for companies, articles and categories too; opening those wastes requests.
   */
  sitemapPattern?: RegExp;
  fetchXml: (url: string) => Promise<string>;
  signal?: AbortSignal;
}

const DEFAULT_LIMIT = 300;
const DEFAULT_MAX_SITEMAPS = 12;

/**
 * Walks a sitemap (or sitemap index, one level deep) and returns the job URLs.
 *
 * Newest first: when a run is capped by `limit`, the postings most worth having
 * are the ones that changed most recently.
 */
export async function discoverFromSitemap(
  rootUrl: string,
  opts: DiscoverOptions,
): Promise<SitemapEntry[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxSitemaps = opts.maxSitemaps ?? DEFAULT_MAX_SITEMAPS;
  const seen = new Set<string>();
  const found: SitemapEntry[] = [];

  const keep = (entry: SitemapEntry): void => {
    if (seen.has(entry.url) || !opts.urlPattern.test(entry.url)) return;
    if (opts.since && entry.lastModified && entry.lastModified < opts.since) return;
    seen.add(entry.url);
    found.push(entry);
  };

  let root: SitemapDocument;
  try {
    root = parseSitemap(await opts.fetchXml(rootUrl));
  } catch {
    return [];
  }

  for (const entry of root.urls) keep(entry);

  // Open child sitemaps newest-first, and only those that could hold jobs.
  const children = root.sitemaps
    .filter((child) => !opts.sitemapPattern || opts.sitemapPattern.test(child.url))
    .filter((child) => !opts.since || !child.lastModified || child.lastModified >= opts.since)
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .slice(0, maxSitemaps);

  for (const child of children) {
    if (opts.signal?.aborted) break;
    if (found.length >= limit) break;
    try {
      const document = parseSitemap(await opts.fetchXml(child.url));
      for (const entry of document.urls) keep(entry);
    } catch {
      // One unreachable child sitemap must not lose the others.
      continue;
    }
  }

  found.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
  return found.slice(0, limit);
}

/** Conventional sitemap locations, tried when robots.txt advertises none. */
export function fallbackSitemapUrls(origin: string): string[] {
  const base = origin.replace(/\/+$/, "");
  return [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/sitemap-index.xml`,
    `${base}/sitemaps/sitemap.xml`,
  ];
}
