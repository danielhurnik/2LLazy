import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { boardFormApplyPath, contactEmail, emailApplyPath, emailsInHtml, emailsInText } from "@/lib/jobs/sources/contact";

const POSTING_PAGE = `<html><body>
<header><a href="mailto:info@jobs.cz">info@jobs.cz</a></header>
<nav>Menu</nav>
<main>
  <h1>React developer</h1>
  <p>Životopis pošlete na <a href="mailto:Kariera@Firma.cz?subject=React%20developer">kariéra</a>.</p>
  <p>Dotazy: HR@firma.cz nebo noreply@firma.cz</p>
  <p>Logo: logo@2x.png</p>
  <p>GDPR: gdpr@firma.cz</p>
</main>
<footer>podpora@prace.cz</footer>
</body></html>`;

describe("emailsInText", () => {
  it("finds unique lower-cased addresses and ignores file names", () => {
    expect(emailsInText("Pište na HR@Firma.cz, hr@firma.cz nebo logo@2x.png")).toEqual(["hr@firma.cz"]);
  });
});

describe("emailsInHtml", () => {
  it("reads mailto links before text addresses and skips header, nav and footer", () => {
    expect(emailsInHtml(cheerio.load(POSTING_PAGE))).toEqual(["kariera@firma.cz", "hr@firma.cz", "noreply@firma.cz", "gdpr@firma.cz"]);
  });
});

describe("contactEmail", () => {
  it("picks the first hiring mailbox", () => {
    expect(contactEmail(emailsInHtml(cheerio.load(POSTING_PAGE)))).toBe("kariera@firma.cz");
    expect(contactEmail(["", "mailto:Jobs@Example.cz"])).toBe("jobs@example.cz");
  });

  it("rejects system mailboxes and job-board operators", () => {
    expect(contactEmail(["noreply@firma.cz", "gdpr@firma.cz", "info@jobs.cz", "podpora@prace.cz", "hr@sub.lmc.eu"])).toBeUndefined();
  });
});

describe("apply paths", () => {
  it("builds an e-mail path only when an address survives", () => {
    const url = "https://firma.cz/kariera/react";
    expect(emailApplyPath(url, ["gdpr@firma.cz", "kariera@firma.cz"])).toEqual({ kind: "email", url, email: "kariera@firma.cz" });
    expect(emailApplyPath(url, ["gdpr@firma.cz"])).toBeUndefined();
    expect(boardFormApplyPath(url)).toEqual({ kind: "board-form", url });
  });
});
