import { fetchJson, htmlToText } from "../http";
import type { CountryCode, JobSource, Listing, RawJob } from "./types";

const HOST = "nofluffjobs.com";
const BASE = `https://${HOST}`;
const PAGE_SIZE = 40;
const QUICK_SEARCH_PAGES = 2;
const DEEP_SEARCH_PAGES = 5;
const MAX_LISTED_CITIES = 3;
const REMOTE = "Remote";
const MONTHLY_PERIOD = "month";
const MONTHLY_PERIOD_LABEL = "měsíc";

const COUNTRY_CODES: Record<CountryCode, { region: string; iso3: string }> = { CZ: { region: "cz", iso3: "CZE" } };

interface NfjPlace {
  city?: string;
  country?: { code?: string; name?: string };
}
interface NfjSalary {
  from?: number;
  to?: number;
  currency?: string;
  period?: string;
  type?: string;
}
interface NfjPosting {
  id: string;
  title?: string;
  name?: string;
  posted?: number;
  renewed?: number;
  url?: string;
  regions?: string[];
  fullyRemote?: boolean;
  seniority?: string[];
  salary?: NfjSalary;
  location?: { places?: NfjPlace[] };
  technology?: string;
}
interface NfjSearchResponse {
  postings?: NfjPosting[];
  totalCount?: number;
}
interface NfjRequirement {
  value?: string;
}
interface NfjPostingDetail {
  details?: { description?: string };
  requirements?: { musts?: NfjRequirement[]; nices?: NfjRequirement[]; description?: string };
  specs?: { dailyTasks?: string[] };
}

function robotsOptInPresent(): boolean {
  if (process.env.ROBOTS_POLICY === "ignore") return true;
  return (process.env.ROBOTS_ALLOW ?? "").toLowerCase().includes(HOST);
}

function searchUrl(region: string, page: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
    salaryCurrency: "CZK",
    salaryPeriod: MONTHLY_PERIOD,
    region,
  });
  return `${BASE}/api/search/posting?${params.toString()}`;
}

function salaryRange({ from, to }: NfjSalary): string {
  return from && to && from !== to ? `${from} - ${to}` : String(to ?? from);
}

function salaryPeriodLabel(period: string | undefined): string {
  const normalized = period?.toLowerCase() ?? "";
  return normalized === MONTHLY_PERIOD ? MONTHLY_PERIOD_LABEL : normalized;
}

function formatSalary(salary: NfjSalary | undefined): string | undefined {
  if (!salary?.from && !salary?.to) return undefined;
  const period = salaryPeriodLabel(salary.period);
  const periodSuffix = period ? ` / ${period}` : "";
  const typeSuffix = salary.type ? ` (${salary.type})` : "";
  return `${salaryRange(salary)} ${salary.currency ?? ""}${periodSuffix}${typeSuffix}`.trim();
}

function describeLocation(posting: NfjPosting, iso3: string): string {
  const places = posting.location?.places ?? [];
  const localCities = places.flatMap((place) => (place.country?.code === iso3 && place.city ? [place.city] : []));
  const isRemote = posting.fullyRemote || places.some((place) => place.city?.toLowerCase() === REMOTE.toLowerCase());
  const parts = Array.from(new Set(localCities)).slice(0, MAX_LISTED_CITIES);
  if (isRemote) parts.push(REMOTE);
  return parts.join(", ");
}

function isInCountry(posting: NfjPosting, region: string, iso3: string): boolean {
  if (posting.regions?.includes(region)) return true;
  return (posting.location?.places ?? []).some((place) => place.country?.code === iso3);
}

function requirementValues(requirements: NfjRequirement[] | undefined): string[] {
  return (requirements ?? []).flatMap((requirement) => (requirement.value ? [requirement.value] : []));
}

function postingDescription(detail: NfjPostingDetail): string {
  const musts = requirementValues(detail.requirements?.musts);
  const nices = requirementValues(detail.requirements?.nices);
  const dailyTasks = detail.specs?.dailyTasks ?? [];
  return [
    htmlToText(detail.details?.description),
    dailyTasks.length ? `Daily tasks:\n- ${dailyTasks.join("\n- ")}` : "",
    musts.length ? `Must have: ${musts.join(", ")}` : "",
    nices.length ? `Nice to have: ${nices.join(", ")}` : "",
    htmlToText(detail.requirements?.description),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const nofluffjobsSource: JobSource = {
  id: "nofluffjobs",
  label: "NoFluffJobs",
  source: "NOFLUFFJOBS",
  countries: ["CZ"],
  isAvailable: robotsOptInPresent,

  async *list(ctx) {
    const { query, city, deepSearch, country } = ctx.request;
    const { region, iso3 } = COUNTRY_CODES[country];
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;

    for (let page = 0; page < maxPages; page++) {
      const data = await fetchJson<NfjSearchResponse>(searchUrl(region, page), {
        method: "POST",
        body: JSON.stringify({ rawSearch: city ? `${query} ${city}` : query }),
        signal: ctx.signal,
      });
      const postings = data.postings ?? [];
      if (postings.length === 0) return;

      const listings: Listing[] = [];
      for (const posting of postings) {
        if (!posting.url || !posting.title || !isInCountry(posting, region, iso3)) continue;
        listings.push({
          url: `${BASE}/${region}/job/${posting.url}`,
          title: posting.title,
          company: posting.name,
          location: describeLocation(posting, iso3),
          salary: formatSalary(posting.salary),
          workType: posting.fullyRemote ? REMOTE : undefined,
          postedAt: posting.posted ? new Date(posting.posted) : undefined,
        });
      }
      ctx.log(`page ${page + 1}: ${listings.length}/${postings.length} postings in ${country}`);
      yield listings;
      if (postings.length < PAGE_SIZE) return;
    }
  },

  async detail(listing, ctx): Promise<RawJob | null> {
    const postingId = listing.url.split("/").pop();
    if (!postingId) return null;
    const detail = await fetchJson<NfjPostingDetail>(`${BASE}/api/posting/${postingId}`, { signal: ctx.signal });
    return {
      title: listing.title,
      company: listing.company ?? "",
      location: listing.location,
      description: postingDescription(detail),
      url: listing.url,
      source: "NOFLUFFJOBS",
      salary: listing.salary,
      workType: listing.workType,
      postedAt: listing.postedAt,
    };
  },
};
