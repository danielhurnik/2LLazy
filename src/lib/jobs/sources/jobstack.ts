import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { uniqueByUrl } from "../dedupe";
import { absoluteUrl, blockText, collapseWhitespace, fetchHtml, mainText } from "../http";
import { COUNTRY_NAMES, senioritySlug, type JobSource, type Listing, type RawJob } from "./types";

const BASE = "https://www.jobstack.it";
const QUICK_SEARCH_PAGES = 1;
const DEEP_SEARCH_PAGES = 5;
const MIN_PAGE_WRAPPER_DESCRIPTION_LENGTH = 200;

const JOB_DETAIL_PATH = /\/it-job\//;
const WORK_MODE_LABEL = /remote|hybrid|home ?office|on-?site/i;
const ADDRESS_LABEL = /\d{3} ?\d{2}\b|\d+\/\d+/;

function searchUrl(query: string, seniority: string | undefined, page: number): string {
  const params = new URLSearchParams({ keywords: query, isDetail: "1" });
  if (seniority) params.set("seniority", seniority);
  if (page > 1) params.set("page", String(page));
  return `${BASE}/it-jobs?${params.toString()}`;
}

function cardListings($: CheerioAPI): Listing[] {
  const labelTexts = (link: Cheerio<AnyNode>, selector: string) =>
    link
      .find(selector)
      .map((_, label) => collapseWhitespace($(label).text()))
      .get();

  const listings: Listing[] = [];
  $("li.jobposts-item, a.jobpost-mainlink").each((_, node) => {
    const element = $(node);
    const link = node.tagName === "a" ? element : element.find("a.jobpost-mainlink").first();
    const url = absoluteUrl(link.attr("href"), BASE);
    const title = collapseWhitespace(link.find("h3").first().text());
    if (!url || !title || !JOB_DETAIL_PATH.test(url)) return;
    const secondaryLabels = labelTexts(link, ".custom-profile-label--secondary");
    const location = secondaryLabels.find((label) => ADDRESS_LABEL.test(label)) ?? secondaryLabels[1];
    const company = secondaryLabels.find((label) => label !== location);
    listings.push({
      url,
      title,
      company: company || undefined,
      location: location || undefined,
      salary: collapseWhitespace(link.find(".jobposts-item_salary").text()) || undefined,
      workType: labelTexts(link, ".custom-profile-label").find((label) => WORK_MODE_LABEL.test(label)),
    });
  });
  return uniqueByUrl(listings);
}

function postingDescription($: CheerioAPI): string {
  const pageWrapperText = blockText($, ".page-wrapper");
  return pageWrapperText.length >= MIN_PAGE_WRAPPER_DESCRIPTION_LENGTH ? pageWrapperText : mainText($);
}

export const jobstackSource: JobSource = {
  id: "jobstack",
  label: "Jobstack",
  source: "JOBSTACK",
  countries: ["CZ"],

  async *list(ctx) {
    const { query, deepSearch, skillLevel } = ctx.request;
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
    const seniority = senioritySlug(skillLevel);

    for (let page = 1; page <= maxPages; page++) {
      const { $ } = await fetchHtml(searchUrl(query, seniority, page), { signal: ctx.signal });
      const listings = cardListings($);
      ctx.log(`page ${page}: ${listings.length} cards`);
      if (listings.length === 0) return;
      yield listings;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    const { $ } = await fetchHtml(listing.url, { signal: ctx.signal });
    return {
      title: collapseWhitespace($("h1").first().text()) || listing.title,
      company: listing.company ?? "",
      location: listing.location ?? COUNTRY_NAMES[ctx.request.country],
      description: postingDescription($),
      url: listing.url,
      source: "JOBSTACK",
      salary: listing.salary,
      workType: listing.workType,
    };
  },
};
