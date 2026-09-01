/**
 * SEEK — the dominant Australian job board.
 *
 * The listing pages are a React SPA, so keyword search needs a browser, but —
 * like every board that wants Google Jobs traffic — the job detail pages are
 * server-rendered with JSON-LD and the site publishes sitemaps. Bulk
 * collection therefore goes through the sitemap walker, which also checks
 * robots.txt at runtime and yields nothing if SEEK disallows the paths.
 *
 * Job detail URLs look like `https://www.seek.com.au/job/12345678`.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard } from "./helpers";
import { ingestViaSitemap } from "./sitemap-board";
import type { BoardDefinition } from "../types";

const BASE = "https://www.seek.com.au";
const COUNTRY = "AU";

export const seekBoard: BoardDefinition = {
  id: "seek",
  name: "SEEK",
  source: "SEEK",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  // Only the keyword search needs a browser; bulk ingestion goes through the
  // sitemap, so the board still works with Playwright switched off.
  requiresBrowser: true,
  supportsLiveSearch: true,
  note: "Largest Australian job board",
  ingest: (ctx) =>
    ingestViaSitemap(
      {
        id: "seek",
        source: "SEEK",
        origin: BASE,
        country: COUNTRY,
        urlPattern: /seek\.com\.au\/job\/\d+/i,
        sitemapPattern: /(job|listing)/i,
        acceptLanguage: acceptLanguageFor(COUNTRY),
      },
      ctx,
    ),
  scrape: (q) => {
    const acceptLanguage = acceptLanguageFor(COUNTRY);

    return runHtmlBoard({
      id: "seek",
      source: "SEEK",
      country: COUNTRY,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Australia",
      buildUrl: (page) => {
        const params = new URLSearchParams({ keywords: q.query });
        if (q.city) params.set("where", q.city);
        if (q.remoteOnly) params.set("workarrangement", "2"); // SEEK's "remote" filter
        if (page > 1) params.set("page", String(page));
        return `${BASE}/jobs?${params.toString()}`;
      },
      fetchList: (url) =>
        pwFetch(url, {
          waitSelector: "[data-automation='normalJob'], a[href*='/job/']",
          signal: q.signal,
          acceptLanguage,
        }),
      fetchDetail: (url) => pwFetch(url, { signal: q.signal, acceptLanguage }),
      select: {
        urlPattern: /seek\.com\.au\/job\/\d+/i,
        cardSelector: "[data-automation='normalJob']",
      },
      concurrency: 6,
    });
  },
};
