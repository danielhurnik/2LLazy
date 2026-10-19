import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import fs from "fs";
import path from "path";

type Priority = "critical" | "high" | "medium" | "low";

interface Diagnosis {
  category: string;
  suggestedFix: string;
  priority: Priority;
}

interface FailureEntry extends Diagnosis {
  testTitle: string;
  file: string;
  error: string;
}

interface DiagnosisRule extends Diagnosis {
  matches: (errorMessage: string, testTitle: string) => boolean;
}

const REPORT_DIR = path.join(process.cwd(), "playwright-report");
const FIX_PLAN_MARKDOWN_PATH = path.join(REPORT_DIR, "FIX_PLAN.md");
const FIX_PLAN_JSON_PATH = path.join(REPORT_DIR, "fixPlan.json");
const STORED_ERROR_LENGTH = 500;
const DISPLAYED_ERROR_LENGTH = 200;
const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];
const PRIORITY_BADGE: Record<Priority, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "⚪",
};

const containsAny = (text: string, needles: string[]) => needles.some((needle) => text.includes(needle));
const numberedSteps = (...lines: string[]) => lines.map((line, i) => `${i + 1}. ${line}`).join("\n");
const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const isTimeout = (message: string) => containsAny(message, ["timeout", "waitfor", "exceeded"]);

const DIAGNOSIS_RULES: DiagnosisRule[] = [
  {
    matches: (message) => containsAny(message, ["login", "401", "unauthenticated", "sign in"]),
    category: "Authentication",
    suggestedFix: numberedSteps(
      "Start the dev server: `npm run dev`",
      "Create the test user: `npx tsx prisma/seed-test-user.ts`",
      "Delete tests/.auth/user.json and re-run `npx playwright test` so the setup project logs in again.",
    ),
    priority: "critical",
  },
  {
    matches: (message, title) => isTimeout(message) && containsAny(title, ["scrape", "search", "job"]),
    category: "Scraper Timeout",
    suggestedFix: numberedSteps(
      "Check the dev server logs for [scrape] errors.",
      "Check network connectivity to the job board sites.",
      "Raise the test timeout in playwright.config.ts if scraping is just slow.",
    ),
    priority: "high",
  },
  {
    matches: (message) => isTimeout(message),
    category: "General Timeout",
    suggestedFix: numberedSteps(
      "Ensure the dev server is running on http://localhost:3000.",
      "Check that DATABASE_URL is set in .env.local or .env.",
      "Increase the timeout for this specific test if it's a known slow path.",
    ),
    priority: "high",
  },
  {
    matches: (message) => containsAny(message, ["500", "internal server error", "prisma"]),
    category: "Server / Database Error",
    suggestedFix: numberedSteps(
      "Check server terminal output for Prisma errors.",
      "Run `npm run db:migrate` to apply pending migrations.",
      "Verify DATABASE_URL points to a running Postgres instance.",
      "Run `npm run db:generate` to regenerate the Prisma client.",
    ),
    priority: "critical",
  },
  {
    matches: (message) => containsAny(message, ["400", "invalid"]),
    category: "Validation / API Contract",
    suggestedFix: numberedSteps(
      "Check the input validation in the server action or route the test calls.",
      "Confirm the test is sending the correct payload format.",
      "If the validation changed, update the test expectation.",
    ),
    priority: "medium",
  },
  {
    matches: (message) => containsAny(message, ["selector", "locator", "element", "visible"]),
    category: "UI Selector Mismatch",
    suggestedFix: numberedSteps(
      "Open playwright-report/index.html and inspect the screenshot.",
      "The component structure may have changed — update the selector in the test.",
      "Consider adding data-testid attributes to the relevant component.",
      "Run: `npx playwright codegen http://localhost:3000` to regenerate selectors.",
    ),
    priority: "medium",
  },
  {
    matches: (message) => containsAny(message, ["network", "fetch", "econnrefused"]),
    category: "Network / Dev Server",
    suggestedFix: numberedSteps(
      "Ensure `npm run dev` is running before executing tests.",
      "Check that nothing else is using port 3000.",
      "Verify BASE_URL env var (defaults to http://localhost:3000).",
    ),
    priority: "critical",
  },
];

const FALLBACK_DIAGNOSIS: Diagnosis = {
  category: "Unknown",
  suggestedFix: numberedSteps(
    "Open playwright-report/index.html for a full trace + screenshot.",
    "Check the error message and stack trace for clues.",
    "Run the individual test in headed mode: `npx playwright test --headed --debug`.",
  ),
  priority: "low",
};

function diagnose(testTitle: string, errorMessage: string): Diagnosis {
  const message = errorMessage.toLowerCase();
  const title = testTitle.toLowerCase();
  const rule = DIAGNOSIS_RULES.find((candidate) => candidate.matches(message, title));
  if (!rule) return FALLBACK_DIAGNOSIS;
  const { category, suggestedFix, priority } = rule;
  return { category, suggestedFix, priority };
}

function renderFailure(failure: FailureEntry): string {
  return (
    `### ${failure.testTitle}\n\n` +
    `- **File:** \`${failure.file}\`\n` +
    `- **Category:** ${failure.category}\n` +
    `- **Error:** \`${failure.error.slice(0, DISPLAYED_ERROR_LENGTH)}\`\n\n` +
    `**Suggested Fix:**\n\n${failure.suggestedFix}\n\n` +
    `---\n\n`
  );
}

function renderPrioritySection(priority: Priority, failures: FailureEntry[]): string {
  if (failures.length === 0) return "";
  const heading = `## ${PRIORITY_BADGE[priority]} ${capitalize(priority)} Priority (${failures.length})\n\n`;
  return heading + failures.map(renderFailure).join("");
}

function renderFixPlan(failures: FailureEntry[], generatedAt: string): string {
  const header =
    `# Playwright Fix Plan\n\n` +
    `Generated: ${generatedAt}  \n` +
    `Total failures: **${failures.length}**\n\n` +
    `---\n\n`;
  const sections = PRIORITY_ORDER.map((priority) =>
    renderPrioritySection(priority, failures.filter((failure) => failure.priority === priority)),
  );
  return header + sections.join("");
}

function renderAllPassed(generatedAt: string): string {
  return `# Fix Plan\n\n✅ **All tests passed!** No fixes required.\n\nGenerated: ${generatedAt}\n`;
}

class FixPlanReporter implements Reporter {
  private failures: FailureEntry[] = [];

  onBegin() {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status !== "failed") return;
    const errorMessage = result.errors.map((e) => e.message ?? "").join("\n");
    this.failures.push({
      testTitle: test.title,
      file: path.relative(process.cwd(), test.location.file),
      error: errorMessage.slice(0, STORED_ERROR_LENGTH),
      ...diagnose(test.title, errorMessage),
    });
  }

  onEnd() {
    const generatedAt = new Date().toISOString();
    fs.writeFileSync(FIX_PLAN_JSON_PATH, JSON.stringify({ failures: this.failures, generatedAt }, null, 2));

    if (this.failures.length === 0) {
      fs.writeFileSync(FIX_PLAN_MARKDOWN_PATH, renderAllPassed(generatedAt));
      return;
    }

    fs.writeFileSync(FIX_PLAN_MARKDOWN_PATH, renderFixPlan(this.failures, generatedAt));
    console.log(`\n🔧 Fix plan written to playwright-report/FIX_PLAN.md (${this.failures.length} failures)\n`);
  }
}

export default FixPlanReporter;
