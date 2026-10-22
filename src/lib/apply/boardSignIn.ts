import type { Page } from "playwright";
import { MS_PER_MINUTE, MS_PER_SECOND } from "@/lib/time";
import { openApplyPage, releasePage } from "./browser";
import { scanPage, type PageScan } from "./fieldScanner";

interface SignInTarget {
  host: string;
  loginUrl: string;
}

export const SIGN_IN_HOSTS: readonly SignInTarget[] = [{ host: "jobstack.it", loginUrl: "https://www.jobstack.it/login" }];

const POLL_MS = 2 * MS_PER_SECOND;
const WAIT_MINUTES = Math.max(1, Number(process.env.APPLY_HUMAN_WAIT_MINUTES ?? "15") || 15);

const hotReloadSafeGlobals = globalThis as unknown as {
  applySignedInHosts?: Map<string, boolean>;
  applySignInsInFlight?: Map<string, Promise<boolean>>;
};
const signedInHosts = (hotReloadSafeGlobals.applySignedInHosts ??= new Map<string, boolean>());
const signInsInFlight = (hotReloadSafeGlobals.applySignInsInFlight ??= new Map<string, Promise<boolean>>());

const bareHost = (host: string) => host.trim().toLowerCase().replace(/^www\./, "");

export function signInTargetFor(host: string): SignInTarget | null {
  const wanted = bareHost(host);
  return SIGN_IN_HOSTS.find((target) => target.host === wanted) ?? null;
}

export function markSignedIn(host: string, signedIn: boolean): void {
  const target = signInTargetFor(host);
  if (target) signedInHosts.set(target.host, signedIn);
}

export function isSignedIn(host: string): boolean {
  const target = signInTargetFor(host);
  return target !== null && signedInHosts.get(target.host) === true;
}

export function signInHosts(): { host: string; loginUrl: string; signedIn: boolean }[] {
  return SIGN_IN_HOSTS.map((target) => ({ host: target.host, loginUrl: target.loginUrl, signedIn: isSignedIn(target.host) }));
}

export function hasLeftLoginPage(scan: PageScan, target: SignInTarget): boolean {
  if (scan.signals.loginWall) return false;
  let current: URL;
  try {
    current = new URL(scan.signals.url);
  } catch {
    return false;
  }
  return bareHost(current.hostname) === target.host && !current.pathname.startsWith(new URL(target.loginUrl).pathname);
}

async function waitForSignIn(page: Page, target: SignInTarget): Promise<boolean> {
  const deadline = Date.now() + WAIT_MINUTES * MS_PER_MINUTE;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (page.isClosed()) return false;
    const scan = await scanPage(page).catch(() => null);
    if (scan && hasLeftLoginPage(scan, target)) return true;
  }
  return false;
}

async function runSignIn(target: SignInTarget): Promise<boolean> {
  const page = await openApplyPage();
  try {
    await page.goto(target.loginUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront().catch(() => undefined);
    const signedIn = await waitForSignIn(page, target);
    markSignedIn(target.host, signedIn);
    return signedIn;
  } finally {
    releasePage(page);
  }
}

export function signInToBoard(target: SignInTarget): Promise<boolean> {
  const running = signInsInFlight.get(target.host);
  if (running) return running;
  const attempt = runSignIn(target).finally(() => signInsInFlight.delete(target.host));
  signInsInFlight.set(target.host, attempt);
  return attempt;
}
