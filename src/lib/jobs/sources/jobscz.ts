import { isPlaywrightEnabled, pwFetchHtml } from "@/lib/scrapers/playwright-browser";
import * as cheerio from "cheerio";
import { normalizeText } from "../dedupe";
import { absoluteUrl, blockText, collapseWhitespace, fetchHtml, mainText } from "../http";
import type { FetchContext, JobSource, Listing, RawJob } from "./types";

const BASE = "https://www.jobs.cz";
const QUICK_SEARCH_PAGES = 1;
const DEEP_SEARCH_PAGES = 3;
const ONE_DAY_MS = 86_400_000;
const MONTH_PREFIX_LENGTH = 3;
const MIN_COMPLETE_DESCRIPTION_LENGTH = 200;

const CZECH_MONTHS = ["ledna", "února", "března", "dubna", "května", "června", "července", "srpna", "září", "října", "listopadu", "prosince"];
const CZECH_DAY_AND_MONTH = /^(\d{1,2})\.\s*([a-záéíóúůýčďěňřšťž]+)/i;
const LOCATION_HINT = /praha|brno|ostrava|plzeň|olomouc|liberec|remote|home\s?office|,/i;

const RESULT_CARD_SELECTOR = "article.SearchResultCard, article[class*='SearchResultCard']";
const BRANDED_DESCRIPTION_SELECTOR = ".cp-detail__content, .m-detail__description";
const WIDGET_DETAIL_SELECTOR = "#vacancy-detail";
const NATIVE_DESCRIPTION_SELECTOR = "[data-jobad='body'], [data-test='jd-body-richtext'], .RichContent";
const RENDERED_DETAIL_SELECTOR = `${BRANDED_DESCRIPTION_SELECTOR}, ${NATIVE_DESCRIPTION_SELECTOR}`;

export function parseCzechDate(text: string, now = new Date()): Date | undefined {
  const match = text.trim().match(CZECH_DAY_AND_MONTH);
  if (!match) return undefined;
  const [, day, monthName] = match;
  const monthPrefix = monthName.toLowerCase().slice(0, MONTH_PREFIX_LENGTH);
  const month = CZECH_MONTHS.findIndex((name) => name.startsWith(monthPrefix));
  if (month === -1) return undefined;
  const date = new Date(now.getFullYear(), month, Number(day));
  const isInTheFuture = date.getTime() > now.getTime() + ONE_DAY_MS;
  if (isInTheFuture) date.setFullYear(now.getFullYear() - 1);
  return date;
}

function cityAsPathSegment(city: string): string {
  const slug = normalizeText(city).replace(/\s+/g, "-");
  return slug ? `${slug}/` : "";
}

function searchUrl(query: string, city: string, page: number): string {
  const params = new URLSearchParams();
  params.append("q[]", query);
  if (page > 1) params.set("page", String(page));
  return `${BASE}/prace/${cityAsPathSegment(city)}?${params.toString()}`;
}

function cardListings($: cheerio.CheerioAPI): Listing[] {
  const listings: Listing[] = [];
  $(RESULT_CARD_SELECTOR).each((_, element) => {
    const card = $(element);
    const link = card.find("a[data-jobad-id]").first();
    const url = absoluteUrl(link.attr("href"), BASE);
    const title = collapseWhitespace(link.text());
    if (!url || !title) return;

    const footerItems = card
      .find("[class*='footerItem'], footer li")
      .map((_, item) => collapseWhitespace($(item).text()))
      .get();
    const company =
      card.find("[class*='companyName'], [data-test*='company' i]").first().text().trim() ||
      card.find(".SearchResultCard__logo img").attr("alt")?.trim() ||
      footerItems[0] ||
      "";
    const location =
      card.find("[data-test*='locality' i], [class*='locality' i]").first().text().trim() ||
      footerItems.find((item) => LOCATION_HINT.test(item)) ||
      "";
    const salary = collapseWhitespace(card.find("[class*='salary' i], [data-test*='salary' i]").first().text()) || undefined;
    const postedAt = parseCzechDate(card.find("[class*='status']").first().text());

    listings.push({ url, title, company, location, salary, postedAt });
  });
  return listings;
}

function metaDescription($: cheerio.CheerioAPI): string {
  return (
    $("meta[property='og:description']").attr("content")?.trim() ||
    $("meta[name='description']").attr("content")?.trim() ||
    ""
  );
}

function isComplete(description: string): boolean {
  return description.length >= MIN_COMPLETE_DESCRIPTION_LENGTH;
}

function descriptionBody($: cheerio.CheerioAPI): string {
  const candidates = [
    blockText($, BRANDED_DESCRIPTION_SELECTOR),
    blockText($, NATIVE_DESCRIPTION_SELECTOR),
    blockText($, WIDGET_DETAIL_SELECTOR),
  ];
  return candidates.find(isComplete) ?? "";
}

async function serverRenderedDescription(listing: Listing, ctx: FetchContext): Promise<{ body: string; meta: string }> {
  try {
    const { $ } = await fetchHtml(listing.url, { signal: ctx.signal });
    return { body: descriptionBody($), meta: metaDescription($) };
  } catch (err) {
    ctx.log(`detail fetch failed for ${listing.url}: ${String(err)}`);
    return { body: "", meta: "" };
  }
}

async function clientRenderedDescription(listing: Listing, ctx: FetchContext): Promise<string> {
  try {
    const $ = cheerio.load(await pwFetchHtml(listing.url, RENDERED_DETAIL_SELECTOR));
    return descriptionBody($) || mainText($);
  } catch (err) {
    ctx.log(`playwright detail failed for ${listing.url}: ${String(err)}`);
    return "";
  }
}

function listingSummary(listing: Listing): string {
  return [listing.title, listing.company, listing.location].filter(Boolean).join(" — ");
}

export const jobsczSource: JobSource = {
  id: "jobscz",
  label: "Jobs.cz",
  source: "JOBSCZ",
  countries: ["CZ"],

  async *list(ctx) {
    const { query, city, deepSearch } = ctx.request;
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
    for (let page = 1; page <= maxPages; page++) {
      const { $ } = await fetchHtml(searchUrl(query, city, page), { signal: ctx.signal });
      const listings = cardListings($);
      ctx.log(`page ${page}: ${listings.length} cards`);
      if (listings.length === 0) return;
      yield listings;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    const { body, meta } = await serverRenderedDescription(listing, ctx);
    let description = isComplete(body) ? body : "";
    if (!description && isPlaywrightEnabled()) description = await clientRenderedDescription(listing, ctx);

    return {
      title: listing.title,
      company: listing.company ?? "",
      location: listing.location,
      description: description || meta || listingSummary(listing),
      url: listing.url,
      source: "JOBSCZ",
      salary: listing.salary,
      postedAt: listing.postedAt,
    };
  },
};
