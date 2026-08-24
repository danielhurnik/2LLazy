/**
 * Himalayas — free JSON API of worldwide remote jobs, no key required.
 *
 * Offset-paginated and without a search parameter, so we walk a few pages of
 * the newest postings and filter for relevance client-side.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
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
  matchesQuery,
  MAX_JOBS_PER_BOARD,
  pageBudget,
  PAGE_DELAY_MS,
  resolveCountry,
  sortByLocationPreference,
  str,
  strList,
  toDate,
} from "./shared";

const ENDPOINT = "https://himalayas.app/jobs/api";
const BOARD_ID = "himalayas";
const PAGE_SIZE = 50;

const jobSchema = z.object({
  title: z.string().min(1),
  companyName: looseString,
  locationRestrictions: looseList,
  description: looseString,
  applicationLink: looseString,
  guid: looseString,
  pubDate: z.union([z.number(), z.string()]).nullish(),
  minSalary: looseNumeric,
  maxSalary: looseNumeric,
  salaryCurrency: looseString,
  seniority: looseList,
  categories: looseList,
});

export function buildHimalayasUrl(offset: number): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  return `${ENDPOINT}?${params.toString()}`;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const maxPages = pageBudget(q.deepSearch, 2, 4);
  const jobs: ScrapedJob[] = [];

  for (let page = 0; page < maxPages; page++) {
    if (q.signal?.aborted) break;
    const url = buildHimalayasUrl(page * PAGE_SIZE);

    let payload: unknown;
    try {
      payload = await fetchJson<unknown>(url, { signal: q.signal });
    } catch (err) {
      warn(`fetch failed for ${url}`, err);
      break;
    }

    if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
      warn(`unexpected payload shape from ${url}`);
      break;
    }
    const batch = payload.jobs;
    if (batch.length === 0) break;

    for (const item of batch) {
      const parsed = jobSchema.safeParse(item);
      if (!parsed.success) continue;
      const raw = parsed.data;

      const sourceUrl = str(raw.applicationLink) || str(raw.guid);
      if (!sourceUrl) continue;

      const categories = [...strList(raw.categories), ...strList(raw.seniority)];
      const description = htmlToText(raw.description);
      const haystack = [str(raw.title), str(raw.companyName), categories.join(" "), description].join(" ");
      if (!matchesQuery(haystack, q)) continue;

      const restrictions = strList(raw.locationRestrictions);
      const location = restrictions.length > 0 ? restrictions.join(", ") : "Worldwide";
      jobs.push({
        title: str(raw.title),
        company: str(raw.companyName) || "Unknown",
        location,
        description,
        sourceUrl,
        source: "HIMALAYAS",
        salary: formatSalaryRange(
          raw.minSalary,
          raw.maxSalary,
          str(raw.salaryCurrency) || "USD",
          "year",
        ),
        workType: "Remote",
        postedAt: toDate(raw.pubDate),
        // Only a single restriction identifies a country; a list is a region.
        country: restrictions.length === 1 ? resolveCountry(restrictions[0]) : undefined,
      });
    }

    // A short page is the last page.
    if (batch.length < PAGE_SIZE) break;
    if (jobs.length >= MAX_JOBS_PER_BOARD) break;
    if (page < maxPages - 1) await delay(PAGE_DELAY_MS, q.signal);
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const himalayasBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Himalayas",
  source: "HIMALAYAS",
  homepage: "https://himalayas.app",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free JSON API, no key required",
  scrape,
};
