/**
 * Singleton Playwright browser for scraping JS-heavy SPAs.
 *
 * One shared Chromium instance is launched on first use and kept alive for the
 * lifetime of the Node.js process.  Each fetch call opens a new page, blocks
 * unnecessary resources (images / fonts / media / tracking), navigates, waits
 * for the DOM to settle, extracts text + links with Cheerio, then closes the page.
 *
 * Set PLAYWRIGHT_ENABLED=true in .env.local to activate.
 * Falls back gracefully to plain-fetch (rawFetch) when disabled or unavailable.
 */

import type { Browser, Route } from "playwright";
import { parseDocument, rawFetch, recordBrowserRequest, type FetchedPage } from "./fetcher";
import { hostOf, penaliseHost, withHostLimit } from "./http/limiter";

// ── Singleton browser ────────────────────────────────────────────────────────
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ],
  });
  // Clean up on process exit
  process.once("exit", () => browser.close().catch(() => { }));
  process.once("SIGINT", () => browser.close().catch(() => { }));
  return browser;
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

// Warm up the browser in the background on module load so the first scrape
// doesn't pay the 3–5s Chromium cold-start cost.
if (process.env.PLAYWRIGHT_ENABLED === "true") {
  getBrowser().catch(() => { });
}

// ── Blocked resource types & domains ─────────────────────────────────────────
const BLOCKED_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "hotjar.com",
  "segment.io",
  "mixpanel.com",
  "amplitude.com",
  "sentry.io",
  "clarity.ms",
];

// ── Core fetch function ───────────────────────────────────────────────────────
/**
 * Renders a URL with Playwright Chromium, blocks unnecessary resources for
 * speed, waits for the DOM to settle, then returns text + links via Cheerio.
 *
 * Falls back to rawFetch if PLAYWRIGHT_ENABLED is not set.
 */
export interface PwFetchOptions {
  /** CSS selector to wait for before reading the DOM (fast path for SPAs). */
  waitSelector?: string;
  signal?: AbortSignal;
  /** Preferred content language, e.g. `"cs,en-US,en;q=0.9"`. */
  acceptLanguage?: string;
}

/**
 * Renders a URL with Playwright Chromium, blocks unnecessary resources for
 * speed, waits for the DOM to settle, then returns the rendered HTML plus the
 * text and links parsed from it.
 *
 * Falls back to `rawFetch` if PLAYWRIGHT_ENABLED is not set.
 */
export async function pwFetch(
  url: string,
  options: PwFetchOptions | string = {},
): Promise<FetchedPage> {
  // Legacy call sites pass the wait selector positionally.
  const opts: PwFetchOptions = typeof options === "string" ? { waitSelector: options } : options;

  // Read env var dynamically so a server restart isn't needed after adding it to .env.local
  const enabled = process.env.PLAYWRIGHT_ENABLED === "true";
  if (!enabled) {
    return rawFetch(url, { signal: opts.signal, acceptLanguage: opts.acceptLanguage });
  }

  const browser = await getBrowser();
  const page = await browser.newPage();

  const onAbort = () => void page.close().catch(() => { });
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // Block heavy / tracking resources
    await page.route("**/*", (route: Route) => {
      const req = route.request();
      const type = req.resourceType();
      const reqUrl = req.url();
      if (
        BLOCKED_TYPES.has(type) ||
        BLOCKED_DOMAINS.some((d) => reqUrl.includes(d))
      ) {
        route.abort().catch(() => { });
        return;
      }
      route.continue().catch(() => { });
    });

    await page.setExtraHTTPHeaders({
      "Accept-Language": opts.acceptLanguage ?? "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });

    // A rendered navigation is still a request to somebody's server: it goes
    // through the same per-host pacing as every plain fetch, is counted in the
    // run totals, and a throttle response penalises the host like any other.
    const response = await withHostLimit(
      url,
      () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }),
      opts.signal,
    );
    const status = response?.status() ?? 200;
    recordBrowserRequest(status);
    if (status === 429 || status === 503) {
      penaliseHost(hostOf(url), response?.headers()["retry-after"] ?? null);
    }

    // If a specific selector is expected, wait for it (fast path) — otherwise wait briefly for JS
    if (opts.waitSelector) {
      await page.waitForSelector(opts.waitSelector, { timeout: 8_000 }).catch(() => { });
    } else {
      // Small JS-settle pause — avoids full networkidle (which is very slow)
      await page.waitForTimeout(1_500);
    }

    const html = await page.content();
    return { ...parseDocument(html, page.url() || url), status };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await page.close().catch(() => { });
  }
}

/** True if Playwright is enabled and likely available. */
export function isPlaywrightEnabled(): boolean {
  return process.env.PLAYWRIGHT_ENABLED === "true";
}
