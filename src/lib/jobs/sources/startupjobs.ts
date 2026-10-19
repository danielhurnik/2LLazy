import { isPlaywrightEnabled, pwFetchHtml } from "@/lib/scrapers/playwright-browser";
import * as cheerio from "cheerio";
import { uniqueByUrl } from "../dedupe";
import { absoluteUrl, blockText, collapseWhitespace, mainText, robotsAllows } from "../http";
import { COUNTRY_NAMES, senioritySlug, type JobSource, type Listing, type RawJob } from "./types";

const BASE = "https://www.startupjobs.cz";
const QUICK_SEARCH_PAGES = 2;
const DEEP_SEARCH_PAGES = 4;
const MAX_TITLE_LENGTH = 200;
const MIN_RENDERED_DESCRIPTION_LENGTH = 80;
const OFFER_LINK_SELECTOR = "a[href*='/nabidka/']";
const RICH_TEXT_DESCRIPTION_SELECTOR = ".tiptap";
const CARD_COMPANY_SELECTOR = "[class*='line-clamp']";
const CARD_TITLE_SELECTOR = "[class*='font-semibold']";
const CARD_TITLE_BADGE_SELECTOR = "span";
const CARD_FACTS_SELECTOR = "ul li";
const SALARY_PATTERN = /\d.*(kč|czk|eur|€|usd)|(kč|czk|eur|€|usd).*\d/i;
const WORK_MODE_PATTERN = /remote|hybrid|onsite|on-site|vzdálen/i;
const EMPLOYMENT_PATTERN = /full-time|part-time|contract|intern|freelance|plný|zkrácený|brigád/i;

function cardFacts(items: string[]): Pick<Listing, "salary" | "workType" | "location"> {
  const salary = items.find((item) => SALARY_PATTERN.test(item));
  const workMode = items.find((item) => WORK_MODE_PATTERN.test(item));
  const employment = items.find((item) => EMPLOYMENT_PATTERN.test(item));
  const location = items.find((item) => ![salary, workMode, employment].includes(item));
  return { salary, workType: [workMode, employment].filter(Boolean).join(", ") || undefined, location };
}

function searchUrl(query: string, seniority: string | undefined, page: number): string {
  const params = new URLSearchParams({ search: query });
  if (seniority) params.set("seniority", seniority);
  if (page > 1) params.set("page", String(page));
  return `${BASE}/nabidky?${params.toString()}`;
}

function offerListings($: cheerio.CheerioAPI): Listing[] {
  const listings: Listing[] = [];
  $(OFFER_LINK_SELECTOR).each((_, anchor) => {
    const offer = $(anchor);
    const href = absoluteUrl(offer.attr("href"), BASE);
    const titleBlock = offer.find(CARD_TITLE_SELECTOR).first().clone();
    titleBlock.find(CARD_TITLE_BADGE_SELECTOR).remove();
    const title = collapseWhitespace(titleBlock.text() || offer.find("h2, h3").first().text() || offer.text());
    if (!href || !title) return;
    const company = collapseWhitespace(offer.find(CARD_COMPANY_SELECTOR).first().text()) || undefined;
    const facts = cardFacts(offer.find(CARD_FACTS_SELECTOR).map((_, item) => collapseWhitespace($(item).text())).get());
    listings.push({ url: href, title: title.slice(0, MAX_TITLE_LENGTH), company, ...facts });
  });
  return uniqueByUrl(listings);
}

export const startupjobsSource: JobSource = {
  id: "startupjobs",
  label: "StartupJobs",
  source: "STARTUPJOBS",
  countries: ["CZ"],
  isAvailable: isPlaywrightEnabled,

  async *list(ctx) {
    const { query, deepSearch, skillLevel } = ctx.request;
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
    const seniority = senioritySlug(skillLevel);

    for (let page = 1; page <= maxPages; page++) {
      const url = searchUrl(query, seniority, page);
      if (!(await robotsAllows(url))) return;
      const listings = offerListings(cheerio.load(await pwFetchHtml(url, OFFER_LINK_SELECTOR)));
      ctx.log(`page ${page}: ${listings.length} offers`);
      if (listings.length === 0) return;
      yield listings;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    if (!(await robotsAllows(listing.url))) return null;
    const $ = cheerio.load(await pwFetchHtml(listing.url, "h1"));
    const description = blockText($, RICH_TEXT_DESCRIPTION_SELECTOR) || mainText($);
    if (description.length < MIN_RENDERED_DESCRIPTION_LENGTH) return null;
    ctx.log(`read ${listing.url}`);
    return {
      title: collapseWhitespace($("h1").first().text()) || listing.title,
      company: listing.company || collapseWhitespace($("[class*='company' i] a, [class*='company' i]").first().text()),
      location:
        listing.location ||
        collapseWhitespace($("[class*='location' i], [class*='locality' i]").first().text()) ||
        COUNTRY_NAMES[ctx.request.country],
      description,
      url: listing.url,
      source: "STARTUPJOBS",
      salary: listing.salary,
      workType: listing.workType,
    };
  },
};
