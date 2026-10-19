import { describe, it, expect } from "vitest";
import { blockerMessage, blockingCaptcha, requestResume, requestResumeAll, waitingReason } from "@/lib/apply/humanWait";
import { ApplyMutex } from "@/lib/apply/browser";
import type { PageScan } from "@/lib/apply/fieldScanner";

describe("ApplyMutex", () => {
  it("hands the lock to waiters in order and lets a paused run release it", async () => {
    const mutex = new ApplyMutex();
    const order: string[] = [];
    await mutex.acquire();
    const second = mutex.acquire().then(() => order.push("second"));
    const third = mutex.acquire().then(() => order.push("third"));
    expect(mutex.queued).toBe(2);
    mutex.release();
    await second;
    expect(order).toEqual(["second"]);
    mutex.release();
    await third;
    expect(order).toEqual(["second", "third"]);
    mutex.release();
    expect(mutex.queued).toBe(0);
  });
});

function scanWithCaptcha(captcha: string | null): PageScan {
  return {
    frames: [],
    fields: [],
    buttons: [],
    signals: { url: "https://example.test/apply", title: "", captcha, loginWall: false, stepHints: [], bodyText: "", errors: [] },
  };
}

describe("humanWait", () => {
  it("treats a visible challenge as blocking but not the invisible reCAPTCHA badge", () => {
    expect(blockingCaptcha(scanWithCaptcha("https://www.google.com/recaptcha/api2/anchor?ar=1&k=abc"))).toBe(true);
    expect(blockingCaptcha(scanWithCaptcha("https://www.google.com/recaptcha/api2/anchor?size=invisible&k=abc"))).toBe(false);
    expect(blockingCaptcha(scanWithCaptcha(null))).toBe(false);
  });

  it("ignores Continue for a run that is not waiting", () => {
    expect(waitingReason("c123456789abc")).toBeNull();
    expect(requestResume("c123456789abc")).toBe(false);
    expect(requestResumeAll(["c123456789abc", "c987654321xyz"])).toBe(0);
  });

  it("tells the user what to do for each blocker", () => {
    expect(blockerMessage("captcha")).toMatch(/CAPTCHA/);
    expect(blockerMessage("login")).toMatch(/Sign in/);
  });
});
