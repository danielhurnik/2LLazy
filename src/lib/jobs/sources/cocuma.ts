import type { CheerioAPI } from "cheerio";
import { absoluteUrl, blockText, fetchHtml, mainText } from "../http";
import { titleMatches } from "./match";
import {
  COUNTRY_NAMES,
  senioritySlug,
  type JobSource,
  type Listing,
  type RawJob,
  type SearchRequest,
} from "./types";

const BASE = "https://www.cocuma.cz";
const QUICK_SEARCH_PAGES = 3;
const DEEP_SEARCH_PAGES = 10;
const FULL_PAGE_CARD_COUNT = 10;
const MIN_PROFILE_SECTION_LENGTH = 40;

const JOB_LINK_SELECTOR = "a[href*='/job/']";
const JOB_CARD_SELECTOR = `a.job-thumbnail[href], ${JOB_LINK_SELECTOR}`;
const JOB_DETAIL_PATH = /\/job\//;

function browseAllJobsUrl(seniority: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (seniority) params.set("seniority", seniority);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `${BASE}/jobs/${query ? `?${query}` : ""}`;
}

function locallyMatchedListings($: CheerioAPI, request: SearchRequest): Listing[] {
  const listings: Listing[] = [];
  $(JOB_CARD_SELECTOR).each((_, anchor) => {
    const card = $(anchor);
    const url = absoluteUrl(card.attr("href"), BASE);
    const title = card.find(".job-thumbnail-title").text().trim() || card.attr("title")?.trim() || "";
    if (!url || !title || !JOB_DETAIL_PATH.test(url)) return;
    if (!titleMatches(title, request)) return;
    listings.push({
      url,
      title,
      company: card.find(".job-thumbnail-company").text().trim() || undefined,
      location: card.find("[class*='location' i], [class*='city' i]").first().text().trim() || undefined,
      workType: card.find(".job-thumbnail-work-shedule, [class*='schedule' i]").first().text().trim() || undefined,
    });
  });
  return listings;
}

function unseenListings(listings: Listing[], seenUrls: Set<string>): Listing[] {
  return listings.filter((listing) => {
    if (seenUrls.has(listing.url)) return false;
    seenUrls.add(listing.url);
    return true;
  });
}

function companyProfileText($: CheerioAPI): string {
  const sections = $(".company-profile-component")
    .map((_, section) => blockText($, $(section)))
    .get()
    .filter((text) => text.length > MIN_PROFILE_SECTION_LENGTH);
  return sections.length ? sections.join("\n\n") : mainText($);
}

export const cocumaSource: JobSource = {
  id: "cocuma",
  label: "Cocuma",
  source: "COCUMA",
  countries: ["CZ"],

  async *list(ctx) {
    const { deepSearch, skillLevel } = ctx.request;
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
    const seniority = senioritySlug(skillLevel);
    const seenUrls = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      const { $ } = await fetchHtml(browseAllJobsUrl(seniority, page), { signal: ctx.signal });
      const cardCount = $(JOB_LINK_SELECTOR).length;
      const listings = unseenListings(locallyMatchedListings($, ctx.request), seenUrls);
      ctx.log(`page ${page}: ${listings.length} matching of ${cardCount} cards`);
      if (cardCount === 0) return;
      yield listings;
      if (cardCount < FULL_PAGE_CARD_COUNT) return;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    const { $ } = await fetchHtml(listing.url, { signal: ctx.signal });
    return {
      title: $("h1").first().text().trim() || listing.title,
      company: listing.company ?? "",
      location: listing.location ?? COUNTRY_NAMES[ctx.request.country],
      description: companyProfileText($),
      url: listing.url,
      source: "COCUMA",
      workType: listing.workType,
    };
  },
};
