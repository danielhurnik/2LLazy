/**
 * Remotive — free JSON API of worldwide remote jobs, no key required.
 *
 * One request per search: the API takes a `search` term and a `limit`, so
 * pagination is a bigger limit rather than a page loop.
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
  isRecord,
  looseString,
  resolveCountry,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const ENDPOINT = "https://remotive.com/api/remote-jobs";
const BOARD_ID = "remotive";

const jobSchema = z.object({
  title: z.string().min(1),
  company_name: looseString,
  candidate_required_location: looseString,
  job_type: looseString,
  salary: looseString,
  description: looseString,
  url: z.string().min(1),
  publication_date: looseString,
  category: looseString,
});

/** Builds the single search URL; `limit` is how "deep" a deep search goes. */
export function buildRemotiveUrl(q: ScrapeQuery): string {
  const params = new URLSearchParams({
    search: q.intent?.scrapingKeyword || q.query,
    limit: String(q.deepSearch ? 120 : 50),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const url = buildRemotiveUrl(q);

  let payload: unknown;
  try {
    payload = await fetchJson<unknown>(url, { signal: q.signal });
  } catch (err) {
    warn(`fetch failed for ${url}`, err);
    return [];
  }

  if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
    warn(`unexpected payload shape from ${url}`);
    return [];
  }

  const jobs: ScrapedJob[] = [];
  for (const item of payload.jobs) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const raw = parsed.data;

    const location = str(raw.candidate_required_location) || "Worldwide";
    jobs.push({
      title: str(raw.title),
      company: str(raw.company_name) || "Unknown",
      location,
      description: htmlToText(raw.description),
      sourceUrl: str(raw.url),
      source: "REMOTIVE",
      salary: str(raw.salary) || undefined,
      workType: "Remote",
      postedAt: toDate(raw.publication_date),
      country: resolveCountry(location),
    });
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const remotiveBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Remotive",
  source: "REMOTIVE",
  homepage: "https://remotive.com",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free JSON API, no key required",
  scrape,
};
