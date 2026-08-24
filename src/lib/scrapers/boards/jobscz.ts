/**
 * Jobs.cz — the largest Czech job board. A React SPA, so it needs a browser.
 * Job detail pages live under `/rpd/<id>/`.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.jobs.cz";
const COUNTRY = "CZ";

export const jobsCzBoard: BoardDefinition = {
  id: "jobscz",
  name: "Jobs.cz",
  source: "JOBSCZ",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: true,
  note: "Largest Czech job board",
  scrape: (q) => {
    const acceptLanguage = acceptLanguageFor(COUNTRY);

    return runHtmlBoard({
      id: "jobscz",
      source: "JOBSCZ",
      country: COUNTRY,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Czech Republic",
      buildUrl: (page) => {
        // Jobs.cz takes repeated `q[]` params rather than a single `q`.
        const params = new URLSearchParams();
        params.append("q[]", q.query);
        if (q.city) params.set("locality[label]", q.city);
        // Jobs.cz has no stable public parameter for remote-only, so the filter
        // is left to the ranker rather than guessing at a query string that
        // might silently return nothing.
        if (page > 1) params.set("page", String(page));
        return `${BASE}/prace/?${params.toString()}`;
      },
      fetchList: (url) =>
        pwFetch(url, {
          waitSelector: "[data-jobad-id], [class*='SearchResultCard'], a[href*='/rpd/']",
          signal: q.signal,
          acceptLanguage,
        }),
      fetchDetail: (url) => pwFetch(url, { signal: q.signal, acceptLanguage }),
      select: {
        urlPattern: /jobs\.cz\/(rpd|fp)\//i,
        cardSelector: "[data-jobad-id], [class*='SearchResultCard']",
      },
      concurrency: 6,
    });
  },
};
