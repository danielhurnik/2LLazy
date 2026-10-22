import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { PageScan } from "@/lib/apply/fieldScanner";
import type { ApplyContext, ApplyEvent } from "@/lib/apply/types";

vi.mock("@/lib/prisma", () => ({ prisma: { applyObstacle: { create: vi.fn().mockResolvedValue({}) } } }));
vi.mock("@/lib/apply/fieldScanner", () => ({ scanPage: vi.fn() }));

import { scanPage } from "@/lib/apply/fieldScanner";
import { requestResume, waitForHuman, waitingReason } from "@/lib/apply/humanWait";
import { ApplyAbort } from "@/lib/apply/types";

const APPLICATION_ID = "cwaitfortest0001";
const POLL_MS = 2_000;
const WAIT_LIMIT_MS = 15 * 60_000;

function captchaScan(): PageScan {
  return {
    frames: [],
    fields: [],
    buttons: [],
    signals: { url: "https://www.jobstack.it/jobpostreply/1", title: "", captcha: "g-recaptcha", loginWall: false, stepHints: [], bodyText: "", errors: [] },
  };
}

function fakeContext() {
  const events: ApplyEvent[] = [];
  const lock = { release: vi.fn(), acquire: vi.fn().mockResolvedValue(undefined) };
  let closed = false;
  const page = {
    isClosed: () => closed,
    close: () => {
      closed = true;
    },
    frames: () => [],
    context: () => ({ pages: () => [page] }),
    bringToFront: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(false),
    url: () => "https://www.jobstack.it/jobpostreply/1",
  } as unknown as Page;
  const ctx = {
    applicationId: APPLICATION_ID,
    page,
    profile: {},
    job: { id: "job1" },
    evidence: { screenshot: vi.fn().mockResolvedValue(null), log: vi.fn(), urlFor: () => "" },
    emit: (event: ApplyEvent) => events.push(event),
    setWaiting: vi.fn().mockResolvedValue(undefined),
    lock,
    pages: new Set<Page>(),
    autoSubmit: true,
  } as unknown as ApplyContext;
  return { ctx, lock, events };
}

describe("waitForHuman", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(scanPage).mockResolvedValue(captchaScan());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases the lock while waiting, resumes on Continue and re-acquires it", async () => {
    const { ctx, lock, events } = fakeContext();
    const pending = waitForHuman(ctx, "captcha");
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(waitingReason(APPLICATION_ID)).toBe("captcha");
    expect(requestResume(APPLICATION_ID)).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    const scan = await pending;
    expect(scan.signals.captcha).toBe("g-recaptcha");
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.type)).toEqual(["waiting", "resumed"]);
    expect(waitingReason(APPLICATION_ID)).toBeNull();
    expect(ctx.setWaiting).toHaveBeenLastCalledWith(null);
  });

  it("resumes on its own when the page no longer shows the blocker", async () => {
    const { ctx, events } = fakeContext();
    const pending = waitForHuman(ctx, "captcha");
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    vi.mocked(scanPage).mockResolvedValue({ ...captchaScan(), signals: { ...captchaScan().signals, captcha: null } });
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    const scan = await pending;
    expect(scan.signals.captcha).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["waiting", "resumed"]);
  });

  it("fails the run when the apply window is closed while waiting", async () => {
    const { ctx, lock } = fakeContext();
    const pending = waitForHuman(ctx, "captcha");
    const outcome = pending.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    (ctx.page as unknown as { close: () => void }).close();
    await vi.advanceTimersByTimeAsync(POLL_MS + 100);
    const err = await outcome;
    expect(err).toBeInstanceOf(ApplyAbort);
    expect((err as ApplyAbort).status).toBe("FAILED");
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(waitingReason(APPLICATION_ID)).toBeNull();
  });

  it("gives up as NEEDS_MANUAL after the wait limit with the lock held again", async () => {
    const { ctx, lock } = fakeContext();
    const pending = waitForHuman(ctx, "captcha");
    const outcome = pending.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(WAIT_LIMIT_MS + POLL_MS * 2);
    const err = await outcome;
    expect(err).toBeInstanceOf(ApplyAbort);
    expect((err as ApplyAbort).status).toBe("NEEDS_MANUAL");
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(waitingReason(APPLICATION_ID)).toBeNull();
  });
});
