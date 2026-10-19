import path from "path";
import type { BrowserContext, Page } from "playwright";

const ISOLATED_PERSISTENT_PROFILE_DIR = process.env.APPLY_PROFILE_DIR ?? path.resolve(process.cwd(), ".apply-profile");
const HEADLESS = process.env.APPLY_HEADLESS === "true";

export class ApplyMutex {
  private held = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.held) {
      this.held = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.held = false;
  }

  get queued(): number {
    return this.waiters.length;
  }
}

const hotReloadSafeGlobals = globalThis as unknown as {
  applyBrowserContext?: Promise<BrowserContext> | null;
  applyMutex?: ApplyMutex;
  applyBusyPages?: Set<Page>;
};

export const applyMutex = (hotReloadSafeGlobals.applyMutex ??= new ApplyMutex());
const busyPages = (hotReloadSafeGlobals.applyBusyPages ??= new Set<Page>());

export function markPageBusy(page: Page): void {
  busyPages.add(page);
}

export function releasePage(page: Page): void {
  busyPages.delete(page);
}

async function launchOnce(): Promise<BrowserContext> {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(ISOLATED_PERSISTENT_PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    locale: "cs-CZ",
    timezoneId: "Europe/Prague",
    args: ["--disable-blink-features=AutomationControlled"],
    ignoreDefaultArgs: ["--enable-automation"],
  });
}

async function launchContext(): Promise<BrowserContext> {
  let context: BrowserContext;
  try {
    context = await launchOnce();
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try {
      context = await launchOnce();
    } catch {
      throw first;
    }
  }
  context.on("close", () => {
    hotReloadSafeGlobals.applyBrowserContext = null;
  });
  const close = () => context.close().catch(() => {});
  process.once("exit", close);
  process.once("SIGINT", close);
  return context;
}

function getApplyContext(): Promise<BrowserContext> {
  if (!hotReloadSafeGlobals.applyBrowserContext) {
    hotReloadSafeGlobals.applyBrowserContext = launchContext().catch((err) => {
      hotReloadSafeGlobals.applyBrowserContext = null;
      throw err;
    });
  }
  return hotReloadSafeGlobals.applyBrowserContext;
}

const MAX_LINGERING_PAGES = 2;

export async function openApplyPage(): Promise<Page> {
  const context = await getApplyContext();
  const lingering = context.pages().filter((p) => p.url() !== "about:blank" && !busyPages.has(p));
  for (const stale of lingering.slice(0, Math.max(0, lingering.length - MAX_LINGERING_PAGES))) {
    await stale.close().catch(() => undefined);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(45_000);
  markPageBusy(page);
  return page;
}

export async function withApplyLock<T>(task: () => Promise<T>): Promise<T> {
  await applyMutex.acquire();
  try {
    return await task();
  } finally {
    applyMutex.release();
  }
}
