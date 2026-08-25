/**
 * Applicant-tracking-system job boards.
 *
 * The highest-leverage source in the whole project. Every major ATS publishes
 * the job board of each customer as public, unauthenticated JSON — that is how
 * a company's own careers page is rendered, and how their jobs get syndicated,
 * so it is meant to be read. One adapter per ATS therefore unlocks not one
 * board but every employer using it.
 *
 * It also reaches postings the aggregators often miss: a company's Greenhouse
 * board has the role the day it opens, before it is cross-posted anywhere.
 *
 * The trade-off is that these APIs cannot be searched — you have to know which
 * employers to ask. That list lives in `employers.ts` and is the easiest
 * high-value contribution anyone can make to this repo.
 */
import type { CountryCode } from "../../types";

export type AtsPlatform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "recruitee"
  | "workable";

export interface Employer {
  /** The employer's board slug on that ATS, from their careers-page URL. */
  slug: string;
  /** Display name, used as the company on every posting it yields. */
  name: string;
  ats: AtsPlatform;
  /**
   * Countries this employer actually hires in. Drives board selection, so a
   * user in Brazil is not made to wait on a Czech-only employer.
   */
  countries: CountryCode[];
  /** True when they hire remotely beyond `countries`. */
  remote?: boolean;
}

/** One posting as returned by an ATS, before it becomes a `ScrapedJob`. */
export interface AtsPosting {
  title: string;
  location: string;
  description: string;
  url: string;
  postedAt?: Date;
  salary?: string;
  remote?: boolean;
  employmentType?: string;
  department?: string;
}

/** What an adapter must implement for one ATS. */
export interface AtsAdapter {
  platform: AtsPlatform;
  displayName: string;
  homepage: string;
  /** Fetches every published posting for one employer. Never throws. */
  fetchPostings(employer: Employer, signal?: AbortSignal): Promise<AtsPosting[]>;
}
