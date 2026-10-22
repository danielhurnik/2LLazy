import type { JobItem } from "@/types";
import { errorMessage } from "@/lib/guards";
import { batchProcess } from "@/lib/scrapers/utils";
import { MS_PER_DAY } from "@/lib/time";
import { recordFailure, recordSuccess } from "./breaker";
import { canonicalUrl } from "./dedupe";
import { embeddingsFor } from "./embeddings";
import type { Emit } from "./events";
import { normalizeJob, type NormalizedJob } from "./normalize";
import type { SearchProfile } from "./profile";
import { rankWithFeedback, rankingContextFor, type RankingContext } from "./ranking";
import { alsoOnEntries } from "./crossListing";
import type { GroupPosting } from "./crossListing";
import { crossListingsByGroup, crossListingsOf, favouriteIdsFor, findByUrls, searchRecent, upsertJob, type StoredJob } from "./repo";
import { SCORE_THRESHOLD, scoreJob, type ScoreRequest } from "./score";
import type { FetchContext, JobSource, Listing, RawJob, SearchRequest } from "./sources/types";

const SERVE_FROM_DB_WHEN_SCRAPED_WITHIN_MS = MS_PER_DAY;
const MARK_NEW_WHEN_FIRST_SEEN_WITHIN_MS = MS_PER_DAY;
const CACHED_DAYS = 30;
const CACHED_CANDIDATES = 200;
const CACHED_EMIT_LIMIT = 80;
const DETAIL_CONCURRENCY = 4;
const JUDGED_TOP_RESULTS = 10;
const CACHE_SITE = "Cache";

interface RunSearchParams {
  userId: string;
  request: SearchRequest;
  sources: JobSource[];
  emit: Emit;
  signal?: AbortSignal;
}

interface FreshnessSplit {
  freshRows: StoredJob[];
  staleListings: Listing[];
}

interface EmittedJob {
  row: StoredJob;
  score: number;
}

export function storedToNormalized(row: StoredJob, country: SearchRequest["country"]): NormalizedJob {
  const raw: RawJob = {
    title: row.title,
    company: row.company,
    location: row.location ?? undefined,
    description: row.description,
    url: row.sourceUrl,
    source: row.source,
    salary: row.salary ?? undefined,
    workType: row.workType ?? undefined,
    postedAt: row.postedAt ?? undefined,
  };
  return normalizeJob(raw, country);
}

function listingToRaw(listing: Listing, source: JobSource): RawJob {
  return {
    title: listing.title,
    company: listing.company ?? "",
    location: listing.location,
    description: "",
    url: listing.url,
    source: source.source,
    salary: listing.salary,
    workType: listing.workType,
    postedAt: listing.postedAt,
  };
}

function toScoreRequest(
  { query, skillLevel, city, intent, salaryMin, salaryMax }: SearchRequest,
  profile: SearchProfile | null,
): ScoreRequest {
  return { query, skillLevel, city, intent, salaryMin, salaryMax, profile };
}

function withCanonicalUrls(page: Listing[]): Listing[] {
  return page.map((listing) => ({ ...listing, url: canonicalUrl(listing.url) }));
}

function splitByFreshness(listings: Listing[], known: Map<string, StoredJob>): FreshnessSplit {
  const now = Date.now();
  const freshRows: StoredJob[] = [];
  const staleListings: Listing[] = [];
  for (const listing of listings) {
    const row = known.get(listing.url);
    if (row && now - row.scrapedAt.getTime() < SERVE_FROM_DB_WHEN_SCRAPED_WITHIN_MS) freshRows.push(row);
    else staleListings.push(listing);
  }
  return { freshRows, staleListings };
}

async function fetchRawJob(listing: Listing, source: JobSource, ctx: FetchContext): Promise<RawJob | null> {
  if (listing.job) return listing.job;
  return source.detail ? source.detail(listing, ctx) : listingToRaw(listing, source);
}

function sourceContext(source: JobSource, request: SearchRequest, signal?: AbortSignal): FetchContext {
  return { request, signal, log: (message) => console.log(`[search:${source.id}] ${message}`) };
}

async function vectorsWhenRanking(context: RankingContext, rows: StoredJob[]): Promise<Map<string, number[]>> {
  return context.ranker ? embeddingsFor(rows) : new Map();
}

function topEmitted(emitted: EmittedJob[]): StoredJob[] {
  return [...emitted]
    .sort((a, b) => b.score - a.score)
    .slice(0, JUDGED_TOP_RESULTS)
    .map((entry) => entry.row);
}

function learnFromResultsInBackground(userId: string, context: RankingContext, emitted: EmittedJob[]): void {
  if (!context.profile || emitted.length === 0) return;
  void import("./feedback")
    .then(({ judgeAndLearn }) => judgeAndLearn(userId, topEmitted(emitted)))
    .catch((err) => console.warn("[ranker] background learning failed:", errorMessage(err)));
}

export async function runSearch({ userId, request, sources, emit, signal }: RunSearchParams): Promise<void> {
  const [favourites, context] = await Promise.all([favouriteIdsFor(userId), rankingContextFor(userId)]);
  const scoreRequest = toScoreRequest(request, context.profile);
  const isStaleByEmittedId = new Map<string, boolean>();
  const emitted: EmittedJob[] = [];
  const boardLabels = new Map(sources.map((source) => [source.source, source.label]));

  const alreadyEmittedAtLeastAsFresh = (id: string, isStale: boolean): boolean => {
    const emittedAsStale = isStaleByEmittedId.get(id);
    if (emittedAsStale === undefined) return false;
    const isLiveConfirmationOfCachedJob = emittedAsStale && !isStale;
    return !isLiveConfirmationOfCachedJob;
  };

  const toItem = (row: StoredJob, normalized: NormalizedJob, isStale: boolean, vector?: number[]): JobItem | null => {
    const scored = scoreJob(scoreRequest, normalized, row.firstSeenAt);
    if (scored.score < SCORE_THRESHOLD) return null;
    const ranked = rankWithFeedback(context, scored, vector);
    if (ranked.score < SCORE_THRESHOLD) return null;
    return {
      id: row.id,
      title: row.title,
      company: row.company,
      location: row.location ?? normalized.location,
      description: row.description,
      sourceUrl: row.sourceUrl,
      source: row.source,
      salary: row.salary ?? undefined,
      workType: row.workType ?? undefined,
      similarity: ranked.score,
      matchReasons: ranked.reasons,
      favourited: favourites.has(row.id),
      dismissed: context.dismissed.has(row.id),
      isNew: row.firstSeenAt.getTime() > Date.now() - MARK_NEW_WHEN_FIRST_SEEN_WITHIN_MS,
      isStale,
    };
  };

  const emitJob = async (row: StoredJob, normalized: NormalizedJob, isStale: boolean, vector?: number[], groupPostings?: GroupPosting[]): Promise<void> => {
    if (alreadyEmittedAtLeastAsFresh(row.id, isStale)) return;
    const item = toItem(row, normalized, isStale, vector);
    if (!item) return;
    const others = (groupPostings ?? (await crossListingsOf(row))).filter((other) => other.id !== row.id);
    item.alsoOn = alsoOnEntries(row, others, boardLabels);
    isStaleByEmittedId.set(row.id, isStale);
    emitted.push({ row, score: item.similarity ?? 0 });
    await emit({ type: "job", data: item });
  };

  const emitCachedMatches = async (): Promise<void> => {
    await emit({ type: "progress", site: CACHE_SITE, message: "Loading cached results…" });
    const rows = await searchRecent({
      titleTerms: [request.query, request.intent.scrapingKeyword, ...request.intent.includedTitles],
      query: request.query,
      days: CACHED_DAYS,
      limit: CACHED_CANDIDATES,
      country: request.country,
    });
    const vectors = await vectorsWhenRanking(context, rows);
    const ranked = rows
      .map((row) => ({ row, normalized: storedToNormalized(row, request.country) }))
      .map((entry) => ({ ...entry, scored: scoreJob(scoreRequest, entry.normalized, entry.row.firstSeenAt) }))
      .filter((entry) => entry.scored.score >= SCORE_THRESHOLD)
      .map((entry) => ({ ...entry, ranked: rankWithFeedback(context, entry.scored, vectors.get(entry.row.id)) }))
      .sort((a, b) => b.ranked.score - a.ranked.score)
      .slice(0, CACHED_EMIT_LIMIT);
    const groups = await crossListingsByGroup(ranked.map((entry) => entry.row));
    for (const { row, normalized } of ranked) await emitJob(row, normalized, true, vectors.get(row.id), groups.get(row.groupKey ?? "") ?? []);
  };

  const storeAndEmit = async (listing: Listing, source: JobSource, ctx: FetchContext): Promise<true | null> => {
    if (signal?.aborted) return null;
    const raw = await fetchRawJob(listing, source, ctx);
    if (!raw?.title) return null;
    const normalized = normalizeJob({ ...raw, url: listing.url }, request.country);
    if (!normalized.title) return null;
    const stored = await upsertJob(normalized);
    const vectors = await vectorsWhenRanking(context, [stored]);
    await emitJob(stored, normalized, false, vectors.get(stored.id));
    return true;
  };

  const scrapeSource = async (source: JobSource, ctx: FetchContext): Promise<void> => {
    for await (const page of source.list(ctx)) {
      if (signal?.aborted) break;
      const listings = withCanonicalUrls(page);
      const known = await findByUrls(listings.map((listing) => listing.url));
      const { freshRows, staleListings } = splitByFreshness(listings, known);

      const vectors = await vectorsWhenRanking(context, freshRows);
      for (const row of freshRows) await emitJob(row, storedToNormalized(row, request.country), false, vectors.get(row.id));

      if (staleListings.length > 0) {
        await emit({
          type: "progress",
          site: source.label,
          message: `Reading ${staleListings.length} postings from ${source.label}…`,
        });
        await batchProcess(staleListings, DETAIL_CONCURRENCY, (listing) => storeAndEmit(listing, source, ctx));
      }

      const nothingNewBeyondThisPage = staleListings.length === 0 && listings.length > 0;
      if (request.deepSearch && nothingNewBeyondThisPage) break;
    }
  };

  try {
    await emitCachedMatches();
  } catch (err) {
    console.error("[search] cached pass failed:", err);
  }

  let doneCount = 0;
  const total = sources.length;

  await Promise.allSettled(
    sources.map(async (source) => {
      try {
        await emit({ type: "progress", site: source.label, message: `Scraping ${source.label}…` });
        await scrapeSource(source, sourceContext(source, request, signal));
        if (!signal?.aborted) recordSuccess(source.id);
      } catch (err) {
        if (!signal?.aborted) {
          recordFailure(source.id);
          console.error(`[search] ${source.label} failed:`, err);
          await emit({ type: "error", site: source.label, message: errorMessage(err) });
        }
      } finally {
        doneCount++;
        await emit({ type: "scraperDone", site: source.label, doneCount, total });
      }
    }),
  );

  await emit({ type: "scrapersDone", total: isStaleByEmittedId.size });
  await emit({ type: "complete", total: isStaleByEmittedId.size });
  if (!signal?.aborted) learnFromResultsInBackground(userId, context, emitted);
}
