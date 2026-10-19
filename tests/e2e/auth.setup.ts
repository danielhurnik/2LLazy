import { test as setup } from "@playwright/test";
import path from "path";
import fs from "fs";

const AUTH_FILE = path.join(__dirname, "../.auth/user.json");
const AUTH_STATE_MAX_AGE_MS = 60 * 60 * 1000;
const LOGIN_REDIRECT_TIMEOUT_MS = 15_000;
const TEST_USER = { email: "test@test.com", password: "testtest" };

function hasFreshAuthState(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  const ageMs = Date.now() - fs.statSync(AUTH_FILE).mtimeMs;
  const { cookies } = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
  const hasSessionCookies = Array.isArray(cookies) && cookies.length > 0;
  return ageMs < AUTH_STATE_MAX_AGE_MS && hasSessionCookies;
}

setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  if (hasFreshAuthState()) {
    console.log("Reusing cached auth state.");
    return;
  }
  fs.rmSync(AUTH_FILE, { force: true });

  await page.goto("/login");
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();

  await page.waitForURL(
    (url) => url.hostname === "localhost" && !url.pathname.startsWith("/login"),
    { timeout: LOGIN_REDIRECT_TIMEOUT_MS },
  );
  await page.waitForLoadState("networkidle");

  await page.context().storageState({ path: AUTH_FILE });
  console.log("✓ Auth state saved (credentials login).");
});
