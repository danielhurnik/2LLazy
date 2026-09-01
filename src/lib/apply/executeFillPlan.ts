/**
 * executeFillPlan
 *
 * Takes a Playwright page and a validated FillPlan and executes all the field
 * fills, file upload, and finally the submit/next button click.
 *
 * Multi-step forms: after clicking submit/next the caller should check whether
 * the form is still present and call executeFillPlan again on the new step.
 */
import type { Page } from "playwright";
import type { FillPlan } from "./fillPlan";

export async function executeFillPlan(
  page: Page,
  plan: FillPlan,
  cvBuffer?: Buffer,
): Promise<void> {
  // Execute text / select fills
  for (const { idx, value } of plan.fills) {
    const selector = `[data-aaf-idx="${idx}"]`;

    const tag = await page.$eval(selector, (el) => el.tagName.toLowerCase()).catch(() => null);
    if (!tag) continue;

    if (tag === "select") {
      await page.selectOption(selector, value).catch((e) => console.warn(`[aaf] selectOption idx=${idx} failed:`, e));
    } else {
      // Clear existing value then fill
      await page.click(selector, { clickCount: 3 }).catch((e) => console.warn(`[aaf] click-to-clear idx=${idx} failed:`, e));
      await page.fill(selector, value).catch((e) => console.warn(`[aaf] fill idx=${idx} failed:`, e));
    }

    // Small delay to feel human-like and let the page react
    await new Promise((r) => setTimeout(r, 80));
  }

  // File upload (CV)
  if (typeof plan.fileUploadIdx === "number" && cvBuffer) {
    const uploadSelector = `[data-aaf-idx="${plan.fileUploadIdx}"]`;
    await page.setInputFiles(uploadSelector, {
      name: "cv.pdf",
      mimeType: "application/pdf",
      buffer: cvBuffer,
    }).catch((e) => console.warn(`[aaf] setInputFiles idx=${plan.fileUploadIdx} failed:`, e));
  }

  // Click submit / next
  const submitSelector = `[data-aaf-idx="${plan.submitIdx}"]`;
  await page.click(submitSelector).catch((err: unknown) => {
    throw new Error(`Failed to click submit at idx ${plan.submitIdx}: ${String(err)}`);
  });
}
