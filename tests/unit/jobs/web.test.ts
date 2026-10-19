import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { jobPostingsIn } from "@/lib/jobs/sources/jsonld";
import { hopLinks, isWorthVisiting, locatedInCountryOrUnknown, searchQueries, searchResults } from "@/lib/jobs/sources/web";
import { lookupIntent } from "@/lib/queryIntent";

const SEARCH_PAGE = `
<div class="results">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcareers.example.cz%2Fjobs%2Freact-developer&amp;rut=abc">React Developer – Example</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.jobs.cz%2Frpd%2F123%2F&amp;rut=def">React vývojář | Jobs.cz</a>
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcareers.example.cz%2Fjobs%2Freact-developer&amp;rut=dup">Duplicate</a>
  <a class="result__a" href="https://cz.indeed.com/q-react-brno.html">React jobs - Indeed</a>
</div>`;

const JOB_PAGE = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Example"},
{"@type":"JobPosting","title":"React Developer","description":"<p>Build the <b>dashboard</b>.</p>","datePosted":"2026-10-01",
"hiringOrganization":{"@type":"Organization","name":"Example s.r.o."},
"jobLocation":[{"@type":"Place","address":{"addressLocality":"Brno","addressCountry":"CZ"}}],
"baseSalary":{"@type":"MonetaryAmount","currency":"CZK","value":{"minValue":70000,"maxValue":90000,"unitText":"MONTH"}}}]}</script>
<script type="application/ld+json">not json</script>
</head><body></body></html>`;

describe("searchResults", () => {
  it("decodes redirect targets, keeps titles and drops duplicates", () => {
    const results = searchResults(SEARCH_PAGE);
    expect(results.map((result) => result.url)).toEqual([
      "https://careers.example.cz/jobs/react-developer",
      "https://www.jobs.cz/rpd/123/",
      "https://cz.indeed.com/q-react-brno.html",
    ]);
    expect(results[0].title).toBe("React Developer – Example");
  });

  it("skips boards that are already sources and sites without readable postings", () => {
    expect(isWorthVisiting("https://careers.example.cz/jobs/1")).toBe(true);
    expect(isWorthVisiting("https://www.jobs.cz/rpd/123/")).toBe(false);
    expect(isWorthVisiting("https://cz.indeed.com/q-react.html")).toBe(false);
    expect(isWorthVisiting("mailto:jobs@example.cz")).toBe(false);
  });
});

describe("hopLinks", () => {
  const LISTING_PAGE = `<html><body>
    <a href="/nabidka/react-developer-brno-123">React Developer, Brno</a>
    <a href="https://aggregator.cz/nabidka/react-developer-praha-456#apply">React vývojář Praha</a>
    <a href="/nabidka/java-developer-789">Java Developer</a>
    <a href="https://other.cz/react-developer">React elsewhere</a>
    <a href="/react-developer-brno/">current page</a>
    <a href="/nabidka/senior-react-999">Senior React</a>
  </body></html>`;

  it("keeps same-host links whose text or path mentions the query, without fragments, up to the limit", () => {
    const $ = cheerio.load(LISTING_PAGE);
    expect(hopLinks($, "https://aggregator.cz/react-developer-brno/", "React developer", 2)).toEqual([
      "https://aggregator.cz/nabidka/react-developer-brno-123",
      "https://aggregator.cz/nabidka/react-developer-praha-456",
    ]);
    expect(hopLinks($, "https://aggregator.cz/react-developer-brno/", "React developer", 10)).not.toContain(
      "https://aggregator.cz/nabidka/java-developer-789",
    );
  });
});

describe("searchQueries", () => {
  it("adds a localized phrasing next to the English one", () => {
    const queries = searchQueries({
      query: "React developer",
      skillLevel: "Any",
      deepSearch: false,
      city: "Brno",
      country: "CZ",
      intent: lookupIntent("React developer"),
      salaryMin: null,
      salaryMax: null,
    });
    expect(queries).toEqual(["React developer Brno (job OR práce OR kariéra OR careers)", "React vývojář Brno nabídka práce"]);
  });
});

describe("jobPostingsIn", () => {
  it("reads a JobPosting out of an @graph and ignores unparsable blocks", () => {
    const [posting] = jobPostingsIn(cheerio.load(JOB_PAGE));
    expect(posting).toMatchObject({
      title: "React Developer",
      company: "Example s.r.o.",
      location: "Brno, CZ",
      description: "Build the dashboard.",
      salary: "70000 - 90000 CZK / month",
      remote: false,
    });
    expect(posting.postedAt).toEqual(new Date("2026-10-01"));
  });

  it("returns nothing for pages without a JobPosting", () => {
    expect(jobPostingsIn(cheerio.load("<html><body><h1>About us</h1></body></html>"))).toEqual([]);
  });
});

describe("locatedInCountryOrUnknown", () => {
  it("keeps Czech, remote and unlocated postings and drops foreign ones", () => {
    expect(locatedInCountryOrUnknown({ location: "Brno, CZ", remote: false }, "CZ")).toBe(true);
    expect(locatedInCountryOrUnknown({ location: "", remote: false }, "CZ")).toBe(true);
    expect(locatedInCountryOrUnknown({ location: "Berlin, DE", remote: true }, "CZ")).toBe(true);
    expect(locatedInCountryOrUnknown({ location: "Berlin, DE", remote: false }, "CZ")).toBe(false);
  });
});
