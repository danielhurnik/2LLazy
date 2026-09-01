/**
 * applyStartupjobs
 *
 * Orchestrates the full auto-apply flow for StartupJobs.cz job postings.
 *
 * Flow:
 *  1. Launch Chromium (headless on a server; APPLY_HEADFUL=true to watch).
 *  2. Navigate to the job URL.
 *  3. findApplyButton → click it.
 *  4. Detect outcome: modal appeared, navigated to new URL, or external ATS.
 *  5. For each step (up to MAX_STEPS): snapshot → deterministic FillPlan → execute.
 *  6. Detect success and return { status, errorMessage? }.
 *
 * External ATS detection: if the hostname after clicking matches a known ATS
 * platform (Greenhouse, Lever, Workday, Teamtailor, Recruitis) we return
 * MANUAL_REQUIRED because those forms are heavily dynamic.
 */
import type { Browser } from "playwright";
import { findApplyButton } from "./findApplyButton";
import { snapshotFormFields } from "./snapshotFormFields";
import { generateFillPlan, type ApplicantProfile } from "./fillPlan";
import { executeFillPlan } from "./executeFillPlan";

export type ApplyStatus = "APPLIED" | "FAILED" | "MANUAL_REQUIRED";

export interface ApplyResult {
  status: ApplyStatus;
  errorMessage?: string;
}

// Known ATS platforms we don't yet support — return MANUAL_REQUIRED
const EXTERNAL_ATS_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "workday.com",
  "teamtailor.com",
  "recruitis.io",
  "jobs.ashbyhq.com",
  "apply.workable.com",
];

const MAX_STEPS = 10;
const SUCCESS_PATTERNS = /thank you|application (submitted|received)|successfully applied|žádost (odeslána|přijata)/i;

export async function applyStartupjobs(
  jobUrl: string,
  profile: ApplicantProfile,
  cvBuffer?: Buffer,
): Promise<ApplyResult> {
  let browser: Browser | undefined;

  try {
    // Imported dynamically so the module costs nothing unless auto-apply runs.
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      // Headless on a server; APPLY_HEADFUL=true opens a visible window so a
      // developer can watch the form being filled and intervene.
      headless: process.env.APPLY_HEADFUL !== "true",
      slowMo: 50,
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // ── Step 1: Find and click the apply button ───────────────────────────────
    const applyIdx = await findApplyButton(page);
    if (applyIdx === null) {
      return { status: "MANUAL_REQUIRED", errorMessage: "Could not find an Apply button on the page." };
    }

    const urlBefore = page.url();
    await page.evaluate((idx: number) => {
      const el = document.querySelector<HTMLElement>(`[data-aaf-btn-idx="${idx}"]`);
      el?.click();
    }, applyIdx);

    // Wait for page to react (modal open, navigation, or network idle)
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });

    const urlAfter = page.url();

    // ── Step 2: Detect if we landed on an external ATS ────────────────────────
    try {
      const host = new URL(urlAfter).hostname.replace(/^www\./, "");
      if (EXTERNAL_ATS_HOSTS.some((ats) => host.includes(ats))) {
        return {
          status: "MANUAL_REQUIRED",
          errorMessage: `External ATS detected (${host}) — manual completion required.`,
        };
      }
    } catch {
      // URL parse failed — continue
    }

    // ── Step 3: Multi-step form filling loop ──────────────────────────────────
    for (let step = 0; step < MAX_STEPS; step++) {
      const pageText = await page.innerText("body").catch(() => "");

      // Check for success state
      if (SUCCESS_PATTERNS.test(pageText)) {
        return { status: "APPLIED" };
      }

      const fields = await snapshotFormFields(page);
      if (fields.length === 0) {
        // No form visible — might have just navigated to a success page
        if (urlAfter !== urlBefore) {
          return { status: "APPLIED" };
        }
        break;
      }

      const plan = generateFillPlan(fields, profile);
      if (!plan) {
        return {
          status: "MANUAL_REQUIRED",
          errorMessage: "The form's fields could not be mapped confidently — finish it by hand.",
        };
      }

      const urlBeforeSubmit = page.url();
      await executeFillPlan(page, plan, cvBuffer);

      // Wait for the page to react after submit/next click
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => { });

      const urlAfterSubmit = page.url();
      const pageTextAfter = await page.innerText("body").catch(() => "");

      if (SUCCESS_PATTERNS.test(pageTextAfter)) {
        return { status: "APPLIED" };
      }

      // If URL hasn't changed and there are still form fields, loop for next step
      if (urlAfterSubmit === urlBeforeSubmit) {
        const remainingFields = await snapshotFormFields(page);
        if (remainingFields.length === 0) {
          return { status: "APPLIED" };
        }
        // Continue loop for next form step
      }
    }

    return {
      status: "FAILED",
      errorMessage: `Could not confirm successful submission after ${MAX_STEPS} steps.`,
    };
  } catch (err) {
    return {
      status: "FAILED",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser?.close();
  }
}
