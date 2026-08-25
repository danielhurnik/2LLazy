/**
 * RemoteOK — free JSON feed of worldwide remote jobs, no key required.
 *
 * Two quirks drive this file: the endpoint returns the whole feed in one array
 * whose FIRST element is a legal notice rather than a job, and it 403s without
 * a browser-like User-Agent. There is no server-side search, so relevance is
 * filtered client-side.
 */
import { fetchJson } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  formatSalaryRange,
  htmlToText,
  isRecord,
  matchesQuery,
  resolveCountry,
  sortByLocationPreference,
  str,
  strList,
  toDate,
} from "./shared";

const ENDPOINT = "https://remoteok.com/api";
const BOARD_ID = "remoteok";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * True for the legal-notice object the feed puts at index 0. It carries a
 * `legal` key and none of the job fields, so we test for the job fields rather
 * than trusting its position.
 */
function isJobEntry(item: unknown): item is Record<string, unknown> {
  if (!isRecord(item)) return false;
  if ("legal" in item) return false;
  return Boolean(str(item.position) || str(item.title)) && Boolean(str(item.url) || str(item.id));
}

function absoluteUrl(item: Record<string, unknown>): string {
  const url = str(item.url);
  if (url.startsWith("http")) return url;
  if (url.startsWith("/")) return `https://remoteok.com${url}`;
  const id = str(item.id) || str(item.slug);
  return id ? `https://remoteok.com/remote-jobs/${id}` : "";
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);

  let payload: unknown;
  try {
    payload = await fetchJson<unknown>(ENDPOINT, {
      signal: q.signal,
      headers: { "User-Agent": BROWSER_UA },
    });
  } catch (err) {
    warn(`fetch failed for ${ENDPOINT}`, err);
    return [];
  }

  if (!Array.isArray(payload)) {
    warn(`unexpected payload shape from ${ENDPOINT}`);
    return [];
  }

  const jobs: ScrapedJob[] = [];
  for (const item of payload) {
    if (!isJobEntry(item)) continue;

    const title = str(item.position) || str(item.title);
    const sourceUrl = absoluteUrl(item);
    if (!title || !sourceUrl) continue;

    const tags = strList(item.tags);
    const description = htmlToText(item.description);
    if (!matchesQuery([title, str(item.company), tags.join(" "), description].join(" "), q)) {
      continue;
    }

    const location = str(item.location) || "Worldwide";
    jobs.push({
      title,
      company: str(item.company) || "Unknown",
      location,
      description,
      sourceUrl,
      source: "REMOTEOK",
      salary: formatSalaryRange(item.salary_min, item.salary_max, "USD", "year"),
      workType: "Remote",
      postedAt: toDate(item.date),
      country: resolveCountry(location),
    });
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const remoteOkBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "RemoteOK",
  source: "REMOTEOK",
  homepage: "https://remoteok.com",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free JSON API, no key required",
  scrape,
};
