import { describe, it, expect } from "vitest";
import { blockerMessage, blockingCaptcha, requestResume, waitingReason } from "@/lib/apply/humanWait";
import type { PageScan } from "@/lib/apply/fieldScanner";

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
  });

  it("tells the user what to do for each blocker", () => {
    expect(blockerMessage("captcha")).toMatch(/CAPTCHA/);
    expect(blockerMessage("login")).toMatch(/Sign in/);
  });
});
