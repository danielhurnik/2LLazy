import type { Page } from "playwright";
import { MS_PER_MINUTE } from "@/lib/time";
import { openApplyPage, releasePage } from "./browser";
import { scanPage, type PageScan } from "./fieldScanner";
import { POLL_MS, WAIT_MINUTES } from "./humanWait";

interface SignInTarget {
  host: string;
  loginUrl: string;
}

export const SIGN_IN_HOSTS: readonly SignInTarget[] = [{ host: "jobstack.it", loginUrl: "https://www.jobstack.it/login" }];

const REFOCUS_POLLS = 2;

const hotReloadSafeGlobals = globalThis as unknown as {
  applySignedInHosts?: Map<string, boolean>;
  applySignInsOpening?: Map<string, Promise<void>>;
};
const signedInHosts = (hotReloadSafeGlobals.applySignedInHosts ??= new Map<string, boolean>());
const signInsInFlight = (hotReloadSafeGlobals.applySignInsOpening ??= new Map<string, Promise<void>>());

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

export function signInHosts(): { host: string; loginUrl: string; signedIn: boolean; pending: boolean }[] {
  return SIGN_IN_HOSTS.map((target) => ({
    host: target.host,
    loginUrl: target.loginUrl,
    signedIn: isSignedIn(target.host),
    pending: signInsInFlight.has(target.host),
  }));
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
  for (let poll = 0; Date.now() < deadline; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (page.isClosed()) return false;
    if (poll < REFOCUS_POLLS) await page.bringToFront().catch(() => undefined);
    const scan = await scanPage(page).catch(() => null);
    if (scan && hasLeftLoginPage(scan, target)) return true;
  }
  return false;
}

async function openSignInPage(target: SignInTarget): Promise<Page> {
  const page = await openApplyPage();
  try {
    await page.goto(target.loginUrl, { waitUntil: "domcontentloaded" });
  } catch (err) {
    releasePage(page);
    throw err;
  }
  await page.bringToFront().catch(() => undefined);
  return page;
}

async function finishSignIn(page: Page, target: SignInTarget): Promise<void> {
  try {
    const signedIn = await waitForSignIn(page, target);
    markSignedIn(target.host, signedIn);
    if (signedIn) await page.close().catch(() => undefined);
  } finally {
    releasePage(page);
  }
}

export function startSignIn(target: SignInTarget): Promise<void> {
  const running = signInsInFlight.get(target.host);
  if (running) return running;
  const opening = openSignInPage(target);
  const opened = opening.then(() => undefined);
  signInsInFlight.set(target.host, opened);
  opening
    .then((page) => finishSignIn(page, target))
    .catch(() => undefined)
    .finally(() => signInsInFlight.delete(target.host));
  return opened;
}
