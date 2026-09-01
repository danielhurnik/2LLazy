/**
 * CareerOne — Australian generalist job board.
 *
 * Ingest-only: the search pages are JavaScript-rendered and CareerOne matters
 * less than SEEK, so it is collected in bulk through its sitemap (detail pages
 * carry JSON-LD for Google Jobs) and reaches users through the database rather
 * than the live search. The walker checks robots.txt at runtime.
 */
import { acceptLanguageFor } from "./helpers";
import { ingestViaSitemap } from "./sitemap-board";
import type { BoardDefinition } from "../types";

const BASE = "https://www.careerone.com.au";
const COUNTRY = "AU";

export const careerOneBoard: BoardDefinition = {
  id: "careerone",
  name: "CareerOne",
  source: "CAREERONE",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: true,
  supportsLiveSearch: false,
  note: "Australian generalist board, collected via sitemap",
  ingest: (ctx) =>
    ingestViaSitemap(
      {
        id: "careerone",
        source: "CAREERONE",
        origin: BASE,
        country: COUNTRY,
        urlPattern: /careerone\.com\.au\/(jobs?|job-view|jobvacancy)\/[^?#]+/i,
        sitemapPattern: /(job|vacan|listing)/i,
        acceptLanguage: acceptLanguageFor(COUNTRY),
      },
      ctx,
    ),
  scrape: async () => [],
};
