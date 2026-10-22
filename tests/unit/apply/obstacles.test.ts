import { describe, it, expect } from "vitest";
import { hostOf, summariseObstacles } from "@/lib/apply/obstacles";

describe("obstacle summary", () => {
  it("normalises hosts", () => {
    expect(hostOf("https://www.jobstack.it/it-job/x")).toBe("jobstack.it");
    expect(hostOf("not a url")).toBe("");
  });

  it("counts distinct applications per kind, not rows, and names a different blocker host", () => {
    const summary = summariseObstacles("cocuma.cz", 3, [
      { kind: "CAPTCHA", host: "dateio.bamboohr.com", applicationId: "a1" },
      { kind: "CAPTCHA", host: "dateio.bamboohr.com", applicationId: "a1" },
      { kind: "CAPTCHA", host: "dateio.bamboohr.com", applicationId: "a2" },
      { kind: "LOGIN", host: "cocuma.cz", applicationId: "a3" },
    ]);
    expect(summary).toEqual({ host: "cocuma.cz", attempts: 3, captchas: 2, logins: 1, blockerHost: "dateio.bamboohr.com" });
  });

  it("returns null without attempts and no blocker host when the board itself blocks", () => {
    expect(summariseObstacles("jobstack.it", 0, [])).toBeNull();
    const summary = summariseObstacles("jobstack.it", 2, [
      { kind: "CAPTCHA", host: "jobstack.it", applicationId: "a1" },
      { kind: "CAPTCHA", host: "jobstack.it", applicationId: "a1" },
    ]);
    expect(summary?.captchas).toBe(1);
    expect(summary?.blockerHost).toBeNull();
  });
});
