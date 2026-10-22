import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Page } from "playwright";
import { SIGN_IN_HOSTS, hasLeftLoginPage, isSignedIn, markSignedIn, signInHosts, signInTargetFor, startSignIn } from "@/lib/apply/boardSignIn";
import { openApplyPage, releasePage } from "@/lib/apply/browser";
import { scanPage, type PageScan } from "@/lib/apply/fieldScanner";

vi.mock("@/lib/apply/browser", () => ({ openApplyPage: vi.fn(), releasePage: vi.fn() }));
vi.mock("@/lib/apply/fieldScanner", () => ({ scanPage: vi.fn() }));

const JOBSTACK = "jobstack.it";
const JOBSTACK_LOGIN = "https://www.jobstack.it/login";
const JOBSTACK_HOME = "https://www.jobstack.it/";
const POLL_MS = 2_000;

function scanAt(url: string, loginWall = false): PageScan {
  return {
    frames: [],
    fields: [],
    buttons: [],
    signals: { url, title: "", captcha: null, loginWall, stepHints: [], bodyText: "", errors: [] },
  };
}

const jobstackTarget = () => {
  const target = signInTargetFor(JOBSTACK);
  if (!target) throw new Error("jobstack.it is missing from SIGN_IN_HOSTS");
  return target;
};

describe("sign-in host map", () => {
  beforeEach(() => {
    for (const target of SIGN_IN_HOSTS) markSignedIn(target.host, false);
  });

  it("lists jobstack.it first with its login page, signed out and idle", () => {
    expect(signInHosts()[0]).toEqual({ host: JOBSTACK, loginUrl: JOBSTACK_LOGIN, signedIn: false, pending: false });
  });

  it("resolves a host with or without www and in any case", () => {
    expect(signInTargetFor("www.jobstack.it")?.host).toBe(JOBSTACK);
    expect(signInTargetFor(" JobStack.IT ")?.host).toBe(JOBSTACK);
  });

  it("rejects hosts it has no sign-in page for", () => {
    expect(signInTargetFor("www.jobs.cz")).toBeNull();
    expect(signInTargetFor("")).toBeNull();
    expect(signInTargetFor("evil.jobstack.it.example.test")).toBeNull();
  });

  it("remembers a sign-in under the bare host", () => {
    markSignedIn("www.jobstack.it", true);
    expect(isSignedIn(JOBSTACK)).toBe(true);
    expect(signInHosts().find((entry) => entry.host === JOBSTACK)?.signedIn).toBe(true);
    markSignedIn(JOBSTACK, false);
    expect(isSignedIn("www.jobstack.it")).toBe(false);
  });

  it("ignores unknown hosts", () => {
    markSignedIn("www.jobs.cz", true);
    expect(isSignedIn("www.jobs.cz")).toBe(false);
    expect(signInHosts().map((entry) => entry.host)).not.toContain("jobs.cz");
  });
});

describe("hasLeftLoginPage", () => {
  it("waits while the login page is still open", () => {
    expect(hasLeftLoginPage(scanAt(JOBSTACK_LOGIN), jobstackTarget())).toBe(false);
    expect(hasLeftLoginPage(scanAt(`${JOBSTACK_LOGIN}?error=1`), jobstackTarget())).toBe(false);
  });

  it("counts a board page outside the login path as signed in", () => {
    expect(hasLeftLoginPage(scanAt("https://www.jobstack.it/"), jobstackTarget())).toBe(true);
    expect(hasLeftLoginPage(scanAt("https://www.jobstack.it/muj-profil"), jobstackTarget())).toBe(true);
  });

  it("keeps waiting during a Facebook or LinkedIn sign-in", () => {
    expect(hasLeftLoginPage(scanAt("https://www.facebook.com/login.php"), jobstackTarget())).toBe(false);
    expect(hasLeftLoginPage(scanAt("https://www.linkedin.com/oauth/v2/authorization"), jobstackTarget())).toBe(false);
  });

  it("keeps waiting while the page still shows a login wall", () => {
    expect(hasLeftLoginPage(scanAt("https://www.jobstack.it/", true), jobstackTarget())).toBe(false);
  });

  it("keeps waiting on an unreadable URL", () => {
    expect(hasLeftLoginPage(scanAt("about:blank"), jobstackTarget())).toBe(false);
    expect(hasLeftLoginPage(scanAt(""), jobstackTarget())).toBe(false);
  });
});

function fakePage() {
  let closed = false;
  return {
    goto: vi.fn().mockResolvedValue(null),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn(() => closed),
    close: vi.fn(async () => {
      closed = true;
    }),
    closeByUser: () => {
      closed = true;
    },
  };
}

const jobstackEntry = () => signInHosts().find((entry) => entry.host === JOBSTACK);

describe("startSignIn", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    markSignedIn(JOBSTACK, false);
    vi.mocked(scanPage).mockResolvedValue(scanAt(JOBSTACK_LOGIN));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns once the login page is open and reports progress through the host list", async () => {
    const page = fakePage();
    vi.mocked(openApplyPage).mockResolvedValue(page as unknown as Page);

    await startSignIn(jobstackTarget());
    expect(page.goto).toHaveBeenCalledWith(JOBSTACK_LOGIN, { waitUntil: "domcontentloaded" });
    expect(jobstackEntry()).toMatchObject({ signedIn: false, pending: true });

    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    expect(jobstackEntry()).toMatchObject({ signedIn: false, pending: true });

    vi.mocked(scanPage).mockResolvedValue(scanAt(JOBSTACK_HOME));
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    expect(jobstackEntry()).toMatchObject({ signedIn: true, pending: false });
    expect(page.close).toHaveBeenCalledOnce();
    expect(releasePage).toHaveBeenCalledWith(page);
  });

  it("reuses the open window for a second request", async () => {
    const page = fakePage();
    vi.mocked(openApplyPage).mockResolvedValue(page as unknown as Page);
    await startSignIn(jobstackTarget());
    await startSignIn(jobstackTarget());
    expect(openApplyPage).toHaveBeenCalledOnce();
    page.closeByUser();
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
  });

  it("brings the window forward again on the first polls", async () => {
    const page = fakePage();
    vi.mocked(openApplyPage).mockResolvedValue(page as unknown as Page);
    await startSignIn(jobstackTarget());
    await vi.advanceTimersByTimeAsync(3 * POLL_MS + 100);
    expect(page.bringToFront).toHaveBeenCalledTimes(3);
    page.closeByUser();
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
  });

  it("stops without signing in when the user closes the window", async () => {
    const page = fakePage();
    vi.mocked(openApplyPage).mockResolvedValue(page as unknown as Page);
    await startSignIn(jobstackTarget());
    page.closeByUser();
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    expect(jobstackEntry()).toMatchObject({ signedIn: false, pending: false });
    expect(page.close).not.toHaveBeenCalled();
  });

  it("rejects and frees the host when the window cannot open", async () => {
    vi.mocked(openApplyPage).mockRejectedValue(new Error("Chrome failed to start"));
    await expect(startSignIn(jobstackTarget())).rejects.toThrow("Chrome failed to start");
    await vi.advanceTimersByTimeAsync(0);
    expect(jobstackEntry()?.pending).toBe(false);
  });
});
