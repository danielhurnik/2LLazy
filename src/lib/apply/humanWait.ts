import type { Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { MS_PER_MINUTE, MS_PER_SECOND } from "@/lib/time";
import { scanPage, type PageScan } from "./fieldScanner";
import { ApplyAbort, type ApplyContext } from "./types";

export type BlockerReason = "captcha" | "login";

const POLL_MS = 2 * MS_PER_SECOND;
const WAIT_MINUTES = Math.max(1, Number(process.env.APPLY_HUMAN_WAIT_MINUTES ?? "15") || 15);
const CAPTCHA_RESPONSE_FIELDS = 'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]';
const INVISIBLE_CAPTCHA = /size=invisible|grecaptcha-badge/i;

const hotReloadSafeGlobals = globalThis as unknown as {
  applyResumeRequests?: Set<string>;
  applyWaiting?: Map<string, BlockerReason>;
};
const resumeRequests = (hotReloadSafeGlobals.applyResumeRequests ??= new Set<string>());
const waitingRuns = (hotReloadSafeGlobals.applyWaiting ??= new Map<string, BlockerReason>());

export function requestResume(applicationId: string): boolean {
  const wasWaiting = waitingRuns.has(applicationId);
  if (wasWaiting) resumeRequests.add(applicationId);
  return wasWaiting;
}

export function requestResumeAll(applicationIds: Iterable<string>): number {
  let count = 0;
  for (const id of applicationIds) {
    if (requestResume(id)) count += 1;
  }
  return count;
}

export function waitingApplicationIds(): string[] {
  return [...waitingRuns.keys()];
}

export function waitingReason(applicationId: string): BlockerReason | null {
  return waitingRuns.get(applicationId) ?? null;
}

function takeResume(applicationId: string): boolean {
  const requested = resumeRequests.has(applicationId);
  resumeRequests.delete(applicationId);
  return requested;
}

export function blockingCaptcha(scan: PageScan): boolean {
  return !!scan.signals.captcha && !INVISIBLE_CAPTCHA.test(scan.signals.captcha);
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

export function blockerMessage(reason: BlockerReason): string {
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

async function recordObstacle(ctx: ApplyContext, reason: BlockerReason): Promise<void> {
  let host = "";
  try {
    host = new URL(ctx.page.url()).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
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
  resumeRequests.delete(ctx.applicationId);
  waitingRuns.set(ctx.applicationId, reason);
  await ctx.setWaiting(message);
  ctx.emit({ type: "waiting", reason, message, url: file ? ctx.evidence.urlFor(file) : "" });
  await ctx.page.bringToFront().catch(() => undefined);

  const deadline = Date.now() + WAIT_MINUTES * MS_PER_MINUTE;
  ctx.lock.release();
  let resumedScan: PageScan | null = null;
  try {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (ctx.page.isClosed()) throw new ApplyAbort("FAILED", "The apply window was closed while waiting for you");
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
