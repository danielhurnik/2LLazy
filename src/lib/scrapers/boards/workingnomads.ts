/**
 * Working Nomads — free JSON API of curated remote jobs, no key required.
 *
 * The `exposed_jobs` endpoint returns the newest postings in one flat array
 * with no search or pagination parameters, so a single request is the whole
 * crawl and relevance is filtered client-side.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  htmlToText,
  looseString,
  matchesQuery,
  resolveCountry,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const BOARD_ID = "workingnomads";
export const WORKING_NOMADS_ENDPOINT = "https://www.workingnomads.com/api/exposed_jobs/";

const jobSchema = z.object({
  title: z.string().min(1),
  url: z.string().min(1),
  company_name: looseString,
  category_name: looseString,
  description: looseString,
  /** Comma-separated keywords, e.g. "python,django,api". */
  tags: looseString,
  location: looseString,
  pub_date: z.union([z.number(), z.string()]).nullish(),
});

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);

  let payload: unknown;
  try {
    payload = await fetchJson<unknown>(WORKING_NOMADS_ENDPOINT, { signal: q.signal });
  } catch (err) {
    warn(`fetch failed for ${WORKING_NOMADS_ENDPOINT}`, err);
    return [];
  }

  if (!Array.isArray(payload)) {
    warn(`unexpected payload shape from ${WORKING_NOMADS_ENDPOINT}`);
    return [];
  }

  const jobs: ScrapedJob[] = [];
  for (const item of payload) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const raw = parsed.data;

    const description = htmlToText(raw.description);
    const tags = str(raw.tags).split(",").map((t) => t.trim()).filter(Boolean);
    const haystack = [raw.title, str(raw.company_name), str(raw.category_name), tags.join(" "), description].join(" ");
    if (!matchesQuery(haystack, q)) continue;

    const location = str(raw.location) || "Anywhere";
    jobs.push({
      title: raw.title.trim(),
      company: str(raw.company_name) || "Unknown",
      location,
      description,
      sourceUrl: raw.url.trim(),
      source: "WORKINGNOMADS",
      workType: "Remote",
      postedAt: toDate(raw.pub_date),
      country: resolveCountry(location),
    });
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const workingNomadsBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Working Nomads",
  source: "WORKINGNOMADS",
  homepage: "https://www.workingnomads.com",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free JSON API, no key required",
  scrape,
};
