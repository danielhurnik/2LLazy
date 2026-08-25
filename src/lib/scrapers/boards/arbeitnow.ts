/**
 * Arbeitnow — free JSON job board API for Europe (mostly DE/AT/CH/NL/PL), no
 * key required.
 *
 * The API has no search parameter: it returns the newest postings page by page,
 * so we pull a few pages and filter for relevance client-side.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  delay,
  htmlToText,
  isRecord,
  looseList,
  looseString,
  matchesQuery,
  MAX_JOBS_PER_BOARD,
  pageBudget,
  PAGE_DELAY_MS,
  resolveCountry,
  sortByLocationPreference,
  str,
  strList,
  toDate,
  workTypeFromText,
} from "./shared";

const ENDPOINT = "https://www.arbeitnow.com/api/job-board-api";
const BOARD_ID = "arbeitnow";

/** Arbeitnow indexes European employers; the registry runs it for these users. */
const ARBEITNOW_COUNTRIES = [
  "DE", "AT", "CH", "NL", "PL", "BE", "FR", "LU", "CZ", "SK", "DK", "SE", "NO", "FI",
  "ES", "IT", "PT", "IE", "GB", "HU", "RO", "BG", "HR", "SI", "EE", "LV", "LT", "GR", "UA",
];

const jobSchema = z.object({
  title: z.string().min(1),
  slug: looseString,
  company_name: looseString,
  description: looseString,
  remote: z.boolean().nullish(),
  url: looseString,
  tags: looseList,
  job_types: looseList,
  location: looseString,
  created_at: z.union([z.number(), z.string()]).nullish(),
});

/** Page 1 has no `page` parameter, matching what the API itself links to. */
export function buildArbeitnowUrl(page: number): string {
  return page > 1 ? `${ENDPOINT}?page=${page}` : ENDPOINT;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const maxPages = pageBudget(q.deepSearch, 2, 5);
  const jobs: ScrapedJob[] = [];

  for (let page = 1; page <= maxPages; page++) {
    if (q.signal?.aborted) break;
    const url = buildArbeitnowUrl(page);

    let payload: unknown;
    try {
      payload = await fetchJson<unknown>(url, { signal: q.signal });
    } catch (err) {
      warn(`fetch failed for ${url}`, err);
      break;
    }

    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      warn(`unexpected payload shape from ${url}`);
      break;
    }
    if (payload.data.length === 0) break;

    for (const item of payload.data) {
      const parsed = jobSchema.safeParse(item);
      if (!parsed.success) continue;
      const raw = parsed.data;

      const slug = str(raw.slug);
      const sourceUrl = str(raw.url) || (slug ? `https://www.arbeitnow.com/jobs/companies/${slug}` : "");
      if (!sourceUrl) continue;

      const isRemote = raw.remote === true;
      if (q.remoteOnly && !isRemote) continue;

      const tags = [...strList(raw.tags), ...strList(raw.job_types)];
      const description = htmlToText(raw.description);
      const haystack = [str(raw.title), str(raw.company_name), tags.join(" "), description].join(" ");
      if (!matchesQuery(haystack, q)) continue;

      const location = str(raw.location) || (isRemote ? "Remote" : "");
      jobs.push({
        title: str(raw.title),
        company: str(raw.company_name) || "Unknown",
        location: location || "Europe",
        description,
        sourceUrl,
        source: "ARBEITNOW",
        workType: isRemote ? "Remote" : workTypeFromText(location, tags.join(" ")),
        postedAt: toDate(raw.created_at),
        country: resolveCountry(location),
      });
    }

    if (jobs.length >= MAX_JOBS_PER_BOARD) break;
    if (page < maxPages) await delay(PAGE_DELAY_MS, q.signal);
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const arbeitnowBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Arbeitnow",
  source: "ARBEITNOW",
  homepage: "https://www.arbeitnow.com",
  countries: ARBEITNOW_COUNTRIES,
  remoteOnly: false,
  requiresBrowser: false,
  note: "free JSON API, no key required — European roles, many visa-sponsored",
  scrape,
};
