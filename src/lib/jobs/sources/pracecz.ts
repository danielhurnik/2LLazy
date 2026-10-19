import { normalizeText } from "@/lib/text";
import * as cheerio from "cheerio";
import { absoluteUrl, collapseWhitespace, fetchHtml } from "../http";
import { jobPostingsIn } from "./jsonld";
import type { FetchContext, JobSource, Listing, RawJob } from "./types";

const BASE = "https://www.prace.cz";
const CARD_LINK_SELECTOR = "a[data-testid='advert-link'][href]";
const CARD_SELECTOR = "[class*='StackItem']";
const CARD_FIELD_SELECTOR = "li";
const FIELD_LABELS = { location: "lokalita", company: "nazev firmy", salary: "plat", employment: "typ uvazku" } as const;
const MIN_COMPLETE_DESCRIPTION_LENGTH = 200;

interface CardFields {
  location?: string;
  company?: string;
  salary?: string;
  workType?: string;
}

function cityAsPathSegment(city: string): string {
  const slug = normalizeText(city).replace(/\s+/g, "-");
  return slug ? `${slug}/` : "";
}

function searchUrl(query: string, city: string): string {
  const params = new URLSearchParams();
  params.append("q[]", query);
  return `${BASE}/nabidky/${cityAsPathSegment(city)}?${params.toString()}`;
}

function labelledValue(text: string): [string, string] | null {
  const separator = text.indexOf(":");
  if (separator === -1) return null;
  return [normalizeText(text.slice(0, separator)), collapseWhitespace(text.slice(separator + 1))];
}

function cardFields($: cheerio.CheerioAPI, card: cheerio.Cheerio<import("domhandler").AnyNode>): CardFields {
  const fields: CardFields = {};
  card.find(CARD_FIELD_SELECTOR).each((_, item) => {
    const parsed = labelledValue(collapseWhitespace($(item).text()));
    if (!parsed) return;
    const [label, value] = parsed;
    if (label === FIELD_LABELS.location) fields.location = value;
    else if (label === FIELD_LABELS.company) fields.company = value;
    else if (label === FIELD_LABELS.salary) fields.salary = value;
    else if (label === FIELD_LABELS.employment) fields.workType = value;
  });
  return fields;
}

export function cardListings($: cheerio.CheerioAPI): Listing[] {
  const listings: Listing[] = [];
  const seen = new Set<string>();
  $(CARD_LINK_SELECTOR).each((_, anchor) => {
    const link = $(anchor);
    const url = absoluteUrl(link.attr("href"), BASE);
    const title = collapseWhitespace(link.text());
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    listings.push({ url, title, ...cardFields($, link.closest(CARD_SELECTOR)) });
  });
  return listings;
}

function listingSummary(listing: Listing): string {
  return [listing.title, listing.company, listing.location].filter(Boolean).join(" — ");
}

export const praceczSource: JobSource = {
  id: "pracecz",
  label: "Prace.cz",
  source: "WEB",
  countries: ["CZ"],

  async *list(ctx) {
    const { query, city } = ctx.request;
    const { $ } = await fetchHtml(searchUrl(query, city), { signal: ctx.signal });
    const listings = cardListings($);
    ctx.log(`${listings.length} cards`);
    if (listings.length > 0) yield listings;
  },

  async detail(listing, ctx: FetchContext): Promise<RawJob | null> {
    const { $ } = await fetchHtml(listing.url, { signal: ctx.signal });
    const posting = jobPostingsIn($)[0];
    const description = posting?.description ?? "";
    return {
      title: posting?.title || listing.title,
      company: posting?.company || listing.company || "",
      location: posting?.location || listing.location,
      description: description.length >= MIN_COMPLETE_DESCRIPTION_LENGTH ? description : description || listingSummary(listing),
      url: listing.url,
      source: "WEB",
      salary: listing.salary ?? posting?.salary,
      workType: posting?.remote ? "Remote" : listing.workType,
      postedAt: posting?.postedAt,
    };
  },
};
