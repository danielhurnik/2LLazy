import { configuredRobotsAllow } from "../config";
import { fetchJson, htmlToText } from "../http";
import { titleMatches } from "./match";
import type { CountryCode, JobSource, Listing, RawJob } from "./types";

const HOST = "nofluffjobs.com";
const BASE = `https://${HOST}`;
const PAGE_SIZE = 40;
const QUICK_SEARCH_PAGES = 1;
const DEEP_SEARCH_PAGES = 4;
const MAX_LISTINGS_PER_SEARCH = 60;
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
  const optIns = [...configuredRobotsAllow(), process.env.ROBOTS_ALLOW ?? ""];
  return optIns.some((entry) => entry.toLowerCase().includes(HOST));
}

function searchUrl(region: string, page: number): string {
  const params = new URLSearchParams({
    pageTo: String(page + 1),
    pageSize: String(PAGE_SIZE),
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
  const parts = Array.from(new Set(localCities)).slice(0, MAX_LISTED_CITIES);
  if (isFullyRemote(posting)) {
    const abroad = Array.from(new Set(places.flatMap((place) => (place.country?.code && place.country.code !== iso3 ? [place.country.code] : []))));
    parts.push(localCities.length === 0 && abroad.length ? `${REMOTE} (${abroad.join(", ")})` : REMOTE);
  }
  return parts.join(", ");
}

function isFullyRemote(posting: NfjPosting): boolean {
  return posting.fullyRemote === true || (posting.location?.places ?? []).some((place) => place.city?.toLowerCase() === REMOTE.toLowerCase());
}

function isInCountryOrRemote(posting: NfjPosting, region: string, iso3: string): boolean {
  if (posting.regions?.includes(region)) return true;
  if ((posting.location?.places ?? []).some((place) => place.country?.code === iso3)) return true;
  return isFullyRemote(posting);
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
    const { query, deepSearch, country } = ctx.request;
    const { region, iso3 } = COUNTRY_CODES[country];
    const maxPages = deepSearch ? DEEP_SEARCH_PAGES : QUICK_SEARCH_PAGES;
    const seenUrls = new Set<string>();
    const seenJobs = new Set<string>();
    let listed = 0;

    for (let page = 0; page < maxPages && listed < MAX_LISTINGS_PER_SEARCH; page++) {
      const data = await fetchJson<NfjSearchResponse>(searchUrl(region, page), {
        method: "POST",
        body: JSON.stringify({ rawSearch: query }),
        signal: ctx.signal,
      });
      const postings = data.postings ?? [];
      if (postings.length === 0) return;

      const listings: Listing[] = [];
      for (const posting of postings) {
        if (!posting.url || !posting.title || seenUrls.has(posting.url)) continue;
        const jobKey = `${posting.name ?? ""}|${posting.title}`.toLowerCase();
        if (seenJobs.has(jobKey)) continue;
        if (!isInCountryOrRemote(posting, region, iso3) || !titleMatches(posting.title, ctx.request)) continue;
        if (listed >= MAX_LISTINGS_PER_SEARCH) break;
        seenUrls.add(posting.url);
        seenJobs.add(jobKey);
        listed++;
        listings.push({
          url: `${BASE}/${region}/job/${posting.url}`,
          title: posting.title,
          company: posting.name,
          location: describeLocation(posting, iso3),
          salary: formatSalary(posting.salary),
          workType: isFullyRemote(posting) ? REMOTE : undefined,
          postedAt: posting.posted ? new Date(posting.posted) : undefined,
        });
      }
      ctx.log(`page ${page + 1}: ${listings.length}/${postings.length} postings in ${country} or fully remote, matching the title`);
      if (listings.length === 0 && seenUrls.size > 0) return;
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
