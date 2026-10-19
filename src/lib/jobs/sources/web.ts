import * as cheerio from "cheerio";
import { batchProcess } from "@/lib/scrapers/utils";
import { normalizeText } from "../dedupe";
import { absoluteUrl, fetchHtml, fetchText, HttpError } from "../http";
import { detectCity } from "../normalize";
import { knownWebHosts, recordWebHost } from "../repo";
import { tokens } from "../score";
import { jobPostingsIn, type JsonLdJobPosting } from "./jsonld";
import { COUNTRY_NAMES, type CountryCode, type FetchContext, type JobSource, type Listing, type RawJob, type SearchRequest } from "./types";

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const QUICK_SEARCH_PAGES = 10;
const DEEP_SEARCH_PAGES = 20;
const QUICK_HOPS_PER_PAGE = 3;
const DEEP_HOPS_PER_PAGE = 5;
const PAGE_CONCURRENCY = 4;
const RESULT_LINK_SELECTOR = "a.result__a[href]";
const REDIRECT_TARGET_PARAM = "uddg";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SEARCH_REGION: Record<CountryCode, string> = { CZ: "cz-cs" };
const JOB_WORDS: Record<CountryCode, string> = { CZ: "(job OR práce OR kariéra OR careers)" };
const LOCAL_JOB_WORDS: Record<CountryCode, string> = { CZ: "nabídka práce" };
const LOCAL_TITLE_WORDS: Record<CountryCode, Array<[RegExp, string]>> = {
  CZ: [
    [/\bdevelopers?\b/gi, "vývojář"],
    [/\bengineers?\b/gi, "inženýr"],
    [/\banalysts?\b/gi, "analytik"],
    [/\bdesigners?\b/gi, "designér"],
    [/\bprogrammers?\b/gi, "programátor"],
  ],
};
const DETAIL_ID_IN_PATH = /\d{3,}/;
const GONE_STATUSES = new Set([404, 410]);
const MIN_DETAIL_PATH_DEPTH = 2;
const COUNTRY_WORDS: Record<CountryCode, RegExp> = { CZ: /czech|česk|czechia|\bcz\b/i };
const BOARDS_ALREADY_COVERED = ["jobs.cz", "prace.cz", "startupjobs.cz", "jobstack.it", "cocuma.cz", "skilleto.cz", "nofluffjobs.com", "jooble.org"];
const HOSTS_WITHOUT_READABLE_POSTINGS = [
  "indeed.com",
  "glassdoor.com",
  "glassdoor.co.in",
  "glassdoor.cz",
  "linkedin.com",
  "google.com",
  "facebook.com",
  "youtube.com",
  "wikipedia.org",
  "reddit.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "duckduckgo.com",
];

interface SearchResult {
  url: string;
  title: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

const underDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

export function isWorthVisiting(url: string): boolean {
  const host = hostOf(url);
  if (!host || !url.startsWith("http")) return false;
  const skipped = [...BOARDS_ALREADY_COVERED, ...HOSTS_WITHOUT_READABLE_POSTINGS];
  return !skipped.some((domain) => underDomain(host, domain));
}

function redirectTarget(href: string): string | null {
  try {
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    return url.searchParams.get(REDIRECT_TARGET_PARAM) ?? (url.hostname.includes("duckduckgo") ? null : url.toString());
  } catch {
    return null;
  }
}

export function searchResults(html: string): SearchResult[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  $(RESULT_LINK_SELECTOR).each((_, anchor) => {
    const target = redirectTarget($(anchor).attr("href") ?? "");
    if (!target || seen.has(target)) return;
    seen.add(target);
    results.push({ url: target, title: $(anchor).text().replace(/\s+/g, " ").trim() });
  });
  return results;
}

function pathText(url: string): string {
  try {
    return normalizeText(decodeURIComponent(new URL(url).pathname));
  } catch {
    return "";
  }
}

function looksLikeDetailPage(url: string): number {
  const path = pathText(url);
  const depth = path.split(" ").filter(Boolean).length;
  return (DETAIL_ID_IN_PATH.test(url) ? 2 : 0) + (depth >= MIN_DETAIL_PATH_DEPTH ? 1 : 0);
}

export function hopLinks($: cheerio.CheerioAPI, pageUrl: string, query: string, limit: number): string[] {
  const host = hostOf(pageUrl);
  const words = tokens(query);
  if (!host || words.length === 0) return [];
  const scored = new Map<string, number>();
  $("a[href]").each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr("href"), pageUrl)?.split("#")[0];
    if (!href || hostOf(href) !== host || href === pageUrl || scored.has(href)) return;
    const anchorText = normalizeText($(anchor).text());
    const mentionsQuery = words.some((word) => anchorText.includes(word) || pathText(href).includes(word));
    if (mentionsQuery) scored.set(href, looksLikeDetailPage(href) + (words.some((word) => anchorText.includes(word)) ? 1 : 0));
  });
  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([href]) => href)
    .slice(0, limit);
}

function localizedQuery(query: string, country: CountryCode): string {
  return LOCAL_TITLE_WORDS[country].reduce((text, [pattern, word]) => text.replace(pattern, word), query);
}

export function searchQueries({ query, city, country }: SearchRequest): string[] {
  const place = city || COUNTRY_NAMES[country];
  const local = localizedQuery(query, country);
  const variants = [`${query} ${place} ${JOB_WORDS[country]}`, `${local} ${place} ${LOCAL_JOB_WORDS[country]}`];
  return Array.from(new Set(variants));
}

function knownHostsFirst(results: SearchResult[], known: Set<string>): SearchResult[] {
  const rank = (result: SearchResult) => (known.has(hostOf(result.url)) ? 0 : 1);
  return [...results].sort((a, b) => rank(a) - rank(b));
}

export function locatedInCountryOrUnknown(posting: Pick<JsonLdJobPosting, "location" | "remote">, country: CountryCode): boolean {
  if (posting.remote || !posting.location) return true;
  return COUNTRY_WORDS[country].test(posting.location) || detectCity(posting.location, country) !== null;
}

function toRawJob(posting: JsonLdJobPosting, url: string): RawJob {
  return {
    title: posting.title,
    company: posting.company,
    location: posting.location || undefined,
    description: posting.description || posting.title,
    url,
    source: "WEB",
    salary: posting.salary,
    workType: posting.remote ? "Remote" : undefined,
    postedAt: posting.postedAt,
  };
}

function toListing(posting: JsonLdJobPosting, url: string): Listing {
  return { url, title: posting.title, company: posting.company, location: posting.location, salary: posting.salary, postedAt: posting.postedAt, job: toRawJob(posting, url) };
}

async function postingOn(url: string, ctx: FetchContext): Promise<{ listing: Listing | null; $: cheerio.CheerioAPI; url: string } | null> {
  try {
    const page = await fetchHtml(url, { signal: ctx.signal });
    const posting = jobPostingsIn(page.$).find((candidate) => locatedInCountryOrUnknown(candidate, ctx.request.country));
    return { listing: posting ? toListing(posting, page.url) : null, $: page.$, url: page.url };
  } catch (err) {
    ctx.log(`skipped ${url}: ${String(err).slice(0, 100)}`);
    return null;
  }
}

async function postingsReachableFrom(result: SearchResult, ctx: FetchContext, hops: number): Promise<Listing[]> {
  const page = await postingOn(result.url, ctx);
  if (!page) return [];
  if (page.listing) return [page.listing];
  const links = hopLinks(page.$, page.url, ctx.request.query, hops).filter(isWorthVisiting);
  const reached = await batchProcess(links, hops, async (link) => (await postingOn(link, ctx))?.listing ?? null);
  return reached;
}

async function searchPage(query: string, country: CountryCode, signal?: AbortSignal): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, kl: SEARCH_REGION[country] });
  const { text } = await fetchText(`${SEARCH_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });
  return searchResults(text);
}

async function discover(ctx: FetchContext): Promise<SearchResult[]> {
  const { request, signal } = ctx;
  const seen = new Set<string>();
  const all: SearchResult[] = [];
  for (const query of searchQueries(request)) {
    for (const result of await searchPage(query, request.country, signal)) {
      if (!seen.has(result.url) && seen.add(result.url)) all.push(result);
    }
  }
  const limit = request.deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
  const usable = all.filter((result) => isWorthVisiting(result.url));
  const ordered = knownHostsFirst(usable, await knownWebHosts()).slice(0, limit);
  ctx.log(`${ordered.length} pages to read from ${all.length} search results`);
  return ordered;
}

export const webSource: JobSource = {
  id: "web",
  label: "Web search",
  source: "WEB",
  countries: ["CZ"],

  async *list(ctx) {
    const results = await discover(ctx);
    const hops = ctx.request.deepSearch ? DEEP_HOPS_PER_PAGE : QUICK_HOPS_PER_PAGE;
    const pages = await batchProcess(results, PAGE_CONCURRENCY, (result) => postingsReachableFrom(result, ctx, hops));
    const seen = new Set<string>();
    const listings = pages.flat().filter((listing) => !seen.has(listing.url) && seen.add(listing.url));
    for (const listing of listings) await recordWebHost(hostOf(listing.url));
    ctx.log(`${listings.length} postings found on ${new Set(listings.map((listing) => hostOf(listing.url))).size} sites`);
    if (listings.length > 0) yield listings;
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    let page: { $: cheerio.CheerioAPI; url: string };
    try {
      page = await fetchHtml(listing.url, { signal: ctx.signal });
    } catch (err) {
      if (err instanceof HttpError && GONE_STATUSES.has(err.status)) return null;
      throw err;
    }
    const posting = jobPostingsIn(page.$).find((candidate) => locatedInCountryOrUnknown(candidate, ctx.request.country));
    return posting ? toRawJob(posting, listing.url) : null;
  },
};
