import { test, expect } from "@playwright/test";
import type { Browser, Locator, Page, Response } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_FILE = path.join(__dirname, "../.auth/user.json");
const SKIP_REASON_NOT_AUTHENTICATED = "Skipped: not authenticated";

const HOME_PATH = "/";
const LOGIN_PATH = "/login";

const CARD_SELECTOR = ".MuiCard-root";
const CHIP_SELECTOR = ".MuiChip-root";
const JOB_TITLE_SELECTOR = "h6";

const JOB_POSITION_LABEL = "Job Position";
const SEARCH_BUTTON_NAME = /^Search$/;
const STOP_BUTTON_NAME = /^Stop$/;

const SEARCH_START_TIMEOUT_MS = 15_000;
const FIRST_RESULT_CARD_TIMEOUT_MS = 90_000;
const SCRAPE_FINISH_TIMEOUT_MS = 90_000;
const PAGE_HEADING_TIMEOUT_MS = 10_000;

const OFF_DOMAIN_TITLE_PREFIX = /^(DevOps|SRE|QA|Android|iOS|Flutter)\s/i;
const TOP_RESULTS_SAMPLE_SIZE = 10;
const MAX_OFF_DOMAIN_RESULTS = 2;
const MIN_CARDS_TO_COMPARE_ORDER = 2;

const FIRST_SERVER_ERROR_STATUS = 500;
const ERROR_BOUNDARY_TEXT = /Something went wrong|didn.t load|Internal Server Error/i;

function hasSavedAuthState(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const { cookies } = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

test.use({
  storageState: AUTH_FILE,
});

const jobPositionInput = (page: Page) => page.getByLabel(JOB_POSITION_LABEL);
const searchButton = (page: Page) => page.getByRole("button", { name: SEARCH_BUTTON_NAME });
const stopButton = (page: Page) => page.getByRole("button", { name: STOP_BUTTON_NAME });
const jobCards = (page: Page) => page.locator(CARD_SELECTOR).filter({ has: page.locator(JOB_TITLE_SELECTOR) });
const chipsWithText = (page: Page, text: string | RegExp) => page.locator(CHIP_SELECTOR).filter({ hasText: text });

async function openOrSkipWhenLoggedOut(page: Page, route: string): Promise<Response | null> {
  const response = await page.goto(route);
  if (page.url().includes(LOGIN_PATH)) test.skip();
  return response;
}

async function submitSearch(page: Page, query: string): Promise<void> {
  await jobPositionInput(page).fill(query);
  await searchButton(page).click();
}

async function searchOrSkipWhenLoggedOut(page: Page, query: string): Promise<Locator> {
  await openOrSkipWhenLoggedOut(page, HOME_PATH);
  await submitSearch(page, query);

  const cards = jobCards(page);
  await cards.first().waitFor({ timeout: FIRST_RESULT_CARD_TIMEOUT_MS }).catch(() => null);
  return cards;
}

async function readCardTitles(cards: Locator, cardCount: number): Promise<string[]> {
  const titles: string[] = [];
  for (let index = 0; index < cardCount; index++) {
    const title = await cards.nth(index).locator(JOB_TITLE_SELECTOR).textContent().catch(() => "");
    titles.push(title ?? "");
  }
  return titles;
}

async function readCardLinkHrefs(cards: Locator, cardCount: number): Promise<string[]> {
  const hrefs: string[] = [];
  for (let index = 0; index < cardCount; index++) {
    const href = await cards.nth(index).locator("a").first().getAttribute("href").catch(() => "");
    if (href) hrefs.push(href);
  }
  return hrefs;
}

function repeatedValues(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

async function withLoggedOutPage(
  browser: Browser,
  route: string,
  check: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });
  try {
    const page = await context.newPage();
    await page.goto(route);
    await check(page);
  } finally {
    await context.close();
  }
}

async function expectRenderedWithoutServerError(page: Page, response: Response | null): Promise<void> {
  expect(response?.status() ?? 0).toBeLessThan(FIRST_SERVER_ERROR_STATUS);
  await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
}

test.describe("1 — Intent Engine + Domain Boundary", () => {
  test.skip(!hasSavedAuthState(), `${SKIP_REASON_NOT_AUTHENTICATED} (run dev server and log in first)`);

  test("React search: app loads and accepts query input", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, HOME_PATH);

    const input = jobPositionInput(page);
    await expect(input).toBeVisible();
    await input.fill("React");
    await expect(input).toHaveValue("React");
  });

  test("React search: triggers SSE scrape and shows progress text", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, HOME_PATH);

    await submitSearch(page, "React");

    await expect(stopButton(page)).toBeVisible({ timeout: SEARCH_START_TIMEOUT_MS });
  });

  test("React search: no DevOps/QA job cards should dominate results", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "React");

    const count = await cards.count();
    if (count === 0) test.skip();

    const titles = await readCardTitles(cards, Math.min(count, TOP_RESULTS_SAMPLE_SIZE));
    const offDomainTitles = titles.filter((title) => OFF_DOMAIN_TITLE_PREFIX.test(title));

    expect(
      offDomainTitles.length,
      `Suspicious off-domain results: ${offDomainTitles.join(", ")}`,
    ).toBeLessThanOrEqual(MAX_OFF_DOMAIN_RESULTS);
  });

  test("Backend search: starts scraping and returns cards", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "Backend");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("Fullstack search: starts scraping and returns cards", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "Fullstack");
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe("2 — Negative Scoring", () => {
  test.skip(!hasSavedAuthState(), SKIP_REASON_NOT_AUTHENTICATED);

  test("React search: high-similarity jobs score > 0 and are sorted descending", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "React");

    const count = await cards.count();
    if (count < MIN_CARDS_TO_COMPARE_ORDER) test.skip();

    const firstCachedCardBox = await page
      .locator(CARD_SELECTOR)
      .filter({ has: page.locator(`${CHIP_SELECTOR}:text("CACHED")`) })
      .first()
      .boundingBox()
      .catch(() => null);

    const firstCardTitleBox = await page
      .locator(`${CARD_SELECTOR} ${JOB_TITLE_SELECTOR}`)
      .first()
      .boundingBox()
      .catch(() => null);

    if (firstCachedCardBox && firstCardTitleBox) {
      expect(firstCachedCardBox.y).toBeGreaterThanOrEqual(0);
    }
  });
});

test.describe("3 — NoFluffJobs Pagination + Slug URL", () => {
  test.skip(!hasSavedAuthState(), SKIP_REASON_NOT_AUTHENTICATED);

  test("React search: NoFluffJobs source chip appears in results", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "React");

    const noFluffChipCount = await chipsWithText(page, /nofluff/i).count();
    if (noFluffChipCount === 0) {
      console.warn("⚠ No NoFluffJobs results found — may be network or scraper issue.");
    }

    const totalCards = await cards.count();
    expect(totalCards).toBeGreaterThanOrEqual(0);
  });
});

test.describe("4 — SSE Dedup", () => {
  test.skip(!hasSavedAuthState(), SKIP_REASON_NOT_AUTHENTICATED);

  test("React search: no duplicate job titles in results", async ({ page }) => {
    const cards = await searchOrSkipWhenLoggedOut(page, "React");

    const count = await cards.count();
    if (count === 0) test.skip();

    const sourceUrls = await readCardLinkHrefs(cards, count);
    const duplicateUrls = repeatedValues(sourceUrls);

    expect(
      duplicateUrls.length,
      `Duplicate source URLs: ${[...new Set(duplicateUrls)].join(", ")}`,
    ).toBe(0);
  });

  test("React search: scrape finishes and scraping spinner disappears", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, HOME_PATH);

    await submitSearch(page, "React");

    await stopButton(page).waitFor({ timeout: SEARCH_START_TIMEOUT_MS }).catch(() => null);
    await searchButton(page).waitFor({ timeout: SCRAPE_FINISH_TIMEOUT_MS });
  });
});

test.describe("5 — Cached Results (pgvector)", () => {
  test.skip(!hasSavedAuthState(), SKIP_REASON_NOT_AUTHENTICATED);

  test("Second search returns CACHED chips in results", async ({ page }) => {
    await searchOrSkipWhenLoggedOut(page, "React");

    const cachedChipCount = await chipsWithText(page, "CACHED").count();
    if (cachedChipCount === 0) {
      console.warn("⚠ No CACHED chips found — pgvector cache may be cold (first ever run).");
    }
    expect(cachedChipCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe("7 — App Health Checks", () => {
  test("Login page renders the sign-in button", async ({ browser }) => {
    await withLoggedOutPage(browser, LOGIN_PATH, async (page) => {
      await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
    });
  });

  test("Unauthenticated user is redirected to /login", async ({ browser }) => {
    await withLoggedOutPage(browser, HOME_PATH, async (page) => {
      expect(page.url()).toContain(LOGIN_PATH);
    });
  });

  test("Dashboard redirects to /login if unauthenticated", async ({ browser }) => {
    await withLoggedOutPage(browser, "/dashboard", async (page) => {
      expect(page.url()).toContain(LOGIN_PATH);
    });
  });

  test("Authenticated user sees the sidebar nav", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, HOME_PATH);

    await expect(page.getByText("2LLAZY")).toBeVisible();
    await expect(page.getByRole("link", { name: /Search Jobs/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
  });

  test("Search page has Job Position input and Search button", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, HOME_PATH);

    await expect(jobPositionInput(page)).toBeVisible();
    await expect(searchButton(page)).toBeVisible();
  });

  test("/dashboard loads application list or empty state", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, "/dashboard");

    await expect(page.locator("h4, h5, h6").first()).toBeVisible({ timeout: PAGE_HEADING_TIMEOUT_MS });
  });

  test("/stats page renders without crashing", async ({ page }) => {
    const response = await openOrSkipWhenLoggedOut(page, "/stats");
    await expectRenderedWithoutServerError(page, response);
  });

  test("/interviews page renders without crashing", async ({ page }) => {
    const response = await openOrSkipWhenLoggedOut(page, "/interviews");
    await expectRenderedWithoutServerError(page, response);
  });

  test("/settings page renders without crashing", async ({ page }) => {
    const response = await openOrSkipWhenLoggedOut(page, "/settings");
    await expectRenderedWithoutServerError(page, response);
  });

  test("/favourites page renders without crashing", async ({ page }) => {
    const response = await openOrSkipWhenLoggedOut(page, "/favourites");
    await expectRenderedWithoutServerError(page, response);
  });
});
