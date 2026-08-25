/**
 * Adzuna — aggregated local job listings for 19 countries.
 *
 * The only board here that needs credentials. They are declared in
 * `requiredEnv` so the registry skips the board entirely when the free-tier
 * keys are not configured, rather than letting it fail at request time.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, CountryCode, ScrapeQuery, ScrapedJob } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  delay,
  formatSalaryRange,
  htmlToText,
  isRecord,
  looseList,
  looseNumeric,
  looseString,
  MAX_JOBS_PER_BOARD,
  pageBudget,
  PAGE_DELAY_MS,
  str,
  strList,
  toDate,
  workTypeFromText,
} from "./shared";

const BOARD_ID = "adzuna";
const API_BASE = "https://api.adzuna.com/v1/api/jobs";
const RESULTS_PER_PAGE = 50;

/** Adzuna's country endpoints, lowercase as the path segment requires. */
const ADZUNA_COUNTRIES = [
  "gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es", "fr", "in", "it", "mx",
  "nl", "nz", "pl", "sg", "za",
];

/** Salary figures come without a currency, so it is inferred per endpoint. */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  gb: "GBP", us: "USD", at: "EUR", au: "AUD", be: "EUR", br: "BRL", ca: "CAD",
  ch: "CHF", de: "EUR", es: "EUR", fr: "EUR", in: "INR", it: "EUR", mx: "MXN",
  nl: "EUR", nz: "NZD", pl: "PLN", sg: "SGD", za: "ZAR",
};

const resultSchema = z.object({
  title: z.string().min(1),
  company: z.object({ display_name: looseString }).nullish(),
  location: z.object({ display_name: looseString, area: looseList }).nullish(),
  description: looseString,
  redirect_url: z.string().min(1),
  created: looseString,
  salary_min: looseNumeric,
  salary_max: looseNumeric,
  contract_time: looseString,
});

/** Adzuna paths are 1-indexed; page 1 is `/search/1`. */
export function buildAdzunaUrl(
  q: ScrapeQuery,
  page: number,
  appId: string,
  appKey: string,
): string {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    what: q.intent?.scrapingKeyword || q.query,
    results_per_page: String(RESULTS_PER_PAGE),
  });
  if (q.city) params.set("where", q.city);
  const country = q.country.toLowerCase();
  return `${API_BASE}/${country}/search/${page}?${params.toString()}`;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);

  const appId = process.env.ADZUNA_APP_ID ?? "";
  const appKey = process.env.ADZUNA_APP_KEY ?? "";
  if (!appId || !appKey) {
    warn("skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY are not set");
    return [];
  }

  const country = (q.country || "").toLowerCase();
  if (!ADZUNA_COUNTRIES.includes(country)) {
    warn(`skipped: country ${q.country || "?"} has no Adzuna endpoint`);
    return [];
  }

  const currency = CURRENCY_BY_COUNTRY[country] ?? "";
  const maxPages = pageBudget(q.deepSearch, 2, 4);
  const jobs: ScrapedJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    if (q.signal?.aborted) break;
    const url = buildAdzunaUrl(q, page, appId, appKey);

    let payload: unknown;
    try {
      payload = await fetchJson<unknown>(url, { signal: q.signal });
    } catch (err) {
      // Keys are in the URL — never let them reach the log.
      warn(`fetch failed for ${API_BASE}/${country}/search/${page}`, err);
      break;
    }

    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      warn(`unexpected payload shape from ${API_BASE}/${country}/search/${page}`);
      break;
    }
    const batch = payload.results;
    if (batch.length === 0) break;

    for (const item of batch) {
      const parsed = resultSchema.safeParse(item);
      if (!parsed.success) continue;
      const raw = parsed.data;

      const areas = strList(raw.location?.area);
      const location = str(raw.location?.display_name) || areas.slice(-2).join(", ");
      const description = htmlToText(raw.description);
      const workType = workTypeFromText(str(raw.title), location, description);
      if (q.remoteOnly && workType !== "Remote") continue;

      jobs.push({
        title: str(raw.title),
        company: str(raw.company?.display_name) || "Unknown",
        location: location || q.country.toUpperCase(),
        description,
        sourceUrl: str(raw.redirect_url),
        source: "ADZUNA",
        salary: formatSalaryRange(raw.salary_min, raw.salary_max, currency, "year"),
        workType,
        postedAt: toDate(raw.created),
        country: q.country.toUpperCase(),
      });
    }

    if (batch.length < RESULTS_PER_PAGE) break;
    if (jobs.length >= MAX_JOBS_PER_BOARD) break;
    if (page < maxPages) await delay(PAGE_DELAY_MS, q.signal);
  }

  return capJobs(dedupeByUrl(jobs));
}

export const adzunaBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Adzuna",
  source: "ADZUNA",
  homepage: "https://www.adzuna.com",
  countries: ADZUNA_COUNTRIES.map((c) => c.toUpperCase()) as CountryCode[],
  remoteOnly: false,
  requiresBrowser: false,
  requiredEnv: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  note: "free API tier — needs ADZUNA_APP_ID and ADZUNA_APP_KEY",
  scrape,
};
