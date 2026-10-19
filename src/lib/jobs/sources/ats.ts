import { normalizeText } from "@/lib/text";
import { batchProcess } from "@/lib/scrapers/utils";
import { sourcesConfigFor, type Employer } from "../config";
import { detectCity } from "../normalize";
import { tokens } from "../score";
import { fetchEmployerPostings, withDescription, type AtsPosting } from "./atsAdapters";
import { titleMatches } from "./match";
import type { ApplyPath, CountryCode, FetchContext, JobSource, Listing, RawJob, SearchRequest } from "./types";

const EMPLOYER_CONCURRENCY = 4;
const DESCRIPTION_CONCURRENCY = 4;
const COUNTRY_WORDS: Record<CountryCode, RegExp> = { CZ: /czech|česk|czechia|\bcz\b/i };
const REMOTE_REGION_OPEN_TO_EUROPE = /\b(emea|europe|eu|cee|global|worldwide|anywhere|international|multiple locations)\b/i;
const REMOTE_WITHOUT_QUALIFIER = /^[\s,;()-]*remote[\s,;()-]*$/i;

function namesCountry(location: string, country: CountryCode): boolean {
  return COUNTRY_WORDS[country].test(location) || detectCity(location, country) !== null;
}

export function locatedInCountry(posting: Pick<AtsPosting, "location" | "remote">, country: CountryCode): boolean {
  if (namesCountry(posting.location, country)) return true;
  if (!posting.remote) return false;
  return REMOTE_WITHOUT_QUALIFIER.test(posting.location) || REMOTE_REGION_OPEN_TO_EUROPE.test(posting.location);
}

export function mentionsQuery(posting: Pick<AtsPosting, "description">, request: SearchRequest): boolean {
  const queryTokens = tokens(request.query);
  if (queryTokens.length === 0) return false;
  const description = normalizeText(posting.description);
  return queryTokens.every((token) => description.includes(token));
}

const ATS_WITH_PUBLIC_APPLY_API = new Set<Employer["ats"]>(["recruitee", "smartrecruiters"]);

function applyPathFor(posting: AtsPosting, employer: Employer): ApplyPath {
  return {
    kind: ATS_WITH_PUBLIC_APPLY_API.has(employer.ats) ? "ats-api" : "ats-form",
    url: posting.url,
    ats: employer.ats,
    slug: employer.slug,
    postingId: posting.id,
  };
}

function toRawJob(posting: AtsPosting, employer: Employer): RawJob {
  return {
    title: posting.title,
    company: employer.name,
    location: posting.location,
    description: posting.description || posting.title,
    url: posting.url,
    source: "ATS",
    salary: posting.salary,
    workType: posting.remote ? "Remote" : undefined,
    postedAt: posting.postedAt,
    applyPath: applyPathFor(posting, employer),
  };
}

function toListing(posting: AtsPosting, employer: Employer): Listing {
  return {
    url: posting.url,
    title: posting.title,
    company: employer.name,
    location: posting.location,
    salary: posting.salary,
    postedAt: posting.postedAt,
    job: toRawJob(posting, employer),
  };
}

async function employerListings(employer: Employer, ctx: FetchContext): Promise<Listing[]> {
  try {
    const postings = (await fetchEmployerPostings(employer, ctx.signal)).filter(
      (posting) =>
        locatedInCountry(posting, ctx.request.country) &&
        (titleMatches(posting.title, ctx.request) || mentionsQuery(posting, ctx.request)),
    );
    const described = await batchProcess(postings, DESCRIPTION_CONCURRENCY, (posting) =>
      withDescription(employer, posting, ctx.signal),
    );
    ctx.log(`${employer.name}: ${described.length} matching postings`);
    return described.map((posting) => toListing(posting, employer));
  } catch (err) {
    ctx.log(`${employer.name} failed: ${String(err)}`);
    return [];
  }
}

export const atsSource: JobSource = {
  id: "ats",
  label: "Company careers",
  source: "ATS",
  countries: ["CZ"],

  async *list(ctx) {
    const { employers } = sourcesConfigFor(ctx.request.country);
    const pages = await batchProcess(employers, EMPLOYER_CONCURRENCY, (employer) => employerListings(employer, ctx));
    const listings = pages.flat();
    if (listings.length > 0) yield listings;
  },
};
