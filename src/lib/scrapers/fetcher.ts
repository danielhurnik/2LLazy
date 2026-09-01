/**
 * Plain HTTP fetching for job boards.
 *
 * Returns the raw HTML alongside the extracted text and links: deterministic
 * extraction reads structured data (JSON-LD, microdata, meta tags) straight
 * out of the markup, so the HTML must survive the fetch.
 *
 * Every request goes through the pacing layer in `./http/limiter`, which caps
 * the rate and concurrency per host and backs off when a board says 429. That
 * is deliberately not optional: a caller that could bypass it would eventually
 * be the caller that gets the project blocked.
 */
import * as cheerio from "cheerio";
// undici is Node.js's built-in fetch engine — lets us control TCP connect timeout
import { Agent } from "undici";
import { hostOf, penaliseHost, rewardHost, withHostLimit } from "./http/limiter";
import {
  conditionalHeaders,
  validatorsFrom,
  NO_STORE,
  type ConditionalStore,
} from "./http/cache";

/**
 * Identifies the crawler honestly and points at the project, so an operator
 * who wants to talk to us or block us can. Pretending to be Chrome invites
 * exactly the bot-detection arms race this codebase is trying to avoid.
 */
const USER_AGENT =
  "2LLazy/1.0 (open-source job search; +https://github.com/danielhurnik/2LLazy)";

/** Overall deadline per request, so a hung response cannot stall a whole run. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Statuses that mean "you are going too fast", as opposed to a hard failure. */
const THROTTLE_STATUSES = new Set([429, 503]);

/**
 * A response that will not change on a retry — a 404 employer slug, a 403,
 * a 401. Retrying one only re-asks a question the server already answered,
 * and with backoff sleeps in between it triples the cost of every dead URL.
 */
class PermanentHttpError extends Error {}

/** Store used for conditional requests. Swapped by the ingest script. */
let conditionalStore: ConditionalStore = NO_STORE;

export function setConditionalStore(store: ConditionalStore): void {
  conditionalStore = store;
}

/**
 * Counters for one run.
 *
 * Boards fail soft by design — a dead board returns `[]` and warns — which
 * means a run against a broken network, or a board that changed its API, looks
 * exactly like a run that legitimately found nothing. These totals are how the
 * ingest script tells the difference and says so in its summary.
 */
export interface FetchStats {
  requests: number;
  failures: number;
  throttled: number;
  notModified: number;
}

const stats: FetchStats = { requests: 0, failures: 0, throttled: 0, notModified: 0 };

export function getFetchStats(): FetchStats {
  return { ...stats };
}

export function resetFetchStats(): void {
  stats.requests = 0;
  stats.failures = 0;
  stats.throttled = 0;
  stats.notModified = 0;
}

/**
 * Counts a browser navigation in the same run totals, so requests made through
 * Playwright are not invisible to the ingest summary.
 */
export function recordBrowserRequest(status: number): void {
  stats.requests++;
  if (THROTTLE_STATUSES.has(status)) stats.throttled++;
  else if (status >= 400) stats.failures++;
}

/** A fetched page in every form the extraction layer needs. */
export interface FetchedPage {
  /** Final URL after redirects. */
  url: string;
  /** Raw markup, or the raw body for non-HTML responses. */
  html: string;
  /** Visible text with chrome (script/style/nav/footer) stripped. */
  text: string;
  /** Every absolute http(s) link on the page, with its anchor text. */
  links: Array<{ text: string; url: string }>;
  status: number;
}

// Custom agent with 30s TCP connect timeout (undici default is 10s)
const agent = new Agent({ connect: { timeout: 30_000 } });

export interface FetchOptions {
  signal?: AbortSignal;
  /** Extra request headers, merged over the defaults. */
  headers?: Record<string, string>;
  retries?: number;
  /** Preferred content language, e.g. `"cs,en-US,en;q=0.9"`. */
  acceptLanguage?: string;
  /** Send `If-None-Match` / `If-Modified-Since` from the store. */
  conditional?: boolean;
  /** Overall deadline for this request, including retries. */
  timeoutMs?: number;
}

/** Combines the caller's signal with our own per-request deadline. */
function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchWithRetry(
  url: string,
  opts: FetchOptions = {},
  delayMs = 1500,
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const host = hostOf(url);
  const cached = opts.conditional ? await conditionalStore.get(url) : null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    stats.requests++;
    try {
      const res = await withHostLimit(
        url,
        () =>
          fetch(url, {
            headers: {
              "User-Agent": USER_AGENT,
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": opts.acceptLanguage ?? "en-US,en;q=0.9",
              ...conditionalHeaders(cached),
              ...opts.headers,
            },
            redirect: "follow",
            signal: withDeadline(opts.signal, opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
            // @ts-expect-error undici dispatcher not in fetch type definitions
            dispatcher: agent,
          }),
        opts.signal,
      );

      // 304: the board confirmed nothing changed. Replay the stored body so
      // callers never notice, and treat it as a successful, nearly free read.
      if (res.status === 304 && cached?.body != null) {
        stats.notModified++;
        rewardHost(host);
        return new Response(cached.body, {
          status: 200,
          headers: { "content-type": res.headers.get("content-type") ?? "text/html" },
        });
      }

      if (res.ok) {
        rewardHost(host);
        if (opts.conditional) {
          const body = await res.clone().text();
          await conditionalStore.set(url, {
            ...validatorsFrom(res),
            fetchedAt: new Date(),
            body,
          });
        }
        return res;
      }

      // Being throttled is not a failure to retry through — it is an
      // instruction. Pause the whole host for as long as it asked.
      if (THROTTLE_STATUSES.has(res.status)) {
        stats.throttled++;
        const waitMs = penaliseHost(host, res.headers.get("retry-after"));
        if (attempt < retries) {
          await sleep(waitMs, opts.signal);
          continue;
        }
        throw new Error(`HTTP ${res.status} for ${url} (rate limited, gave up after ${retries} attempts)`);
      }

      // A client error other than throttling (handled above) or a request
      // timeout is permanent: the server has answered, retrying changes nothing.
      if (res.status >= 400 && res.status < 500 && res.status !== 408) {
        throw new PermanentHttpError(`HTTP ${res.status} for ${url}`);
      }

      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      // An aborted request is a deliberate cancellation — never retry it.
      if (opts.signal?.aborted) throw err;
      if (err instanceof PermanentHttpError) {
        stats.failures++;
        throw err;
      }
      const isLast = attempt === retries;
      if (isLast) {
        stats.failures++;
        if (err instanceof Error) throw err;
        throw new Error(`Fetch failed for ${url}: ${String(err)}`);
      }
      await sleep(delayMs * attempt, opts.signal);
    }
  }
  throw new Error(`fetchPage: all retries exhausted for ${url}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise((resolve, reject) => {
    // Removed again on normal completion — a shared ingest signal would
    // otherwise accumulate one dead listener per retry sleep for a whole run.
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason ?? new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Split loaded markup into the text + links shape every caller expects. */
export function parseDocument(html: string, url: string): Omit<FetchedPage, "status"> {
  const $ = cheerio.load(html);

  const base = new URL(url);
  const links: Array<{ text: string; url: string }> = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const linkText = $(el).text().trim();
    try {
      const resolved = new URL(href, base).href;
      if (resolved.startsWith("http")) links.push({ text: linkText, url: resolved });
    } catch {
      // ignore unparseable hrefs
    }
  });

  // Strip chrome only for the text view — `html` keeps the original markup so
  // JSON-LD in <script> tags stays available to the extractor.
  const $text = cheerio.load(html);
  $text("script, style, nav, footer, header, noscript, svg").remove();
  const text = $text("body").text().replace(/\s+/g, " ").trim();

  return { url, html, text, links };
}

/**
 * Fetches a URL with a plain HTTP GET (no JavaScript execution).
 * Retries up to 3 times with a 30s connect timeout.
 */
export async function rawFetch(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const res = await fetchWithRetry(url, opts);
  const html = await res.text();
  return { ...parseDocument(html, res.url || url), status: res.status };
}

/** Fetches and parses JSON from a board API. Throws on a non-2xx response. */
export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchWithRetry(url, {
    ...opts,
    headers: { Accept: "application/json, text/plain, */*", ...opts.headers },
  });
  return (await res.json()) as T;
}

/** Fetches a URL and returns the body as text without HTML parsing (RSS, CSV…). */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  return res.text();
}

/**
 * Fetches XML — sitemaps and feeds. Conditional by default: these are the
 * documents a scraper re-reads most often, so a 304 here is the cheapest
 * request the whole pipeline makes.
 */
export async function fetchXml(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchWithRetry(url, {
    conditional: true,
    ...opts,
    headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8", ...opts.headers },
  });
  return res.text();
}

/** POSTs JSON to a board's own API and parses the reply. */
export async function postJson<T>(
  url: string,
  body: unknown,
  opts: FetchOptions = {},
): Promise<T> {
  const res = await withHostLimit(
    url,
    () =>
      fetch(url, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...opts.headers,
        },
        body: JSON.stringify(body),
        signal: withDeadline(opts.signal, opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
        // @ts-expect-error undici dispatcher not in fetch type definitions
        dispatcher: agent,
      }),
    opts.signal,
  );

  if (res.status === 429 || res.status === 503) {
    const waitMs = penaliseHost(hostOf(url), res.headers.get("retry-after"));
    throw new Error(`HTTP ${res.status} for ${url} (rate limited; back off ${Math.round(waitMs / 1000)}s)`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  rewardHost(hostOf(url));
  return (await res.json()) as T;
}

/**
 * Fetch a page with a plain GET. For JS-rendered sites use `pwFetch` from
 * `./playwright-browser`, which falls back here when the browser is disabled.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  return rawFetch(url, opts);
}
