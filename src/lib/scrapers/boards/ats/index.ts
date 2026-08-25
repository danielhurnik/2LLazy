/**
 * One `BoardDefinition` per applicant-tracking system.
 *
 * Each walks the employers registered on that ATS and turns their public job
 * boards into `ScrapedJob`s. There is no search endpoint on any of them, so a
 * live query filters client-side after fetching — cheap, because the response
 * is one JSON document per employer rather than a page per posting.
 *
 * These are the highest-quality postings in the app: straight from the
 * employer, with no aggregator's reformatting, usually the day the role opens.
 */
import { WORLDWIDE, type BoardDefinition, type IngestContext, type ScrapedJob, type ScrapeQuery } from "../../types";
import { capJobs, dedupeByUrl, matchesQuery, resolveCountry, sortByLocationPreference, workTypeFromText, MAX_DESCRIPTION_CHARS } from "../shared";
import { ATS_ADAPTERS } from "./adapters";
import { employersForCountry, employersOn } from "./employers";
import type { AtsAdapter, AtsPosting, Employer } from "./types";

/** Employers contacted per run, so one board cannot dominate a search. */
const MAX_EMPLOYERS_PER_RUN = 40;

function toScrapedJob(
  posting: AtsPosting,
  employer: Employer,
  adapter: AtsAdapter,
  fallbackCountry: string,
): ScrapedJob {
  const country =
    resolveCountry(posting.location) ??
    (employer.countries.length === 1 ? employer.countries[0] : undefined) ??
    (posting.remote ? undefined : fallbackCountry);

  return {
    title: posting.title,
    company: employer.name,
    location: posting.location || (posting.remote ? "Remote" : ""),
    description: (posting.description || posting.title).slice(0, MAX_DESCRIPTION_CHARS),
    sourceUrl: posting.url,
    source: adapter.platform.toUpperCase(),
    salary: posting.salary,
    workType: posting.remote
      ? "Remote"
      : workTypeFromText(posting.location, posting.employmentType, posting.description),
    postedAt: posting.postedAt,
    country,
  };
}

/** Fetches a set of employers with bounded parallelism. */
async function collect(
  adapter: AtsAdapter,
  employers: Employer[],
  fallbackCountry: string,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];
  const batchSize = 4;

  for (let i = 0; i < employers.length; i += batchSize) {
    if (signal?.aborted) break;
    const batch = employers.slice(i, i + batchSize);

    const settled = await Promise.allSettled(
      batch.map(async (employer) => {
        const postings = await adapter.fetchPostings(employer, signal);
        return postings.map((posting) => toScrapedJob(posting, employer, adapter, fallbackCountry));
      }),
    );

    for (const result of settled) {
      if (result.status === "fulfilled") jobs.push(...result.value);
    }
    onProgress?.(`${adapter.displayName}: ${jobs.length} postings from ${Math.min(i + batchSize, employers.length)}/${employers.length} employers`);
  }

  return dedupeByUrl(jobs);
}

function buildBoard(adapter: AtsAdapter): BoardDefinition {
  const registered = employersOn(adapter.platform);

  return {
    id: `ats-${adapter.platform}`,
    name: `${adapter.displayName} boards`,
    source: adapter.platform.toUpperCase(),
    homepage: adapter.homepage,
    // Employer boards are worldwide by nature; which of them apply to a given
    // country is decided per employer, not per board.
    countries: [WORLDWIDE],
    remoteOnly: false,
    requiresBrowser: false,
    supportsLiveSearch: true,
    note: `${registered.length} employers hiring directly — public API, no key required`,

    async scrape(q: ScrapeQuery): Promise<ScrapedJob[]> {
      const employers = employersForCountry(q.country)
        .filter((employer) => employer.ats === adapter.platform)
        .slice(0, MAX_EMPLOYERS_PER_RUN);
      if (employers.length === 0) return [];

      const jobs = await collect(adapter, employers, q.country, q.signal);
      // These APIs cannot be searched, so filter here. Permissive on purpose —
      // the lexical ranker does the real work downstream.
      const relevant = jobs.filter((job) => matchesQuery(`${job.title} ${job.description}`, q));
      return capJobs(sortByLocationPreference(relevant, q));
    },

    async *ingest(ctx: IngestContext): AsyncGenerator<ScrapedJob> {
      const employers = employersForCountry(ctx.country).filter(
        (employer) => employer.ats === adapter.platform,
      );
      if (employers.length === 0) return;

      const jobs = await collect(adapter, employers, ctx.country, ctx.signal, ctx.onProgress);

      let yielded = 0;
      for (const job of jobs) {
        if (ctx.signal?.aborted || yielded >= ctx.limit) return;
        // These boards publish no changed-since filter, so incremental runs
        // lean on the posting date the ATS does give us.
        if (ctx.since && job.postedAt && job.postedAt < ctx.since) continue;
        yielded++;
        yield job;
      }
    },
  };
}

/** A board per ATS, ready for the registry. */
export const ATS_BOARDS: BoardDefinition[] = ATS_ADAPTERS.map(buildBoard);

export { ATS_ADAPTERS, adapterFor } from "./adapters";
export { EMPLOYERS, employersForCountry, employersOn, employerCountries } from "./employers";
export type { AtsAdapter, AtsPlatform, AtsPosting, Employer } from "./types";
