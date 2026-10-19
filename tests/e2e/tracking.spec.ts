import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_FILE = path.join(__dirname, "../.auth/user.json");
const LOGIN_PATH = "/login";
const ABSOLUTE_HTTP_URL = /^https?:\/\//;

function hasSavedAuthState(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const { cookies } = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

async function openOrSkipWhenLoggedOut(page: Page, route: string): Promise<void> {
  await page.goto(route);
  if (page.url().includes(LOGIN_PATH)) test.skip();
}

test.describe("Tracking — saved jobs and dashboard", () => {
  test.skip(!hasSavedAuthState(), "Skipped: not authenticated");

  test.use({ storageState: AUTH_FILE });

  test("Saved page loads and shows Track buttons if jobs are saved", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, "/favourites");

    await expect(page.locator("body")).not.toContainText("500");

    const trackButtons = page.getByRole("button", { name: /track/i });
    if ((await trackButtons.count()) === 0) {
      console.warn("⚠ No saved jobs found — save a job from the search page first.");
      test.skip();
    }

    const firstTrackButton = trackButtons.first();
    await expect(firstTrackButton).toBeVisible();
    await expect(firstTrackButton).toBeEnabled();
  });

  test("Dashboard: ApplicationCard renders with status chip and open link", async ({ page }) => {
    await openOrSkipWhenLoggedOut(page, "/dashboard");

    const applicationCards = page
      .locator(".MuiCard-root")
      .filter({ has: page.locator(".MuiChip-root") });
    if ((await applicationCards.count()) === 0) {
      console.warn("⚠ No application cards on dashboard — need to track a job first.");
      return;
    }

    const openLink = applicationCards.first().locator('a[target="_blank"]');
    await expect(openLink).toBeVisible();
    const href = await openLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href).toMatch(ABSOLUTE_HTTP_URL);
  });
});
