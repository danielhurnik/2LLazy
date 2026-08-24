/**
 * Cocuma — Czech board for product and tech roles at smaller companies.
 * Server-rendered, so a plain fetch is enough.
 */
import { fetchPage } from "../fetcher";
import { acceptLanguageFor, runHtmlBoard, SENIORITY_SLUGS } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.cocuma.cz";
const COUNTRY = "CZ";

export const cocumaBoard: BoardDefinition = {
  id: "cocuma",
  name: "Cocuma",
  source: "COCUMA",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: false,
  note: "Czech product and tech roles",
  scrape: (q) => {
    const language = acceptLanguageFor(COUNTRY);
    const seniority = q.seniority ? SENIORITY_SLUGS[q.seniority] : "";

    return runHtmlBoard({
      id: "cocuma",
      source: "COCUMA",
      country: COUNTRY,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Czech Republic",
      buildUrl: (page) => {
        const params = new URLSearchParams({ q: q.query });
        if (seniority) params.set("seniority", seniority);
        if (page > 1) params.set("page", String(page));
        return `${BASE}/jobs/?${params.toString()}`;
      },
      fetchList: (url) => fetchPage(url, { signal: q.signal, acceptLanguage: language }),
      fetchDetail: (url) => fetchPage(url, { signal: q.signal, acceptLanguage: language }),
      select: { urlPattern: /cocuma\.cz\/(job|nabidka)[/-]/i, cardSelector: "[class*='job-item'], [class*='JobCard'], article" },
      concurrency: 6,
    });
  },
};
