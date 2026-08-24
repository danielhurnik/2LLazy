/**
 * Skilleto — Czech board organised by skill rather than by keyword search:
 * every technology has its own `/skill/<slug>` page.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard } from "./helpers";
import type { BoardDefinition } from "../types";

const BASE = "https://www.skilleto.cz";
const COUNTRY = "CZ";

/** Skilleto's URLs are skill slugs, so the intent keyword beats the raw query. */
function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const skilletoBoard: BoardDefinition = {
  id: "skilleto",
  name: "Skilleto",
  source: "SKILLETO",
  homepage: BASE,
  countries: [COUNTRY],
  remoteOnly: false,
  requiresBrowser: true,
  note: "Czech board indexed by technology",
  scrape: (q) => {
    const acceptLanguage = acceptLanguageFor(COUNTRY);
    const slug = toSlug(q.intent.scrapingKeyword || q.query);

    return runHtmlBoard({
      id: "skilleto",
      source: "SKILLETO",
      country: COUNTRY,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "Czech Republic",
      buildUrl: (page) =>
        page > 1 ? `${BASE}/skill/${slug}?page=${page}` : `${BASE}/skill/${slug}`,
      fetchList: (url) =>
        pwFetch(url, {
          waitSelector: "[class*='job'], [class*='offer'], [class*='position'], a[href*='/pozice/']",
          signal: q.signal,
          acceptLanguage,
        }),
      fetchDetail: (url) => pwFetch(url, { signal: q.signal, acceptLanguage }),
      select: { urlPattern: /skilleto\.cz\/pozice\//i },
      concurrency: 5,
    });
  },
};
