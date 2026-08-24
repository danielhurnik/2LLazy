/**
 * Jobicy — free JSON API of worldwide remote jobs, no key required.
 *
 * Jobicy is the only free feed with a usable geography filter, so the user's
 * country is mapped onto the closest supported `geo` bucket. A deep search
 * additionally re-queries `anywhere` to widen the pool.
 */
import { z } from "zod";
import { fetchJson } from "../fetcher";
import type { BoardDefinition, CountryCode, ScrapeQuery, ScrapedJob } from "../types";
import { WORLDWIDE } from "../types";
import {
  capJobs,
  createWarner,
  dedupeByUrl,
  delay,
  formatSalaryRange,
  htmlToText,
  isRecord,
  looseNumeric,
  looseString,
  PAGE_DELAY_MS,
  resolveCountry,
  sortByLocationPreference,
  str,
  toDate,
} from "./shared";

const ENDPOINT = "https://jobicy.com/api/v2/remote-jobs";
const BOARD_ID = "jobicy";

/** The only `geo` values the API accepts. */
const GEOS = [
  "usa", "canada", "uk", "europe", "emea", "apac", "latam", "australia", "germany",
  "france", "india", "singapore", "philippines", "anywhere",
] as const;
type JobicyGeo = (typeof GEOS)[number];

/** Countries with a dedicated bucket; everything else falls back to a region. */
const GEO_BY_COUNTRY: Record<string, JobicyGeo> = {
  US: "usa", CA: "canada", GB: "uk", AU: "australia", DE: "germany", FR: "france",
  IN: "india", SG: "singapore", PH: "philippines",
};

const GEO_BY_REGION: Record<JobicyGeo, string[]> = {
  europe: [
    "AT", "BE", "BG", "CH", "CY", "CZ", "DK", "EE", "ES", "FI", "GR", "HR", "HU", "IE",
    "IS", "IT", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI",
    "SK", "UA",
  ],
  emea: ["AE", "EG", "IL", "MA", "NG", "SA", "TR", "ZA"],
  apac: ["CN", "HK", "ID", "JP", "KR", "MY", "NZ", "TH", "TW", "VN"],
  latam: ["AR", "BR", "CL", "CO", "CR", "EC", "MX", "PE", "UY", "VE"],
  usa: [], canada: [], uk: [], australia: [], germany: [], france: [], india: [],
  singapore: [], philippines: [], anywhere: [],
};

/** Jobicy industry slugs we are confident about; anything else omits the filter. */
const INDUSTRY_BY_CATEGORY: Record<string, string> = {
  Frontend: "dev", Backend: "dev", Fullstack: "dev", Mobile: "dev", DevOps: "dev",
  Data: "dev", QA: "dev", Security: "dev", Design: "design-multimedia",
  Product: "management",
};

/** Maps an ISO country onto the closest Jobicy geography, defaulting worldwide. */
export function geoForCountry(country: CountryCode): JobicyGeo {
  const code = (country || "").toUpperCase();
  const direct = GEO_BY_COUNTRY[code];
  if (direct) return direct;
  for (const [geo, members] of Object.entries(GEO_BY_REGION)) {
    if (members.includes(code)) return geo as JobicyGeo;
  }
  return "anywhere";
}

export function buildJobicyUrl(q: ScrapeQuery, geo: JobicyGeo): string {
  const params = new URLSearchParams({ count: "50", geo });
  const industry = INDUSTRY_BY_CATEGORY[q.intent?.category ?? ""];
  if (industry) params.set("industry", industry);
  const tag = q.intent?.scrapingKeyword || q.query;
  if (tag) params.set("tag", tag);
  return `${ENDPOINT}?${params.toString()}`;
}

const jobSchema = z.object({
  jobTitle: z.string().min(1),
  companyName: looseString,
  jobGeo: looseString,
  jobLevel: looseString,
  jobExcerpt: looseString,
  jobDescription: looseString,
  url: z.string().min(1),
  pubDate: looseString,
  annualSalaryMin: looseNumeric,
  annualSalaryMax: looseNumeric,
  salaryCurrency: looseString,
});

function mapPayload(payload: unknown): ScrapedJob[] | null {
  if (!isRecord(payload)) return null;
  // An empty result set legitimately omits `jobs`, so treat that as "no jobs".
  if (payload.jobs === undefined) return [];
  if (!Array.isArray(payload.jobs)) return null;

  const jobs: ScrapedJob[] = [];
  for (const item of payload.jobs) {
    const parsed = jobSchema.safeParse(item);
    if (!parsed.success) continue;
    const raw = parsed.data;

    const location = str(raw.jobGeo) || "Anywhere";
    const description = htmlToText(raw.jobDescription) || htmlToText(raw.jobExcerpt);
    jobs.push({
      title: str(raw.jobTitle),
      company: str(raw.companyName) || "Unknown",
      location,
      description,
      sourceUrl: str(raw.url),
      source: "JOBICY",
      salary: formatSalaryRange(
        raw.annualSalaryMin,
        raw.annualSalaryMax,
        str(raw.salaryCurrency) || "USD",
        "year",
      ),
      workType: "Remote",
      postedAt: toDate(raw.pubDate),
      country: resolveCountry(location),
    });
  }
  return jobs;
}

async function scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
  const warn = createWarner(BOARD_ID);
  const geo = geoForCountry(q.country);
  // A deep search adds the worldwide bucket, which carries roles the geo-scoped
  // query filters out.
  const geos: JobicyGeo[] = q.deepSearch && geo !== "anywhere" ? [geo, "anywhere"] : [geo];

  const jobs: ScrapedJob[] = [];
  for (const [index, target] of geos.entries()) {
    if (q.signal?.aborted) break;
    const url = buildJobicyUrl(q, target);

    let payload: unknown;
    try {
      payload = await fetchJson<unknown>(url, { signal: q.signal });
    } catch (err) {
      warn(`fetch failed for ${url}`, err);
      break;
    }

    const mapped = mapPayload(payload);
    if (mapped === null) {
      warn(`unexpected payload shape from ${url}`);
      break;
    }
    jobs.push(...mapped);
    if (index < geos.length - 1) await delay(PAGE_DELAY_MS, q.signal);
  }

  return capJobs(sortByLocationPreference(dedupeByUrl(jobs), q));
}

export const jobicyBoard: BoardDefinition = {
  id: BOARD_ID,
  name: "Jobicy",
  source: "JOBICY",
  homepage: "https://jobicy.com",
  countries: [WORLDWIDE],
  remoteOnly: true,
  requiresBrowser: false,
  note: "free JSON API, no key required — remote roles with a regional filter",
  scrape,
};
