import type { Browser, Page, Route } from "playwright";

const NAVIGATION_TIMEOUT_MS = 30_000;
const SELECTOR_WAIT_TIMEOUT_MS = 8_000;
const RENDER_SETTLE_MS = 1_500;

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
];

const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const TRACKER_DOMAINS = [
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

const BROWSER_HEADERS = {
  "Accept-Language": "cs,en-US,en;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const ignoreFailure = () => {};

let browserPromise: Promise<Browser> | null = null;

export function isPlaywrightEnabled(): boolean {
  return process.env.PLAYWRIGHT_ENABLED === "true";
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const closeBrowser = () => browser.close().catch(ignoreFailure);
  process.once("exit", closeBrowser);
  process.once("SIGINT", closeBrowser);
  return browser;
}

function getSharedBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

if (isPlaywrightEnabled()) {
  getSharedBrowser().catch(ignoreFailure);
}

function isUnwantedRequest(route: Route): boolean {
  const request = route.request();
  return (
    BLOCKED_RESOURCE_TYPES.has(request.resourceType()) ||
    TRACKER_DOMAINS.some((domain) => request.url().includes(domain))
  );
}

async function blockUnwantedRequests(page: Page) {
  await page.route("**/*", (route: Route) => {
    const handled = isUnwantedRequest(route) ? route.abort() : route.continue();
    handled.catch(ignoreFailure);
  });
}

async function waitForRenderedContent(page: Page, waitSelector?: string) {
  if (waitSelector) {
    await page.waitForSelector(waitSelector, { timeout: SELECTOR_WAIT_TIMEOUT_MS }).catch(ignoreFailure);
    return;
  }
  await page.waitForTimeout(RENDER_SETTLE_MS);
}

export async function pwFetchHtml(url: string, waitSelector?: string): Promise<string> {
  if (!isPlaywrightEnabled()) throw new Error("PLAYWRIGHT_ENABLED is not set");
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await blockUnwantedRequests(page);
    await page.setExtraHTTPHeaders(BROWSER_HEADERS);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await waitForRenderedContent(page, waitSelector);
    return await page.content();
  } finally {
    await page.close().catch(ignoreFailure);
  }
}
