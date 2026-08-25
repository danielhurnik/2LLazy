/**
 * Deterministic extraction tests.
 *
 * These are the tests that decide whether removing the model was viable. If
 * JSON-LD parsing and the fallback layers hold up on real-world markup shapes,
 * the scraper does not need anything smarter than this.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJob, extractJobFromText, cleanTitle } from "@/lib/scrapers/extract";
import { parseJobPostingLd, parseJobPostingMicrodata } from "@/lib/scrapers/parse/jsonld";
import { selectJobLinks, canonicaliseUrl, titleFromUrl } from "@/lib/scrapers/parse/listing";
import { parseDocument } from "@/lib/scrapers/fetcher";

const FIXTURES = join(process.cwd(), "tests/fixtures/pages");

function loadPage(name: string, url: string) {
  const html = readFileSync(join(FIXTURES, name), "utf8");
  return parseDocument(html, url);
}

describe("parseJobPostingLd", () => {
  it("reads every field out of a complete JobPosting", () => {
    const html = readFileSync(join(FIXTURES, "jsonld-job.html"), "utf8");
    const [posting] = parseJobPostingLd(html);

    expect(posting.title).toBe("Senior React Developer");
    expect(posting.company).toBe("Pixel Labs s.r.o.");
    expect(posting.locations[0]).toContain("Praha");
    expect(posting.country).toBe("CZ");
    expect(posting.salary).toMatchObject({ min: 90000, max: 130000, currency: "CZK", unit: "MONTH" });
    expect(posting.datePosted?.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(posting.remote).toBe(false);
  });

  it("unwraps @graph and tolerates an array @type", () => {
    const html = readFileSync(join(FIXTURES, "jsonld-graph.html"), "utf8");
    const [posting] = parseJobPostingLd(html);

    expect(posting.title).toBe("Backend Engineer");
    // hiringOrganization was a bare string, not an Organization object.
    expect(posting.company).toBe("Cargoline");
    expect(posting.remote).toBe(true);
    expect(posting.country).toBe("CZ");
  });

  it("keeps a valid block when a sibling block is malformed", () => {
    const html = readFileSync(join(FIXTURES, "jsonld-broken.html"), "utf8");
    const postings = parseJobPostingLd(html);

    // The trailing-comma block is repairable, so both may parse — what matters
    // is that the well-formed one is never lost.
    expect(postings.some((p) => p.title === "DevOps Engineer")).toBe(true);
  });

  it("returns an empty array rather than throwing on junk input", () => {
    expect(parseJobPostingLd("")).toEqual([]);
    expect(parseJobPostingLd("<html><body>no structured data</body></html>")).toEqual([]);
    expect(parseJobPostingLd('<script type="application/ld+json">not json</script>')).toEqual([]);
  });
});

describe("parseJobPostingMicrodata", () => {
  it("reads itemprop values", () => {
    const html = readFileSync(join(FIXTURES, "microdata-job.html"), "utf8");
    const [posting] = parseJobPostingMicrodata(html);

    expect(posting.title).toBe("QA Automation Engineer");
    expect(posting.company).toBe("Provenance");
    expect(posting.country).toBe("CZ");
    expect(posting.datePosted?.toISOString().slice(0, 10)).toBe("2026-07-20");
  });
});

describe("extractJob — layering", () => {
  it("prefers JSON-LD and reports it", () => {
    const page = loadPage("jsonld-job.html", "https://www.jobs.cz/rpd/2000123456/");
    const job = extractJob(page, { url: page.url, country: "CZ" });

    expect(job.via).toBe("jsonld");
    expect(job.confidence).toBeGreaterThan(0.9);
    expect(job.title).toBe("Senior React Developer");
    expect(job.company).toBe("Pixel Labs s.r.o.");
    expect(job.country).toBe("CZ");
    expect(job.salary).toContain("CZK");
    // The HTML description must arrive as readable text, not markup.
    expect(job.description).toContain("Senior React Developer");
    expect(job.description).not.toContain("<strong>");
  });

  it("marks a TELECOMMUTE posting as remote", () => {
    const page = loadPage("jsonld-graph.html", "https://www.startupjobs.cz/nabidka/77");
    const job = extractJob(page, { url: page.url, country: "CZ" });
    expect(job.workType).toBe("Remote");
  });

  it("falls back to microdata when there is no JSON-LD", () => {
    const page = loadPage("microdata-job.html", "https://example.org/job/qa");
    const job = extractJob(page, { url: page.url, country: "CZ" });

    expect(job.via).toBe("microdata");
    expect(job.title).toBe("QA Automation Engineer");
    expect(job.company).toBe("Provenance");
  });

  it("falls back to meta tags and heuristics", () => {
    const page = loadPage("meta-only.html", "https://handset.example/careers/flutter");
    const job = extractJob(page, { url: page.url, country: "CZ" });

    expect(job.title).toBe("Flutter Developer");
    expect(job.company).toBe("Handset");
    // Salary and work type come from the visible text, not structured data.
    expect(job.salary).not.toBe("");
    expect(job.workType).toBe("Remote");
    expect(["meta", "heuristic"]).toContain(job.via);
  });

  it("degrades to the hint rather than throwing on unusable input", () => {
    const job = extractJob(
      { html: "", text: "", url: "https://example.org/job/1" },
      { url: "https://example.org/job/1", title: "Fallback Title", country: "PL" },
    );
    expect(job.title).toBe("Fallback Title");
    expect(job.country).toBe("PL");
    expect(job.via).toBe("hint");
    expect(job.confidence).toBeLessThan(0.3);
  });

  it("never throws on truncated markup", () => {
    expect(() =>
      extractJob(
        { html: "<html><head><script type=\"application/ld+json\">{\"@type\":\"Job", text: "x", url: "https://a.b/job/1" },
        { url: "https://a.b/job/1" },
      ),
    ).not.toThrow();
  });
});

describe("cleanTitle", () => {
  it("strips board branding", () => {
    expect(cleanTitle("Senior React Developer | Jobs.cz")).toBe("Senior React Developer");
    expect(cleanTitle("Backend Engineer - StartupJobs")).toBe("Backend Engineer");
  });

  it("keeps a real qualifier that follows a separator", () => {
    expect(cleanTitle("Frontend Developer - React")).toBe("Frontend Developer - React");
  });

  it("collapses the doubled-heading artefact", () => {
    expect(cleanTitle("React DeveloperReact Developer")).toBe("React Developer");
  });

  it("handles empty input", () => {
    expect(cleanTitle("")).toBe("");
    expect(cleanTitle(null)).toBe("");
  });
});

describe("extractJobFromText", () => {
  it("finds a salary and work type in plain text", () => {
    const job = extractJobFromText(
      "Fully remote position. We pay 60 000 - 90 000 CZK per month.",
      { url: "https://a.b/job/1", title: "Developer" },
    );
    expect(job.workType).toBe("Remote");
    expect(job.salary).not.toBe("");
  });
});

describe("selectJobLinks", () => {
  it("uses card markup and prefers the card heading over the link text", () => {
    const page = loadPage("listing-cards.html", "https://board.example/jobs");
    const links = selectJobLinks(page, {
      cardSelector: ".job-item",
      urlPattern: /\/job\//i,
    });

    expect(links.map((l) => l.title)).toContain("Senior React Developer");
    expect(links.every((l) => l.title !== "Detail")).toBe(true);
  });

  it("dedupes the same posting reached by different URLs", () => {
    const page = loadPage("listing-cards.html", "https://board.example/jobs");
    const links = selectJobLinks(page, { cardSelector: ".job-item", urlPattern: /\/job\//i });
    const urls = links.map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
    // The tracking parameter must not create a second entry.
    expect(urls.some((u) => u.includes("utm_source"))).toBe(false);
  });

  it("excludes navigation, locale and utility links", () => {
    const page = loadPage("listing-cards.html", "https://board.example/jobs");
    const links = selectJobLinks(page, { cardSelector: ".job-item", urlPattern: /\/job\//i });
    const urls = links.map((l) => l.url).join(" ");
    expect(urls).not.toContain("/login");
    expect(urls).not.toContain("/about");
    expect(urls).not.toContain("/privacy");
  });

  it("falls back to the link list and derives a title from the slug", () => {
    const page = loadPage("listing-soup.html", "https://board.example/nabidky");
    const links = selectJobLinks(page, { urlPattern: /\/nabidka\// });

    expect(links).toHaveLength(2);
    expect(links[0].title).toBe("Backend Engineer");
    // Second link has no anchor text at all.
    expect(links[1].title).toBe("Data Engineer");
  });

  it("respects the limit", () => {
    const page = loadPage("listing-soup.html", "https://board.example/nabidky");
    expect(selectJobLinks(page, { urlPattern: /\/nabidka\//, limit: 1 })).toHaveLength(1);
  });
});

describe("URL helpers", () => {
  it("canonicalises tracking parameters and trailing slashes away", () => {
    expect(canonicaliseUrl("https://a.b/job/1/?utm_source=x&id=7#top")).toBe("https://a.b/job/1?id=7");
  });

  it("humanises a slug and drops the trailing id", () => {
    expect(titleFromUrl("https://a.b/job/senior-react-developer-1234")).toBe("Senior React Developer");
    expect(titleFromUrl("https://a.b/job/qa-engineer")).toBe("QA Engineer");
  });

  it("returns the input unchanged when it is not a URL", () => {
    expect(canonicaliseUrl("not a url")).toBe("not a url");
    expect(titleFromUrl("not a url")).toBe("");
  });
});
