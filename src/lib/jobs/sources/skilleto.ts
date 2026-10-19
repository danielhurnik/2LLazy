import { isPlaywrightEnabled, pwFetchHtml } from "@/lib/scrapers/playwright-browser";
import * as cheerio from "cheerio";
import { uniqueByUrl } from "../dedupe";
import { absoluteUrl, collapseWhitespace, mainText, robotsAllows } from "../http";
import { titleMatches } from "./match";
import { COUNTRY_NAMES, type FetchContext, type JobSource, type Listing, type RawJob } from "./types";

const BASE = "https://www.skilleto.cz";
const POSITION_LINK_SELECTOR = "a[href*='/jobs/']";
const JOB_CARD_SELECTOR = "[class*='_job_']";
const CARD_COMPANY_SELECTOR = "[class*='_company'] [class*='_name'], a[href*='/company/']";
const CARD_LOCATION_SELECTOR = "[class*='_location']";
const CARD_SALARY_SELECTOR = "[class*='_money']";
const SALARY_FOOTNOTE_MARK = "*";
const TITLE_PIN_EMOJI = /\u{1F4CD}/gu;
const MIN_RENDERED_DESCRIPTION_LENGTH = 80;

function querySlug(query: string): string {
  return encodeURIComponent(query.toLowerCase().trim().replace(/\s+/g, "-"));
}

function skillPageUrl(query: string): string {
  return `${BASE}/skill/${querySlug(query)}`;
}

function rolePageUrl(query: string): string {
  return `${BASE}/role/${querySlug(query)}`;
}

function cardListings($: cheerio.CheerioAPI, ctx: FetchContext): Listing[] {
  const listings: Listing[] = [];
  $(POSITION_LINK_SELECTOR).each((_, anchor) => {
    const href = absoluteUrl($(anchor).attr("href"), BASE);
    const title = collapseWhitespace($(anchor).text().replace(TITLE_PIN_EMOJI, ""));
    if (!href || !title || !titleMatches(title, ctx.request)) return;
    const card = $(anchor).closest(JOB_CARD_SELECTOR);
    listings.push({
      url: href,
      title,
      company: collapseWhitespace(card.find(CARD_COMPANY_SELECTOR).first().text()) || undefined,
      location: collapseWhitespace(card.find(CARD_LOCATION_SELECTOR).first().text()) || undefined,
      salary: collapseWhitespace(card.find(CARD_SALARY_SELECTOR).first().text().replace(SALARY_FOOTNOTE_MARK, "")) || undefined,
    });
  });
  return uniqueByUrl(listings);
}

export const skilletoSource: JobSource = {
  id: "skilleto",
  label: "Skilleto",
  source: "SKILLETO",
  countries: ["CZ"],
  isAvailable: isPlaywrightEnabled,

  async *list(ctx) {
    for (const url of [skillPageUrl(ctx.request.query), rolePageUrl(ctx.request.query)]) {
      if (!(await robotsAllows(url))) return;
      const listings = cardListings(cheerio.load(await pwFetchHtml(url, POSITION_LINK_SELECTOR)), ctx);
      ctx.log(`${url}: ${listings.length} matching positions`);
      if (listings.length === 0) continue;
      yield listings;
      return;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    if (!(await robotsAllows(listing.url))) return null;
    const $ = cheerio.load(await pwFetchHtml(listing.url));
    const description = mainText($);
    if (description.length < MIN_RENDERED_DESCRIPTION_LENGTH) return null;
    ctx.log(`read ${listing.url}`);
    return {
      title: $("h1").first().text().trim() || listing.title,
      company: listing.company || $("[class*='company' i]").first().text().trim(),
      location:
        listing.location ||
        $("[class*='location' i], [class*='city' i]").first().text().trim() ||
        ctx.request.city ||
        COUNTRY_NAMES[ctx.request.country],
      description,
      url: listing.url,
      source: "SKILLETO",
      salary: listing.salary,
    };
  },
};
