import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const LOCAL_DEV_URL = "http://localhost:3000";
const SCRAPE_TOLERANT_TEST_TIMEOUT_MS = 120_000;
const DEV_SERVER_START_TIMEOUT_MS = 120_000;
const REPORT_DIR = "playwright-report";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: SCRAPE_TOLERANT_TEST_TIMEOUT_MS,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: REPORT_DIR, open: "never" }],
    ["json", { outputFile: `${REPORT_DIR}/results.json` }],
    ["./tests/e2e/reporters/fixPlanReporter.ts"],
  ],
  use: {
    baseURL: process.env.BASE_URL ?? LOCAL_DEV_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: isCI,
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.SKIP_DEV_SERVER
    ? undefined
    : {
        command: "npm run dev",
        url: LOCAL_DEV_URL,
        reuseExistingServer: true,
        timeout: DEV_SERVER_START_TIMEOUT_MS,
      },
});
