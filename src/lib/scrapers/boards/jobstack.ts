/**
 * Jobstack — Czech IT-only board. Server-rendered listing pages.
 */
import { fetchPage } from "../fetcher";
import { acceptLanguageFor, runHtmlBoard, SENIORITY_SLUGS } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.jobstack.it";
const COUNTRY = "CZ";

export const jobstackBoard: BoardDefinition = {
  id: "jobstack",
  name: "Jobstack",
  source: "JOBSTACK",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: false,
  note: "Czech IT jobs",
  scrape: (q) => {
    const language = acceptLanguageFor(COUNTRY);
    const seniority = q.seniority ? SENIORITY_SLUGS[q.seniority] : "";

    return runHtmlBoard({
      id: "jobstack",
      source: "JOBSTACK",
      country: COUNTRY,
      maxPages: q.deepSearch ? 5 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Czech Republic",
      buildUrl: (page) => {
        const params = new URLSearchParams({ keywords: q.query, isDetail: "1" });
        if (seniority) params.set("seniority", seniority);
        if (page > 1) params.set("page", String(page));
        return `${BASE}/it-jobs?${params.toString()}`;
      },
      fetchList: (url) => fetchPage(url, { signal: q.signal, acceptLanguage: language }),
      fetchDetail: (url) => fetchPage(url, { signal: q.signal, acceptLanguage: language }),
      select: { urlPattern: /jobstack\.it\/it-job\//i },
      concurrency: 6,
    });
  },
};
