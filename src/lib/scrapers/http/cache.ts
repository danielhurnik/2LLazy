/**
 * Conditional-request bookkeeping.
 *
 * A scrape re-reads the same listing and detail pages constantly. Sending the
 * `ETag` or `Last-Modified` we were given last time turns most of those into a
 * 304 with an empty body: near-zero cost for the board, near-zero bandwidth for
 * us, and — the reason this module exists — far fewer requests that count
 * against a rate limit. Boards notice the difference, and a well-behaved
 * crawler gets throttled a great deal less than a greedy one.
 *
 * The store is an interface so the same fetch code works in three places: the
 * long-running ingest script (Postgres-backed, survives restarts), unit tests
 * (in-memory), and a plain library call with no store at all.
 */

export interface CacheEntry {
  etag: string | null;
  lastModified: string | null;
  /** When we last got a 200 for this URL. */
  fetchedAt: Date;
  /** Body of the last successful response, replayed on a 304. */
  body: string | null;
}

export interface ConditionalStore {
  get(url: string): Promise<CacheEntry | null>;
  set(url: string, entry: CacheEntry): Promise<void>;
}

/** Default store: remembers nothing, so every request is unconditional. */
export const NO_STORE: ConditionalStore = {
  async get() {
    return null;
  },
  async set() {
    /* deliberately empty */
  },
};

/** Process-lifetime store. Enough for one ingest run or a test. */
export function createMemoryStore(): ConditionalStore {
  const entries = new Map<string, CacheEntry>();
  return {
    async get(url) {
      return entries.get(url) ?? null;
    },
    async set(url, entry) {
      entries.set(url, entry);
    },
  };
}

/** Request headers that ask the server "only send it if it changed". */
export function conditionalHeaders(entry: CacheEntry | null): Record<string, string> {
  if (!entry) return {};
  const headers: Record<string, string> = {};
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;
  return headers;
}

/** Pulls the validators out of a 200 so the next request can be conditional. */
export function validatorsFrom(response: Response): Pick<CacheEntry, "etag" | "lastModified"> {
  return {
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}

/**
 * True when a cached body is fresh enough to use without asking at all.
 *
 * Used by the ingest script to skip URLs it read minutes ago — a re-run after
 * a crash should not re-fetch everything it already has.
 */
export function isFresh(entry: CacheEntry | null, maxAgeMs: number): boolean {
  if (!entry?.body) return false;
  return Date.now() - entry.fetchedAt.getTime() < maxAgeMs;
}
