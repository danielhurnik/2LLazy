/**
 * Jobspresso — curated remote jobs on WP Job Manager, read as RSS.
 *
 * The site runs WordPress with the WP Job Manager plugin, whose `job_feed`
 * supports server-side keyword filtering via `search_keywords` and annotates
 * each item with namespaced `job_listing:company` and `job_listing:location`
 * elements. Both are conventions of the plugin rather than this site, so the
 * parser treats them as optional and falls back to the plain RSS fields.
 */
import * as cheerio from "cheerio";
import { fetchText } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  htmlToText,
  matchesQuery,
  resolveCountry,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const BOARD_ID = "jobspresso";
const ORIGIN = "https://jobspresso.co/";

export function buildJobspressoUrl(q: ScrapeQuery): string {
  const url = new URL(ORIGIN);
  url.searchParams.set("feed", "job_feed");
  if (q.query.trim()) url.searchParams.set("search_keywords", q.query.trim());
  return url.toString();
}

/** Reads a WP Job Manager namespaced element, e.g. `job_listing:company`. */
function nsField(item: cheerio.Cheerio<import("domhandler").Element>, name: string): string {
  return str(item.find(`job_listing\\:${name}`).first().text());
}

function parseFeed(xml: string, q: ScrapeQuery): ScrapedJob[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs: ScrapedJob[] = [];

  $("item").each((_, el) => {
    const item = $(el);
    const title = str(item.find("title").first().text());
    const sourceUrl = str(item.find("link").first().text());
    if (!title || !sourceUrl) return;

    const company = nsField(item, "company");
    const location = nsField(item, "location");
    const description = htmlToText(item.find("description").first().text());
    if (!matchesQuery([title, company, location, description].join(" "), q)) return;

    jobs.push({
      title,
      company: company || "Unknown",
      location: location || "Remote",
      description,
      sourceUrl,
      source: "JOBSPRESSO",
      workType: "Remote",
      postedAt: toDate(item.find("pubDate").first().text()),
      country: location ? resolveCountry(location) : undefined,
    });
  });

  return jobs;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const url = buildJobspressoUrl(q);

  let xml: string;
  try {
    xml = await fetchText(url, { signal: q.signal });
  } catch (err) {
    warn(`fetch failed for ${url}`, err);
    return [];
  }

  if (!xml.includes("<item")) return [];

  try {
    return capJobs(sortByLocationPreference(dedupeByUrl(parseFeed(xml, q)), q));
  } catch (err) {
    warn(`failed to parse ${url}`, err);
    return [];
  }
}

export const jobspressoBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Jobspresso",
  source: "JOBSPRESSO",
  homepage: "https://jobspresso.co",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "curated remote listings, free RSS feed",
  scrape,
};
