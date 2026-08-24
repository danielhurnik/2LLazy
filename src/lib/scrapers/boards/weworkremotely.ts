/**
 * We Work Remotely — free per-category RSS feeds, no key required.
 *
 * WWR publishes one feed per category rather than a search endpoint, so the
 * query's intent picks which feeds to read (a deep search reads them all) and
 * relevance is filtered client-side.
 *
 * Item titles arrive as `"Company: Role"`, which is the only place the company
 * name appears — hence the split below.
 */
import * as cheerio from "cheerio";
import { fetchText } from "../fetcher";
import type { BoardDefinition, JobCategory, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  delay,
  htmlToText,
  matchesQuery,
  MAX_JOBS_PER_BOARD,
  PAGE_DELAY_MS,
  resolveCountry,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const BOARD_ID = "weworkremotely";
const FEED_BASE = "https://weworkremotely.com/categories";

const FEEDS = [
  "remote-programming-jobs",
  "remote-devops-sysadmin-jobs",
  "remote-design-jobs",
  "remote-product-jobs",
  "remote-customer-support-jobs",
] as const;
type WwrFeed = (typeof FEEDS)[number];

/** The feed most likely to carry a category's roles; programming is the default. */
const FEED_BY_CATEGORY: Partial<Record<JobCategory, WwrFeed>> = {
  DevOps: "remote-devops-sysadmin-jobs",
  Security: "remote-devops-sysadmin-jobs",
  Design: "remote-design-jobs",
  Product: "remote-product-jobs",
};

export function feedUrl(feed: WwrFeed): string {
  return `${FEED_BASE}/${feed}.rss`;
}

/** Normal searches read the two most relevant feeds; deep searches read all. */
export function feedsForQuery(q: ScrapeQuery): WwrFeed[] {
  if (q.deepSearch) return [...FEEDS];
  const primary = FEED_BY_CATEGORY[q.intent?.category as JobCategory] ?? "remote-programming-jobs";
  const secondary: WwrFeed =
    primary === "remote-programming-jobs" ? "remote-devops-sysadmin-jobs" : "remote-programming-jobs";
  return [primary, secondary];
}

/**
 * Splits WWR's `"Company: Role"` title. Everything before the first colon is
 * the company; a title without a colon is kept whole with no company.
 */
export function splitTitle(rawTitle: string): { company: string; title: string } {
  const separator = rawTitle.indexOf(":");
  if (separator <= 0) return { company: "", title: rawTitle.trim() };
  return {
    company: rawTitle.slice(0, separator).trim(),
    title: rawTitle.slice(separator + 1).trim(),
  };
}

function parseFeed(xml: string, q: ScrapeQuery): ScrapedJob[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs: ScrapedJob[] = [];

  $("item").each((_, el) => {
    const item = $(el);
    const rawTitle = str(item.find("title").first().text());
    const sourceUrl = str(item.find("link").first().text());
    if (!rawTitle || !sourceUrl) return;

    const { company, title } = splitTitle(rawTitle);
    const description = htmlToText(item.find("description").first().text());
    const region = str(item.find("region").first().text());
    const category = str(item.find("category").first().text());

    if (!matchesQuery([title, company, category, description].join(" "), q)) return;

    const location = region || "Remote";
    jobs.push({
      title,
      company: company || "Unknown",
      location,
      description,
      sourceUrl,
      source: "WEWORKREMOTELY",
      workType: "Remote",
      postedAt: toDate(item.find("pubDate").first().text()),
      country: resolveCountry(region),
    });
  });

  return jobs;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const feeds = feedsForQuery(q);
  const jobs: ScrapedJob[] = [];

  for (const [index, feed] of feeds.entries()) {
    if (q.signal?.aborted) break;
    const url = feedUrl(feed);

    let xml: string;
    try {
      xml = await fetchText(url, { signal: q.signal });
    } catch (err) {
      warn(`fetch failed for ${url}`, err);
      break;
    }

    if (!xml || !xml.includes("<item")) {
      warn(`unexpected feed body from ${url}`);
      break;
    }

    try {
      jobs.push(...parseFeed(xml, q));
    } catch (err) {
      warn(`failed to parse ${url}`, err);
      break;
    }

    if (jobs.length >= MAX_JOBS_PER_BOARD) break;
    if (index < feeds.length - 1) await delay(PAGE_DELAY_MS, q.signal);
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const weWorkRemotelyBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "We Work Remotely",
  source: "WEWORKREMOTELY",
  homepage: "https://weworkremotely.com",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free RSS feeds, no key required",
  scrape,
};
