import type { AtsKind, Employer } from "../config";
import { fetchJson, htmlToText } from "../http";
import { isRecord, type JsonRecord } from "@/lib/guards";

export interface AtsPosting {
  id: string;
  title: string;
  url: string;
  location: string;
  description: string;
  remote: boolean;
  postedAt?: Date;
  salary?: string;
}

interface AtsAdapter {
  listUrl(employer: Employer): string;
  parseList(data: unknown, employer: Employer): AtsPosting[];
  descriptionUrl?(employer: Employer, posting: AtsPosting): string;
  parseDescription?(data: unknown): string;
}

const MAX_POSTINGS_PER_EMPLOYER = 200;
const REMOTE_WORD = /remote/i;
const HTML_ENTITY_DECODES: Array<[RegExp, string]> = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
];

const records = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter(isRecord) : []);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const identifier = (value: unknown, fallback: string): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : fallback;

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function decodeEntities(value: string): string {
  return HTML_ENTITY_DECODES.reduce((decoded, [pattern, replacement]) => decoded.replace(pattern, replacement), value);
}

function joinLocation(...parts: unknown[]): string {
  const kept: string[] = [];
  for (const part of parts.map(text).filter(Boolean)) {
    const lower = part.toLowerCase();
    const coveredAlready = kept.some((existing) => {
      const other = existing.toLowerCase();
      return other.includes(lower) || lower.includes(other);
    });
    if (!coveredAlready) kept.push(part);
  }
  return kept.join(", ");
}

function salaryRange(min: unknown, max: unknown, currency: unknown): string | undefined {
  const low = finiteNumber(min);
  const high = finiteNumber(max);
  if (low === undefined && high === undefined) return undefined;
  const figures = low !== undefined && high !== undefined ? `${low} - ${high}` : String(low ?? high);
  const unit = text(currency);
  return unit ? `${figures} ${unit}` : figures;
}

const greenhouse: AtsAdapter = {
  listUrl: ({ slug }) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
  parseList: (data) =>
    (isRecord(data) ? records(data.jobs) : []).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((job) => {
      const title = text(job.title);
      const url = text(job.absolute_url);
      if (!title || !url) return [];
      const location = joinLocation(
        isRecord(job.location) ? job.location.name : undefined,
        ...records(job.offices).map((office) => office.name),
      );
      return [
        {
          id: identifier(job.id, url),
          title,
          url,
          location,
          description: htmlToText(decodeEntities(text(job.content))),
          remote: REMOTE_WORD.test(location),
          postedAt: date(job.updated_at),
        },
      ];
    }),
};

const lever: AtsAdapter = {
  listUrl: ({ slug }) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=${MAX_POSTINGS_PER_EMPLOYER}`,
  parseList: (data) =>
    records(data).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((job) => {
      const title = text(job.text);
      const url = text(job.hostedUrl) || text(job.applyUrl);
      if (!title || !url) return [];
      const categories = isRecord(job.categories) ? job.categories : {};
      const allLocations = Array.isArray(categories.allLocations) ? categories.allLocations : [];
      const location = joinLocation(categories.location, ...allLocations);
      const salary = isRecord(job.salaryRange)
        ? salaryRange(job.salaryRange.min, job.salaryRange.max, job.salaryRange.currency)
        : undefined;
      return [
        {
          id: identifier(job.id, url),
          title,
          url,
          location,
          description: text(job.descriptionPlain) || htmlToText(text(job.description)),
          remote: job.workplaceType === "remote" || REMOTE_WORD.test(location),
          postedAt: date(job.createdAt),
          salary,
        },
      ];
    }),
};

const ashby: AtsAdapter = {
  listUrl: ({ slug }) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
  parseList: (data) =>
    (isRecord(data) ? records(data.jobs) : []).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((job) => {
      const title = text(job.title);
      const url = text(job.jobUrl);
      if (!title || !url) return [];
      const location = joinLocation(job.location, ...records(job.secondaryLocations).map((secondary) => secondary.location));
      const compensation = isRecord(job.compensation) ? text(job.compensation.compensationTierSummary) : "";
      return [
        {
          id: identifier(job.id, url),
          title,
          url,
          location,
          description: text(job.descriptionPlain) || htmlToText(text(job.descriptionHtml)),
          remote: job.isRemote === true || REMOTE_WORD.test(location),
          postedAt: date(job.publishedAt),
          salary: compensation || undefined,
        },
      ];
    }),
};

const recruitee: AtsAdapter = {
  listUrl: ({ slug }) => `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`,
  parseList: (data) =>
    (isRecord(data) ? records(data.offers) : []).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((offer) => {
      const title = text(offer.title);
      const url = text(offer.careers_url);
      if (!title || !url) return [];
      const location = joinLocation(offer.location, offer.city, offer.country);
      const salary = isRecord(offer.salary) ? salaryRange(offer.salary.min, offer.salary.max, offer.salary.currency) : undefined;
      return [
        {
          id: identifier(offer.id, url),
          title,
          url,
          location,
          description: htmlToText(`${text(offer.description)} ${text(offer.requirements)}`),
          remote: offer.remote === true || REMOTE_WORD.test(location),
          postedAt: date(offer.published_at) ?? date(offer.created_at),
          salary,
        },
      ];
    }),
};

const workable: AtsAdapter = {
  listUrl: ({ slug }) => `https://www.workable.com/api/accounts/${encodeURIComponent(slug)}?details=true`,
  parseList: (data) =>
    (isRecord(data) ? records(data.jobs) : []).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((job) => {
      const title = text(job.title);
      const url = text(job.url) || text(job.application_url);
      if (!title || !url) return [];
      const location = joinLocation(job.city, job.country);
      return [
        {
          id: text(job.shortcode) || url,
          title,
          url,
          location,
          description: htmlToText(`${text(job.description)} ${text(job.requirements)}`),
          remote: job.telecommuting === true || REMOTE_WORD.test(location),
          postedAt: date(job.created_at),
        },
      ];
    }),
};

const smartrecruiters: AtsAdapter = {
  listUrl: ({ slug }) => `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`,
  parseList: (data, employer) =>
    (isRecord(data) ? records(data.content) : []).slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((posting) => {
      const title = text(posting.name);
      const id = text(posting.id);
      if (!title || !id) return [];
      const place = isRecord(posting.location) ? posting.location : {};
      const company = (isRecord(posting.company) ? text(posting.company.identifier) : "") || employer.slug;
      const location = joinLocation(place.city, place.country);
      return [
        {
          id,
          title,
          url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(id)}`,
          location,
          description: "",
          remote: place.remote === true || REMOTE_WORD.test(location),
          postedAt: date(posting.releasedDate),
        },
      ];
    }),
  descriptionUrl: ({ slug }, posting) =>
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings/${encodeURIComponent(posting.id)}`,
  parseDescription: (data) => {
    const sections = isRecord(data) && isRecord(data.jobAd) && isRecord(data.jobAd.sections) ? data.jobAd.sections : {};
    return htmlToText(Object.values(sections).filter(isRecord).map((section) => text(section.text)).join("\n"));
  },
};

const ADAPTERS: Record<AtsKind, AtsAdapter> = { greenhouse, lever, ashby, smartrecruiters, recruitee, workable };

export function parsePostings(ats: AtsKind, data: unknown, employer: Employer): AtsPosting[] {
  return ADAPTERS[ats].parseList(data, employer);
}

export async function fetchEmployerPostings(employer: Employer, signal?: AbortSignal): Promise<AtsPosting[]> {
  const adapter = ADAPTERS[employer.ats];
  return adapter.parseList(await fetchJson<unknown>(adapter.listUrl(employer), { signal }), employer);
}

export async function withDescription(employer: Employer, posting: AtsPosting, signal?: AbortSignal): Promise<AtsPosting> {
  const adapter = ADAPTERS[employer.ats];
  if (posting.description || !adapter.descriptionUrl || !adapter.parseDescription) return posting;
  const data = await fetchJson<unknown>(adapter.descriptionUrl(employer, posting), { signal });
  return { ...posting, description: adapter.parseDescription(data) };
}
