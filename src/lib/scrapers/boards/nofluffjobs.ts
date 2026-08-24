/**
 * NoFluffJobs — Central-European IT board with per-country sections.
 *
 * Two things matter here. First, the country path (`/pl/`, `/cz/`, `/de/`…)
 * decides which market's postings are returned, so it is driven by the search
 * country rather than hard-coded. Second, when a query maps to one of the
 * board's own technology categories the `/jobs/<slug>` URL returns far more
 * results than a keyword search, so that path is preferred.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard } from "./helpers";
import type { BoardDefinition, CountryCode } from "../types";

const BASE = "https://nofluffjobs.com";

/** ISO country → the board's own section path. */
const COUNTRY_PATHS: Record<string, string> = {
  PL: "pl", CZ: "cz", SK: "sk", DE: "de", AT: "at", GB: "uk",
  NL: "nl", HU: "hu", RO: "ro", UA: "ua",
};

/**
 * Query keyword → NoFluffJobs technology category slug. A category URL returns
 * a dramatically larger result set than the generic keyword search.
 */
export const NFJ_CATEGORY_SLUGS: Record<string, string> = {
  react: "react", "react.js": "react", reactjs: "react", "next.js": "react", nextjs: "react",
  vue: "vue", "vue.js": "vue", angular: "angular", svelte: "javascript",
  frontend: "frontend-developer", javascript: "javascript", typescript: "typescript",
  backend: "backend-developer", node: "node.js", "node.js": "node.js", nodejs: "node.js",
  python: "python", java: "java", go: "go", golang: "go", php: "php", ruby: "ruby",
  scala: "scala", rust: "rust", "c#": "c-sharp", csharp: "c-sharp",
  ".net": ".net-developer", dotnet: ".net-developer",
  fullstack: "fullstack-developer", devops: "devops-engineer", cloud: "devops-engineer",
  kubernetes: "devops-engineer", mobile: "mobile-developer", ios: "ios-developer",
  android: "android-developer", flutter: "flutter", "react native": "react-native",
  qa: "qa-engineer", testing: "qa-engineer", security: "security",
  "data-engineer": "data-engineer", data: "data-engineer",
  "machine learning": "machine-learning", ml: "machine-learning", kotlin: "kotlin", swift: "swift",
};

function resolveSlug(keyword: string): string | null {
  const key = keyword.toLowerCase().trim();
  return NFJ_CATEGORY_SLUGS[key] ?? NFJ_CATEGORY_SLUGS[key.replace(/[.\s-]+/g, "")] ?? null;
}

function countryPath(country: CountryCode): string {
  return COUNTRY_PATHS[country.toUpperCase()] ?? "pl";
}

export const noFluffJobsBoard: BoardDefinition = {
  id: "nofluffjobs",
  name: "NoFluffJobs",
  source: "NOFLUFFJOBS",
  homepage: BASE,
  countries: Object.keys(COUNTRY_PATHS),
  remoteOnly: false,
  requiresBrowser: true,
  note: "Central-European IT board, salary always disclosed",
  scrape: (q) => {
    const path = countryPath(q.country);
    const acceptLanguage = acceptLanguageFor(q.country);
    const slug = resolveSlug(q.intent.scrapingKeyword || q.query);

    return runHtmlBoard({
      id: "nofluffjobs",
      source: "NOFLUFFJOBS",
      country: q.country,
      maxPages: q.deepSearch ? 8 : 2,
      deepSearch: q.deepSearch,
      signal: q.signal,
      delayMs: 800,
      defaultLocation: q.city || "",
      buildUrl: (page) => {
        // NoFluffJobs takes one `criteria` parameter holding a comma-separated
        // list, not repeated parameters: `?criteria=city%3Dpraha,remote`.
        const criteria: string[] = [];
        if (q.city) criteria.push(`city=${q.city.toLowerCase()}`);
        if (q.remoteOnly) criteria.push("remote");

        const params = new URLSearchParams();
        if (criteria.length > 0) params.set("criteria", criteria.join(","));
        if (page > 1) params.set("page", String(page));

        const suffix = params.toString() ? `?${params.toString()}` : "";
        return slug
          ? `${BASE}/${path}/jobs/${slug}${suffix}`
          : `${BASE}/${path}/${encodeURIComponent(q.query)}${suffix}`;
      },
      fetchList: (url) =>
        pwFetch(url, { waitSelector: "a[href*='/job/']", signal: q.signal, acceptLanguage }),
      fetchDetail: (url) =>
        pwFetch(url, {
          waitSelector: "[class*='description'], [class*='job-desc'], main",
          signal: q.signal,
          acceptLanguage,
        }),
      select: { urlPattern: /nofluffjobs\.com\/[a-z]{2}\/job\//i },
      concurrency: 6,
    });
  },
};
