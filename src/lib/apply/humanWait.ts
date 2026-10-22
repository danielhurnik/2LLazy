import fs from "fs/promises";
import path from "path";
import type { Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { MS_PER_MINUTE, MS_PER_SECOND } from "@/lib/time";
import type { FieldDescriptor } from "./fieldMatcher";
import { scanPage, type PageScan } from "./fieldScanner";
import { notifyNeedsYou } from "./notify";
import { isConfirmed } from "./pageActions";
import { ApplyAbort, type ApplyContext } from "./types";

export type BlockerReason = "captcha" | "login";
export type WaitReason = BlockerReason | "review";
export type ReviewOutcome = "SENT" | "DISCARDED";

export const POLL_MS = 2 * MS_PER_SECOND;
export const WAIT_MINUTES = Math.max(1, Number(process.env.APPLY_HUMAN_WAIT_MINUTES ?? "15") || 15);
const REVIEW_WAIT_MINUTES = Math.max(1, Number(process.env.APPLY_REVIEW_WAIT_MINUTES ?? "60") || 60);
const REVIEW_FILE = "review.json";
const CAPTCHA_RESPONSE_FIELDS = 'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]';
const INVISIBLE_CAPTCHA = /size=invisible|grecaptcha-badge/i;

const hotReloadSafeGlobals = globalThis as unknown as {
  applyResumeRequests?: Set<string>;
  applyWaiting?: Map<string, WaitReason>;
  applyFocusRequests?: Set<string>;
  applyOutcomeRequests?: Map<string, ReviewOutcome>;
};
const resumeRequests = (hotReloadSafeGlobals.applyResumeRequests ??= new Set<string>());
const waitingRuns = (hotReloadSafeGlobals.applyWaiting ??= new Map<string, WaitReason>());
const focusRequests = (hotReloadSafeGlobals.applyFocusRequests ??= new Set<string>());
const outcomeRequests = (hotReloadSafeGlobals.applyOutcomeRequests ??= new Map<string, ReviewOutcome>());

export function requestResume(applicationId: string): boolean {
  const wasWaiting = waitingRuns.has(applicationId);
  if (wasWaiting) resumeRequests.add(applicationId);
  return wasWaiting;
}

export function requestFocus(applicationId: string): boolean {
  const wasWaiting = waitingRuns.has(applicationId);
  if (wasWaiting) focusRequests.add(applicationId);
  return wasWaiting;
}

export function requestOutcome(applicationId: string, outcome: ReviewOutcome): boolean {
  const reviewing = waitingRuns.get(applicationId) === "review";
  if (reviewing) outcomeRequests.set(applicationId, outcome);
  return reviewing;
}

function takeFocus(applicationId: string): boolean {
  const requested = focusRequests.has(applicationId);
  focusRequests.delete(applicationId);
  return requested;
}

function takeOutcome(applicationId: string): ReviewOutcome | null {
  const outcome = outcomeRequests.get(applicationId) ?? null;
  outcomeRequests.delete(applicationId);
  return outcome;
}

export function requestResumeAll(applicationIds: Iterable<string>): number {
  let count = 0;
  for (const id of applicationIds) {
    if (waitingRuns.get(id) === "review") continue;
    if (requestResume(id)) count += 1;
  }
  return count;
}

export function waitingApplicationIds(): string[] {
  return [...waitingRuns.keys()];
}

export function waitingReason(applicationId: string): WaitReason | null {
  return waitingRuns.get(applicationId) ?? null;
}

function countPages(page: Page): number {
  try {
    return page.context().pages().length;
  } catch {
    return 0;
  }
}

function oldestWaiting(): string | null {
  return waitingRuns.keys().next().value ?? null;
}

async function reclaimFocus(page: Page): Promise<void> {
  const hidden = await page.evaluate(() => document.visibilityState === "hidden").catch(() => false);
  if (hidden) await page.bringToFront().catch(() => undefined);
}

function takeResume(applicationId: string): boolean {
  const requested = resumeRequests.has(applicationId);
  resumeRequests.delete(applicationId);
  return requested;
}

export function blockingCaptcha(scan: PageScan): boolean {
  if (!scan.signals.captcha) return false;
  if (scan.signals.captchaChallenge) return true;
  if (scan.signals.captchaInvisible) return false;
  return !INVISIBLE_CAPTCHA.test(scan.signals.captcha);
}

export async function captchaSolved(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    const answered = await frame
      .evaluate((selector) => {
        const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector));
        if (fields.length === 0) return null;
        return fields.some((field) => field.value.trim().length > 0);
      }, CAPTCHA_RESPONSE_FIELDS)
      .catch(() => null);
    if (answered !== null) return answered;
  }
  return false;
}

export function blockerMessage(reason: WaitReason): string {
  if (reason === "review") return "Check the form in the apply window, change anything you like, and send it; this run finishes on its own";
  return reason === "captcha"
    ? "Solve the CAPTCHA in the apply window; the form is already filled and it continues on its own"
    : "Sign in on the job board in the apply window; it continues on its own once you are in";
}

async function blockerCleared(page: Page, reason: BlockerReason): Promise<{ cleared: boolean; scan: PageScan }> {
  const scan = await scanPage(page);
  if (reason === "login") return { cleared: !scan.signals.loginWall, scan };
  const cleared = !blockingCaptcha(scan) || (await captchaSolved(page));
  return { cleared, scan };
}

function hostOfPage(page: Page): string {
  try {
    return new URL(page.url()).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function recordObstacle(ctx: ApplyContext, reason: BlockerReason): Promise<void> {
  const host = hostOfPage(ctx.page);
  if (!host) return;
  await prisma.applyObstacle
    .create({ data: { host, kind: reason === "captcha" ? "CAPTCHA" : "LOGIN", applicationId: ctx.applicationId, jobId: ctx.job.id } })
    .catch(() => undefined);
}

export async function waitForHuman(ctx: ApplyContext, reason: BlockerReason): Promise<PageScan> {
  const message = blockerMessage(reason);
  const file = await ctx.evidence.screenshot(ctx.page, `waiting-${reason}`);
  ctx.evidence.log(`waiting for user: ${reason}`);
  await recordObstacle(ctx, reason);

  const deadline = Date.now() + WAIT_MINUTES * MS_PER_MINUTE;
  ctx.lock.release();
  let resumedScan: PageScan | null = null;
  try {
    resumeRequests.delete(ctx.applicationId);
    waitingRuns.set(ctx.applicationId, reason);
    await ctx.setWaiting(message);
    ctx.emit({ type: "waiting", reason, message, url: file ? ctx.evidence.urlFor(file) : "" });
    await ctx.page.bringToFront().catch(() => undefined);
    void notifyNeedsYou({ host: hostOfPage(ctx.page), company: ctx.job.company, reason });
    let knownPages = countPages(ctx.page);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (ctx.page.isClosed()) throw new ApplyAbort("FAILED", "The apply window was closed while waiting for you");
      const pagesNow = countPages(ctx.page);
      if (pagesNow > knownPages && oldestWaiting() === ctx.applicationId) await reclaimFocus(ctx.page);
      knownPages = pagesNow;
      if (takeFocus(ctx.applicationId)) await ctx.page.bringToFront().catch(() => undefined);
      const manual = takeResume(ctx.applicationId);
      const { cleared, scan } = await blockerCleared(ctx.page, reason);
      if (manual || cleared) {
        ctx.evidence.log(`resumed after ${reason} (${manual ? "Continue pressed" : "cleared on the page"})`);
        resumedScan = scan;
        break;
      }
    }
  } finally {
    waitingRuns.delete(ctx.applicationId);
    resumeRequests.delete(ctx.applicationId);
    await ctx.lock.acquire();
    await ctx.setWaiting(null);
  }
  if (resumedScan) {
    ctx.emit({ type: "resumed", message: "Continuing with the form" });
    await ctx.page.bringToFront().catch(() => undefined);
    return resumedScan;
  }
  const action = reason === "captcha" ? "solve the CAPTCHA" : "sign in";
  throw new ApplyAbort("NEEDS_MANUAL", `Waited ${WAIT_MINUTES} minutes for you to ${action}; finish the form in the apply window`);
}

export interface ReviewInput {
  draft: string | null;
  lang: "cs" | "en" | null;
  messageField: FieldDescriptor | null;
  filledSelectors: Set<string>;
  before: PageScan;
}

export interface ReviewResult {
  outcome: "confirmed" | "sent";
  finalMessage: string | null;
  scan: PageScan;
}

function currentMessage(scan: PageScan, field: FieldDescriptor | null): string | null {
  if (!field) return null;
  const current = scan.fields.find((f) => f.frameIndex === field.frameIndex && f.selector === field.selector);
  const value = current?.value.trim() ?? "";
  return value.length > 0 ? value : null;
}

export async function waitForReview(ctx: ApplyContext, input: ReviewInput): Promise<ReviewResult> {
  const reason: WaitReason = "review";
  const message = blockerMessage(reason);
  const file = await ctx.evidence.screenshot(ctx.page, "ready-for-you");
  ctx.evidence.log("waiting for user: review");
  const reviewPath = path.join(ctx.evidence.dir, REVIEW_FILE);
  await fs
    .writeFile(reviewPath, JSON.stringify({ draft: input.draft, screenshot: file, lang: input.lang, writtenAt: new Date().toISOString() }, null, 2))
    .catch(() => undefined);

  const deadline = Date.now() + REVIEW_WAIT_MINUTES * MS_PER_MINUTE;
  ctx.lock.release();
  let result: ReviewResult | null = null;
  let lastMessage = input.draft;
  try {
    resumeRequests.delete(ctx.applicationId);
    focusRequests.delete(ctx.applicationId);
    outcomeRequests.delete(ctx.applicationId);
    waitingRuns.set(ctx.applicationId, reason);
    await ctx.setWaiting("check the form in the apply window and send it");
    ctx.emit({ type: "waiting", reason, message, url: file ? ctx.evidence.urlFor(file) : "", draft: input.draft ?? undefined });
    await ctx.page.bringToFront().catch(() => undefined);
    void notifyNeedsYou({ host: hostOfPage(ctx.page), company: ctx.job.company, reason });
    let knownPages = countPages(ctx.page);
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (ctx.page.isClosed()) throw new ApplyAbort("NEEDS_MANUAL", "The apply window was closed before sending; open the posting and send it yourself");
      const pagesNow = countPages(ctx.page);
      if (pagesNow > knownPages && oldestWaiting() === ctx.applicationId) await reclaimFocus(ctx.page);
      knownPages = pagesNow;
      if (takeFocus(ctx.applicationId) || takeResume(ctx.applicationId)) await ctx.page.bringToFront().catch(() => undefined);
      const outcome = takeOutcome(ctx.applicationId);
      if (outcome === "DISCARDED") throw new ApplyAbort("NEEDS_MANUAL", "You discarded this application");
      const scan = await scanPage(ctx.page);
      lastMessage = currentMessage(scan, input.messageField) ?? lastMessage;
      if (outcome === "SENT" || isConfirmed(input.before, scan, input.filledSelectors)) {
        result = { outcome: outcome === "SENT" ? "sent" : "confirmed", finalMessage: lastMessage, scan };
        ctx.evidence.log(`sent by the user (${result.outcome})`);
        break;
      }
    }
  } finally {
    waitingRuns.delete(ctx.applicationId);
    resumeRequests.delete(ctx.applicationId);
    focusRequests.delete(ctx.applicationId);
    outcomeRequests.delete(ctx.applicationId);
    await fs.rm(reviewPath, { force: true }).catch(() => undefined);
    await ctx.lock.acquire();
    await ctx.setWaiting(null);
  }
  if (result) {
    ctx.emit({ type: "resumed", message: "Sent" });
    return result;
  }
  throw new ApplyAbort("NEEDS_MANUAL", `You did not send it within ${REVIEW_WAIT_MINUTES} minutes; the window stays open`);
}
