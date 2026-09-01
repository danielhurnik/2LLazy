/**
 * Hacker News "Who is hiring?" — the monthly hiring thread, read as RSS.
 *
 * hnrss.org proxies the official HN Algolia search and serves the comments of
 * the latest "Ask HN: Who is hiring?" thread as a feed, with server-side
 * keyword filtering via `q`. High-signal startup roles, and the only board
 * here where postings are written by a human straight into a text box.
 *
 * That free-text origin is the whole parsing problem: the thread's convention
 * is a first line of pipe-separated fields — "Company | Role | Location |
 * salary | …" — which most posters follow and nobody enforces. The parser
 * reads the convention where it holds and degrades to "the whole first line
 * is the title" where it does not, because dropping a posting over formatting
 * would throw away exactly the hand-written roles this board exists for.
 */
import * as cheerio from "cheerio";
import { fetchText } from "../fetcher";
import type { BoardDefinition, ScrapeQuery, ScrapedJob, WorkType } from "../types";
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

const BOARD_ID = "whoishiring";
const FEED_BASE = "https://hnrss.org/whoishiring/jobs";

export function buildWhoIsHiringUrl(q: ScrapeQuery): string {
  // 100 is the most hnrss serves per request; the thread has no pagination.
  const params = new URLSearchParams({ count: "100" });
  if (q.query.trim()) params.set("q", q.query.trim());
  return `${FEED_BASE}?${params.toString()}`;
}

/** Looks like money: "$150k", "€60-80k", "£90,000", "120k USD". */
const SALARY_PATTERN = /(?:[$€£]\s?\d)|(?:\b\d{2,3}\s?[-–]?\s?\d{0,3}\s?k\b)|(?:\b\d{2,3}k\s?(?:USD|EUR|GBP)\b)/i;

export interface HnTitle {
  company: string;
  title: string;
  location: string;
  salary?: string;
}

/**
 * Splits the conventional "Company | Role | Location | …" first line.
 *
 * Fewer than two fields means the poster did not follow the convention; the
 * whole line becomes the title and the company stays unknown rather than
 * guessing wrong. Trailing fields are location or salary by content, not by
 * position — posters order them freely.
 */
export function parseHnTitle(rawTitle: string): HnTitle {
  const parts = rawTitle.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { company: "", title: rawTitle.trim(), location: "" };

  const rest = parts.slice(2);
  const salary = rest.find((p) => SALARY_PATTERN.test(p));
  const location = rest
    .filter((p) => p !== salary && p.length <= 60)
    .slice(0, 2)
    .join(" · ");

  return { company: parts[0], title: parts[1], location, salary };
}

function workTypeFrom(text: string): WorkType | undefined {
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  if (/\bon-?site\b/i.test(text)) return "Onsite";
  return undefined;
}

function parseFeed(xml: string, q: ScrapeQuery): ScrapedJob[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const jobs: ScrapedJob[] = [];

  $("item").each((_, el) => {
    const item = $(el);
    const rawTitle = str(item.find("title").first().text());
    const sourceUrl = str(item.find("link").first().text());
    if (!rawTitle || !sourceUrl) return;

    const { company, title, location, salary } = parseHnTitle(rawTitle);
    const description = htmlToText(item.find("description").first().text());
    if (!matchesQuery([rawTitle, description].join(" "), q)) return;

    jobs.push({
      title,
      company: company || "Unknown",
      location: location || "See posting",
      description,
      sourceUrl,
      source: "WHOISHIRING",
      salary,
      workType: workTypeFrom(`${rawTitle} ${description.slice(0, 400)}`),
      postedAt: toDate(item.find("pubDate").first().text()),
      country: location ? resolveCountry(location) : undefined,
    });
  });

  return jobs;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const url = buildWhoIsHiringUrl(q);

  let xml: string;
  try {
    xml = await fetchText(url, { signal: q.signal });
  } catch (err) {
    warn(`fetch failed for ${url}`, err);
    return [];
  }

  if (!xml.includes("<item")) {
    // A thread between months, or hnrss having a bad day — either way, empty.
    return [];
  }

  try {
    return capJobs(sortByLocationPreference(dedupeByUrl(parseFeed(xml, q)), q));
  } catch (err) {
    warn(`failed to parse ${url}`, err);
    return [];
  }
}

export const whoIsHiringBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "HN Who is hiring?",
  source: "WHOISHIRING",
  homepage: "https://news.ycombinator.com",
  countries: [WORLDWIDE],
  // The thread carries onsite and hybrid roles alongside remote ones.
  remoteOnly: false,
  requiresBrowser: false,
  note: "monthly Ask HN thread via hnrss.org, no key required",
  scrape,
};
