import type { JobSource as JobSourceEnum } from "@prisma/client";
import type { QueryIntent } from "@/lib/queryIntent";

export type CountryCode = "CZ";

export const DEFAULT_COUNTRY: CountryCode = "CZ";

export const COUNTRY_NAMES: Record<CountryCode, string> = { CZ: "Czech Republic" };

export const isSupportedCountry = (code: string): code is CountryCode => Object.hasOwn(COUNTRY_NAMES, code);

export interface SearchRequest {
  query: string;
  skillLevel: string;
  deepSearch: boolean;
  city: string;
  country: CountryCode;
  intent: QueryIntent;
  salaryMin: number | null;
  salaryMax: number | null;
}

export interface RawJob {
  title: string;
  company: string;
  location?: string;
  description: string;
  url: string;
  source: JobSourceEnum;
  salary?: string;
  workType?: string;
  postedAt?: Date;
}

export interface Listing {
  url: string;
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  workType?: string;
  postedAt?: Date;
  job?: RawJob;
}

export interface FetchContext {
  request: SearchRequest;
  signal?: AbortSignal;
  log: (message: string) => void;
}

export interface JobSource {
  id: string;
  label: string;
  source: JobSourceEnum;
  countries: CountryCode[];
  isAvailable?: () => boolean;
  list(ctx: FetchContext): AsyncIterable<Listing[]>;
  detail?(listing: Listing, ctx: FetchContext): Promise<RawJob | null>;
}

const SENIORITY_SLUGS: Record<string, string> = {
  Junior: "junior",
  Mid: "medior",
  Senior: "senior",
  Lead: "lead",
};

export function senioritySlug(skillLevel: string): string | undefined {
  return SENIORITY_SLUGS[skillLevel];
}
