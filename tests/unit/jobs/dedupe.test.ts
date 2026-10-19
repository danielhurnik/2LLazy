import { describe, it, expect } from "vitest";
import { canonicalUrl, contentHash, dedupeRepeatedHalf, jobKey, normalizeText } from "@/lib/jobs/dedupe";

describe("canonicalUrl", () => {
  it("strips Jobs.cz search-session params so one posting maps to one row", () => {
    expect(canonicalUrl("https://www.jobs.cz/rpd/2001441286/?searchId=de5f7696-2bd9&rps=233")).toBe(
      "https://www.jobs.cz/rpd/2001441286/",
    );
  });

  it("drops utm_* and tracking params, keeps meaningful ones, sorts the rest", () => {
    expect(canonicalUrl("https://example.com/job?b=2&utm_source=x&a=1&fbclid=abc#apply")).toBe(
      "https://example.com/job?a=1&b=2",
    );
  });

  it("lower-cases the host and leaves the path untouched", () => {
    expect(canonicalUrl("HTTPS://WWW.Example.COM/Job/ABC/")).toBe("https://www.example.com/Job/ABC/");
  });

  it("returns non-URLs trimmed", () => {
    expect(canonicalUrl("  not a url ")).toBe("not a url");
  });
});

describe("normalizeText", () => {
  it("folds diacritics, case and punctuation", () => {
    expect(normalizeText("Plzeň — Senior React.js Developer!")).toBe("plzen senior react js developer");
  });
});

describe("jobKey / contentHash", () => {
  it("builds the same key for the same opening on different boards", () => {
    const a = jobKey({ company: "Ticketportal + GoOut", title: "QA Engineer", city: "Praha" });
    const b = jobKey({ company: "ticketportal goout", title: "qa engineer", city: "PRAHA" });
    expect(a).toBe(b);
  });

  it("ignores whitespace/markup noise in the content hash", () => {
    expect(contentHash("Hello,   World!\n")).toBe(contentHash("hello world"));
    expect(contentHash("hello world")).not.toBe(contentHash("hello there"));
  });
});

describe("dedupeRepeatedHalf", () => {
  it("collapses doubled titles some boards render", () => {
    expect(dedupeRepeatedHalf("React DeveloperReact Developer")).toBe("React Developer");
    expect(dedupeRepeatedHalf("React Developer")).toBe("React Developer");
    expect(dedupeRepeatedHalf(null)).toBe("");
  });
});
