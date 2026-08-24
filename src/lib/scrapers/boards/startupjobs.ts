/**
 * StartupJobs — Czech and Slovak startup board.
 *
 * A single-page app: the listing markup only exists after JavaScript runs, so
 * this board needs Playwright. Its JSON API is aggressively rate-limited, which
 * is why the rendered page is scraped instead.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard, SENIORITY_SLUGS } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.startupjobs.cz";

export const startupJobsBoard: BoardDefinition = {
  id: "startupjobs",
  name: "StartupJobs",
  source: "STARTUPJOBS",
  homepage: BASE,
  countries: ["CZ", "SK"],
  remoteOnly: false,
  requiresBrowser: true,
  note: "Czech and Slovak startups",
  scrape: (q) => {
    const country = q.country === "SK" ? "SK" : "CZ";
    const acceptLanguage = acceptLanguageFor(country);
    const seniority = q.seniority ? SENIORITY_SLUGS[q.seniority] : "";

    return runHtmlBoard({
      id: "startupjobs",
      source: "STARTUPJOBS",
      country,
      maxPages: q.deepSearch ? 4 : 2,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Czech Republic",
      buildUrl: (page) => {
        const params = new URLSearchParams({ search: q.query });
        if (seniority) params.set("seniority", seniority);
        if (q.remoteOnly) params.set("remote", "1");
        if (page > 1) params.set("page", String(page));
        return `${BASE}/nabidky?${params.toString()}`;
      },
      fetchList: (url) =>
        pwFetch(url, {
          waitSelector: "[class*='offer'], [class*='job-card'], a[href*='/nabidka/']",
          signal: q.signal,
          acceptLanguage,
        }),
      fetchDetail: (url) => pwFetch(url, { signal: q.signal, acceptLanguage }),
      select: {
        urlPattern: /startupjobs\.cz\/nabidka\//i,
        cardSelector: "[class*='offer'], [class*='job-card']",
      },
      concurrency: 5,
    });
  },
};
