import { beforeEach, describe, it, expect } from "vitest";
import { SIGN_IN_HOSTS, hasLeftLoginPage, isSignedIn, markSignedIn, signInHosts, signInTargetFor } from "@/lib/apply/boardSignIn";
import type { PageScan } from "@/lib/apply/fieldScanner";

const JOBSTACK = "jobstack.it";
const JOBSTACK_LOGIN = "https://www.jobstack.it/login";

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

  it("lists jobstack.it first with its login page and signed out", () => {
    expect(signInHosts()[0]).toEqual({ host: JOBSTACK, loginUrl: JOBSTACK_LOGIN, signedIn: false });
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
