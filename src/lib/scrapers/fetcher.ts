/**
 * Plain HTTP fetching for job boards.
 *
 * Returns the raw HTML alongside the extracted text and links: deterministic
 * extraction reads structured data (JSON-LD, microdata, meta tags) straight
 * out of the markup, so the HTML must survive the fetch.
 */
import * as cheerio from "cheerio";
// undici is Node.js's built-in fetch engine — lets us control TCP connect timeout
import { Agent } from "undici";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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
}

async function fetchWithRetry(
  url: string,
  opts: FetchOptions = {},
  delayMs = 1500,
): Promise<Response> {
  const retries = opts.retries ?? 3;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": opts.acceptLanguage ?? "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          ...opts.headers,
        },
        redirect: "follow",
        signal: opts.signal,
        // @ts-expect-error undici dispatcher not in fetch type definitions
        dispatcher: agent,
      });
      if (res.ok) return res;
      if (res.status === 429 && attempt < retries) {
        await sleep(delayMs * attempt * 2, opts.signal);
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      // An aborted request is a deliberate cancellation — never retry it.
      if (opts.signal?.aborted) throw err;
      const isLast = attempt === retries;
      if (isLast) {
        if (err instanceof Error) throw err;
        throw new Error(`Fetch failed for ${url}: ${String(err)}`);
      }
      await sleep(delayMs * attempt, opts.signal);
    }
  }
  throw new Error(`fetchPage: all retries exhausted for ${url}`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
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
 * Fetch a page with a plain GET. For JS-rendered sites use `pwFetch` from
 * `./playwright-browser`, which falls back here when the browser is disabled.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  return rawFetch(url, opts);
}
