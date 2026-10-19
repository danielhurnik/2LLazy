import path from "path";
import type { BrowserContext, Page } from "playwright";

const ISOLATED_PERSISTENT_PROFILE_DIR = process.env.APPLY_PROFILE_DIR ?? path.resolve(process.cwd(), ".apply-profile");
const HEADLESS = process.env.APPLY_HEADLESS === "true";

const hotReloadSafeGlobals = globalThis as unknown as {
  applyBrowserContext?: Promise<BrowserContext> | null;
  applyRunQueue?: Promise<unknown>;
};

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
  const lingering = context.pages().filter((p) => p.url() !== "about:blank");
  for (const stale of lingering.slice(0, Math.max(0, lingering.length - MAX_LINGERING_PAGES))) {
    await stale.close().catch(() => undefined);
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(45_000);
  return page;
}

export function withApplyLock<T>(task: () => Promise<T>): Promise<T> {
  const queue = hotReloadSafeGlobals.applyRunQueue ?? Promise.resolve();
  const run = queue.then(task, task);
  hotReloadSafeGlobals.applyRunQueue = run.catch(() => undefined);
  return run;
}
