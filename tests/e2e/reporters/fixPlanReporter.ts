/**
 * Playwright Fix-Plan Reporter
 *
 * After the test run completes, this reporter:
 *  1. Collects all failures with their error messages and locations.
 *  2. Categorises each failure by likely root cause.
 *  3. Writes a machine-readable fixPlan.json + a human-readable FIX_PLAN.md
 *     to the playwright-report/ directory.
 *
 * The categories and suggested fixes are based on known failure patterns
 * in this codebase (auth wall, scraper timeouts, DB issues, etc.).
 */
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

interface FailureEntry {
  testTitle: string;
  file: string;
  error: string;
  category: string;
  suggestedFix: string;
  priority: "critical" | "high" | "medium" | "low";
}

const REPORT_DIR = path.join(process.cwd(), "playwright-report");

function categorise(testTitle: string, errorMessage: string): { category: string; suggestedFix: string; priority: FailureEntry["priority"] } {
  const msg = errorMessage.toLowerCase();
  const title = testTitle.toLowerCase();

  if (msg.includes("login") || msg.includes("401") || msg.includes("unauthenticated") || msg.includes("sign in")) {
    return {
      category: "Authentication",
      suggestedFix:
        "1. Start the dev server: `npm run dev`\n" +
        "2. Open http://localhost:3000 in your browser and complete Google OAuth.\n" +
        "3. Re-run `npx playwright test` — the auth state will be saved to tests/.auth/user.json.",
      priority: "critical",
    };
  }

  if (msg.includes("timeout") || msg.includes("waitfor") || msg.includes("exceeded")) {
    if (title.includes("scrape") || title.includes("search") || title.includes("job")) {
      return {
        category: "Scraper Timeout",
        suggestedFix:
          "1. Check the dev server logs for [scrape] errors.\n" +
          "2. Verify DATABASE_URL is set in .env and the database is reachable.\n" +
          "3. Check network connectivity to job board sites.\n" +
          "4. Increase PLAYWRIGHT_TIMEOUT in playwright.config.ts if scraping is just slow.",
        priority: "high",
      };
    }
    return {
      category: "General Timeout",
      suggestedFix:
        "1. Ensure the dev server is running on http://localhost:3000.\n" +
        "2. Check that all .env variables (DATABASE_URL, AUTH_SECRET) are set.\n" +
        "3. Increase timeout for this specific test if it's a known slow path.",
      priority: "high",
    };
  }

  if (msg.includes("500") || msg.includes("internal server error") || msg.includes("prisma")) {
    return {
      category: "Server / Database Error",
      suggestedFix:
        "1. Check server terminal output for Prisma errors.\n" +
        "2. Run `npm run db:migrate` to apply pending migrations.\n" +
        "3. Verify DATABASE_URL in .env points to a running Neon / Postgres instance.\n" +
        "4. Run `npm run db:generate` to regenerate the Prisma client.",
      priority: "critical",
    };
  }

  if (msg.includes("400") || msg.includes("applicationid") || msg.includes("invalid")) {
    return {
      category: "Validation / API Contract",
      suggestedFix:
        "1. Check the applicationId regex in src/app/api/apply/route.ts.\n" +
        "2. Confirm the test is sending the correct payload format.\n" +
        "3. If the validation changed, update the test expectation.",
      priority: "medium",
    };
  }

  if (msg.includes("selector") || msg.includes("locator") || msg.includes("element") || msg.includes("visible")) {
    return {
      category: "UI Selector Mismatch",
      suggestedFix:
        "1. Open playwright-report/index.html and inspect the screenshot.\n" +
        "2. The component structure may have changed — update the selector in the test.\n" +
        "3. Consider adding data-testid attributes to the relevant component.\n" +
        "4. Run: `npx playwright codegen http://localhost:3000` to regenerate selectors.",
      priority: "medium",
    };
  }

  if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused")) {
    return {
      category: "Network / Dev Server",
      suggestedFix:
        "1. Ensure `npm run dev` is running before executing tests.\n" +
        "2. Check that nothing else is using port 3000.\n" +
        "3. Verify BASE_URL env var (defaults to http://localhost:3000).",
      priority: "critical",
    };
  }

  return {
    category: "Unknown",
    suggestedFix:
      "1. Open playwright-report/index.html for a full trace + screenshot.\n" +
      "2. Check the error message and stack trace for clues.\n" +
      "3. Run the individual test in headed mode: `npx playwright test --headed --debug`.",
    priority: "low",
  };
}

class FixPlanReporter implements Reporter {
  private failures: FailureEntry[] = [];

  onBegin(_config: FullConfig, _suite: Suite) {
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "failed") return;

    const errorMessage = result.errors
      .map((e) => e.message ?? "")
      .join("\n");

    const fileLocation = test.location.file.replace(process.cwd() + path.sep, "");
    const { category, suggestedFix, priority } = categorise(test.title, errorMessage);

    this.failures.push({
      testTitle: test.title,
      file: fileLocation,
      error: errorMessage.slice(0, 500),
      category,
      suggestedFix,
      priority,
    });
  }

  onEnd(_result: FullResult) {
    if (this.failures.length === 0) {
      // Write a success note
      const successMd =
        `# Fix Plan\n\n` +
        `✅ **All tests passed!** No fixes required.\n\n` +
        `Generated: ${new Date().toISOString()}\n`;
      fs.writeFileSync(path.join(REPORT_DIR, "FIX_PLAN.md"), successMd);
      fs.writeFileSync(path.join(REPORT_DIR, "fixPlan.json"), JSON.stringify({ failures: [], generatedAt: new Date().toISOString() }, null, 2));
      return;
    }

    // Group by priority
    const byPriority: Record<string, FailureEntry[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
    };
    for (const f of this.failures) {
      byPriority[f.priority].push(f);
    }

    // Write JSON
    fs.writeFileSync(
      path.join(REPORT_DIR, "fixPlan.json"),
      JSON.stringify({ failures: this.failures, generatedAt: new Date().toISOString() }, null, 2),
    );

    // Write Markdown
    let md =
      `# Playwright Fix Plan\n\n` +
      `Generated: ${new Date().toISOString()}  \n` +
      `Total failures: **${this.failures.length}**\n\n` +
      `---\n\n`;

    for (const priority of ["critical", "high", "medium", "low"] as const) {
      const entries = byPriority[priority];
      if (entries.length === 0) continue;

      const emoji = priority === "critical" ? "🔴" : priority === "high" ? "🟠" : priority === "medium" ? "🟡" : "⚪";
      md += `## ${emoji} ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority (${entries.length})\n\n`;

      for (const f of entries) {
        md +=
          `### ${f.testTitle}\n\n` +
          `- **File:** \`${f.file}\`\n` +
          `- **Category:** ${f.category}\n` +
          `- **Error:** \`${f.error.slice(0, 200)}\`\n\n` +
          `**Suggested Fix:**\n\n${f.suggestedFix}\n\n` +
          `---\n\n`;
      }
    }

    fs.writeFileSync(path.join(REPORT_DIR, "FIX_PLAN.md"), md);

    console.log(`\n🔧 Fix plan written to playwright-report/FIX_PLAN.md (${this.failures.length} failures)\n`);
  }
}

export default FixPlanReporter;
