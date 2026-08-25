/**
 * Shared scraper contracts.
 *
 * Everything here is deterministic and provider-neutral: no model calls, no
 * embeddings, no API keys required by the core pipeline. A board is a plain
 * function from a `ScrapeQuery` to `ScrapedJob[]`, described by metadata the
 * registry uses to decide whether the board applies to the searching user.
 */

/** ISO 3166-1 alpha-2 country code, uppercase. `"*"` means worldwide. */
export type CountryCode = string;

/** Worldwide marker used by remote-only boards in `BoardDefinition.countries`. */
export const WORLDWIDE = "*" as const;

/** How a role is performed. Empty string means "unknown". */
export type WorkType = "Remote" | "Hybrid" | "Onsite" | "";

/**
 * A job as returned by a board scraper, before it is persisted.
 *
 * `source` is a free-form uppercase board id (e.g. `"REMOTIVE"`) rather than a
 * database enum, so adding a board never requires a schema migration.
 */
export interface ScrapedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  source: string;
  salary?: string;
  workType?: WorkType;
  postedAt?: Date;
  /** ISO 3166-1 alpha-2 country this posting belongs to, when known. */
  country?: CountryCode;
}

/** Seniority buckets understood by the matcher and by board URL builders. */
export type Seniority = "Junior" | "Mid" | "Senior" | "Lead";

/**
 * Everything a board needs to run one search. Boards must treat every field as
 * advisory: a board that cannot filter by city should still return results.
 */
export interface ScrapeQuery {
  /** Raw user query, e.g. `"react"`. Never empty. */
  query: string;
  /** Normalised seniority, or `null` when the user chose "Any". */
  seniority: Seniority | null;
  /** City filter; empty string when unset. */
  city: string;
  /** ISO 3166-1 alpha-2 country the search targets. */
  country: CountryCode;
  /** Fetch more pages per board. */
  deepSearch: boolean;
  /** Restrict to remote roles. */
  remoteOnly: boolean;
  /** Structured, deterministic intent derived from `query` + `seniority`. */
  intent: QueryIntent;
  /** Cancels in-flight fetches when the client disconnects. */
  signal?: AbortSignal;
}

export type ScrapeFn = (q: ScrapeQuery) => Promise<ScrapedJob[]>;

/**
 * Bulk ingestion context. Unlike a live search this has no user query and no
 * deadline: it walks everything a board publishes, newest first, and yields as
 * it goes so the caller can persist incrementally and resume after a crash.
 */
export interface IngestContext {
  /** Country this run is collecting for. */
  country: CountryCode;
  /** Skip postings the board says have not changed since this. */
  since: Date | null;
  /** Stop after this many postings. */
  limit: number;
  signal?: AbortSignal;
  /** Called for progress reporting; never for control flow. */
  onProgress?: (message: string) => void;
}

/**
 * Walks a board in bulk. Yields postings one at a time so a long run can be
 * checkpointed — an ingest of several thousand jobs must survive being killed.
 */
export type IngestFn = (ctx: IngestContext) => AsyncGenerator<ScrapedJob>;

/**
 * Registry metadata for one job board.
 *
 * `countries` drives board selection: a board listing `["CZ", "SK"]` only runs
 * for users in those countries, while `[WORLDWIDE]` runs for everyone.
 */
export interface BoardDefinition {
  /** Stable lowercase slug, e.g. `"remotive"`. Unique across the registry. */
  id: string;
  /** Human-readable name shown in the UI, e.g. `"Remotive"`. */
  name: string;
  /** Uppercase value written to `JobPosting.source`, e.g. `"REMOTIVE"`. */
  source: string;
  /** Board homepage, shown in the UI. */
  homepage: string;
  /** Countries served, or `[WORLDWIDE]`. */
  countries: CountryCode[];
  /** True when the board lists only remote roles. */
  remoteOnly: boolean;
  /** True when the board needs a real browser (SPA) to return listings. */
  requiresBrowser: boolean;
  /**
   * Environment variables the board needs. When any is missing the registry
   * skips the board instead of letting it fail at request time.
   */
  requiredEnv?: string[];
  /** One-line note surfaced in Settings, e.g. "free API, no key required". */
  note?: string;
  /**
   * Answers a user's query directly, fast enough to run inside a web request.
   * Boards whose listing pages are client-rendered cannot do this without a
   * browser, so they set `supportsLiveSearch: false` and rely on `ingest`.
   */
  scrape: ScrapeFn;
  /**
   * False when the board cannot serve a keyword search without rendering
   * JavaScript. Such boards are skipped by the live search route and collected
   * by the ingest script instead; their postings still reach the user, out of
   * the database.
   */
  supportsLiveSearch?: boolean;
  /**
   * Bulk collection for the ingest script. Present on every board that can be
   * walked without a query — which, via sitemaps, is most of them.
   */
  ingest?: IngestFn;
}

// ─── Query intent (deterministic; see src/lib/matching) ───────────────────────

export type JobCategory =
  | "Frontend"
  | "Backend"
  | "Fullstack"
  | "Mobile"
  | "DevOps"
  | "Data"
  | "QA"
  | "Design"
  | "Security"
  | "Product"
  | "Other";

/** A query term plus how much a match on it is worth. */
export interface WeightedTerm {
  term: string;
  weight: number;
}

/**
 * The structured form of a user's search, produced without any model call.
 * Boards use `scrapingKeyword` for URL building; the ranker uses the term sets.
 */
export interface QueryIntent {
  /** Original user input, trimmed. */
  query: string;
  category: JobCategory;
  seniority: Seniority | null;
  /** Terms that make a posting more relevant, with weights (higher = stronger). */
  terms: WeightedTerm[];
  /** Terms that make a posting less relevant (out-of-domain signals). */
  negativeTerms: string[];
  /** Job-title fragments that should be accepted. */
  includedTitles: string[];
  /** Job-title fragments that should be rejected outright. */
  excludedTitles: string[];
  /** Rich domain description, used for display and as ranking fallback text. */
  canonicalText: string;
  /** Best single keyword for board URL parameters. */
  scrapingKeyword: string;
}
