import { fetchJson, htmlToText } from "../http";
import type { CountryCode, JobSource, Listing } from "./types";

interface JoobleJob {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
}

interface JoobleResponse {
  totalCount?: number;
  jobs?: JoobleJob[];
}

type PostableJoobleJob = JoobleJob & { link: string; title: string };

const QUICK_SEARCH_PAGES = 1;
const DEEP_SEARCH_PAGES = 3;
const API_HOST_BY_COUNTRY: Record<CountryCode, string> = { CZ: "https://cz.jooble.org" };

function apiKey(): string | undefined {
  return process.env.JOOBLE_API_KEY?.trim() || undefined;
}

function isPostable(job: JoobleJob): job is PostableJoobleJob {
  return Boolean(job.link && job.title);
}

function parseUpdatedAt(updated: string | undefined): Date | undefined {
  if (!updated) return undefined;
  const date = new Date(updated);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toListing(job: PostableJoobleJob): Listing {
  const postedAt = parseUpdatedAt(job.updated);
  const salary = job.salary || undefined;
  return {
    url: job.link,
    title: job.title,
    company: job.company,
    location: job.location,
    salary,
    postedAt,
    job: {
      title: job.title,
      company: job.company ?? "",
      location: job.location,
      description: htmlToText(job.snippet),
      url: job.link,
      source: "JOOBLE",
      salary,
      workType: job.type || undefined,
      postedAt,
    },
  };
}

export const joobleSource: JobSource = {
  id: "jooble",
  label: "Jooble",
  source: "JOOBLE",
  countries: ["CZ"],
  isAvailable: () => Boolean(apiKey()),

  async *list(ctx) {
    const key = apiKey();
    if (!key) return;
    const { query, city, deepSearch, country } = ctx.request;
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;

    for (let page = 1; page <= maxPages; page++) {
      const data = await fetchJson<JoobleResponse>(`${API_HOST_BY_COUNTRY[country]}/api/${key}`, {
        method: "POST",
        body: JSON.stringify({ keywords: query, location: city, page }),
        signal: ctx.signal,
      });
      const jobs = data.jobs ?? [];
      if (jobs.length === 0) return;

      const listings = jobs.filter(isPostable).map(toListing);
      yield listings;
      ctx.log(`page ${page}: ${listings.length} jobs (total ${data.totalCount ?? "?"})`);
    }
  },
};
