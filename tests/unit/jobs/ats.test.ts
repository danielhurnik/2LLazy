import { describe, it, expect } from "vitest";
import type { Employer } from "@/lib/jobs/config";
import { employerFor, locatedInCountry, mentionsQuery } from "@/lib/jobs/sources/ats";
import type { SearchRequest } from "@/lib/jobs/sources/types";
import { lookupIntent } from "@/lib/queryIntent";
import { parsePostings } from "@/lib/jobs/sources/atsAdapters";

const employer = (ats: Employer["ats"]): Employer => ({ ats, slug: "acme", name: "Acme" });

describe("ATS adapters", () => {
  it("maps a Greenhouse board, decoding the escaped description and merging offices", () => {
    const [job] = parsePostings(
      "greenhouse",
      {
        jobs: [
          {
            id: 1,
            title: "React Developer",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
            location: { name: "Prague, Czechia" },
            offices: [{ name: "Prague" }],
            content: "&lt;p&gt;Build &amp; ship&lt;/p&gt;",
            updated_at: "2026-10-01T00:00:00Z",
          },
        ],
      },
      employer("greenhouse"),
    );
    expect(job).toMatchObject({ title: "React Developer", location: "Prague, Czechia", description: "Build & ship", remote: false });
    expect(job.postedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("maps Lever, Ashby, Recruitee and Workable payloads", () => {
    const [leverJob] = parsePostings(
      "lever",
      [
        {
          id: "a",
          text: "Backend Engineer",
          hostedUrl: "https://jobs.lever.co/acme/a",
          categories: { location: "Remote - Europe" },
          descriptionPlain: "Go services",
          workplaceType: "remote",
          createdAt: 1700000000000,
          salaryRange: { min: 80000, max: 100000, currency: "EUR" },
        },
      ],
      employer("lever"),
    );
    expect(leverJob).toMatchObject({ title: "Backend Engineer", remote: true, salary: "80000 - 100000 EUR", description: "Go services" });

    const [ashbyJob] = parsePostings(
      "ashby",
      {
        jobs: [
          {
            id: "b",
            title: "Data Engineer",
            jobUrl: "https://jobs.ashbyhq.com/acme/b",
            location: "Brno",
            isRemote: false,
            descriptionHtml: "<p>Pipelines</p>",
            compensation: { compensationTierSummary: "€60K – €80K" },
          },
        ],
      },
      employer("ashby"),
    );
    expect(ashbyJob).toMatchObject({ location: "Brno", description: "Pipelines", salary: "€60K – €80K" });

    const [recruiteeJob] = parsePostings(
      "recruitee",
      {
        offers: [
          {
            id: 7,
            title: "QA Engineer",
            careers_url: "https://acme.recruitee.com/o/qa",
            city: "Praha",
            country: "Czech Republic",
            remote: true,
            description: "<p>Test things</p>",
            requirements: "<ul><li>Playwright</li></ul>",
          },
        ],
      },
      employer("recruitee"),
    );
    expect(recruiteeJob).toMatchObject({ location: "Praha, Czech Republic", remote: true });
    expect(recruiteeJob.description).toContain("Playwright");

    const [workableJob] = parsePostings(
      "workable",
      {
        jobs: [
          {
            shortcode: "X1",
            title: "PM",
            url: "https://apply.workable.com/acme/j/X1",
            city: "Ostrava",
            country: "Czechia",
            telecommuting: false,
            description: "<p>Own the roadmap</p>",
          },
        ],
      },
      employer("workable"),
    );
    expect(workableJob).toMatchObject({ title: "PM", location: "Ostrava, Czechia", description: "Own the roadmap" });
  });

  it("builds SmartRecruiters URLs and leaves the description for the detail call", () => {
    const [job] = parsePostings(
      "smartrecruiters",
      {
        content: [
          {
            id: "123",
            name: "DevOps",
            location: { city: "Prague", country: "cz", remote: false },
            company: { identifier: "Acme" },
            releasedDate: "2026-09-30T00:00:00Z",
          },
        ],
      },
      employer("smartrecruiters"),
    );
    expect(job).toMatchObject({ url: "https://jobs.smartrecruiters.com/Acme/123", description: "", location: "Prague, cz" });
  });

  it("skips entries without a title or URL", () => {
    const parsed = parsePostings("greenhouse", { jobs: [{ title: "", absolute_url: "x" }, { title: "T" }] }, employer("greenhouse"));
    expect(parsed).toEqual([]);
  });
});

describe("locatedInCountry", () => {
  const posting = (location: string, remote = false) => ({ location, remote });

  it("accepts Czech cities, the country name and remote roles", () => {
    expect(locatedInCountry(posting("Prague, Czechia"), "CZ")).toBe(true);
    expect(locatedInCountry(posting("Brno"), "CZ")).toBe(true);
    expect(locatedInCountry(posting("Czech Republic"), "CZ")).toBe(true);
    expect(locatedInCountry(posting("Remote - EMEA", true), "CZ")).toBe(true);
  });

  it("rejects other countries, including remote roles tied to one other country", () => {
    expect(locatedInCountry(posting("Berlin, Germany"), "CZ")).toBe(false);
    expect(locatedInCountry(posting("Remote, United Kingdom", true), "CZ")).toBe(false);
    expect(locatedInCountry(posting("Netherlands (Remote)", true), "CZ")).toBe(false);
  });

  it("accepts unqualified or Europe-wide remote roles", () => {
    expect(locatedInCountry(posting("Remote", true), "CZ")).toBe(true);
    expect(locatedInCountry(posting("Europe", true), "CZ")).toBe(true);
    expect(locatedInCountry(posting("Remote, Global", true), "CZ")).toBe(true);
  });
});

describe("mentionsQuery", () => {
  const request = (query: string): SearchRequest => ({
    query,
    skillLevel: "Any",
    deepSearch: false,
    city: "",
    country: "CZ",
    intent: lookupIntent(query),
    salaryMin: null,
    salaryMax: null,
  });

  it("requires every query token in the description", () => {
    expect(mentionsQuery({ description: "We build the dashboard in React and TypeScript." }, request("React"))).toBe(true);
    expect(mentionsQuery({ description: "We build the dashboard in React." }, request("React Native"))).toBe(false);
  });
});

describe("employerFor", () => {
  it("finds the configured employer by company name, then by slug in the URL", () => {
    expect(employerFor({ url: "https://jobs.example/1", company: "jetbrains" }, "CZ")).toMatchObject({ ats: "greenhouse", slug: "jetbrains" });
    expect(employerFor({ url: "https://boards.greenhouse.io/jetbrains/jobs/1", company: "" }, "CZ")).toMatchObject({ slug: "jetbrains" });
    expect(employerFor({ url: "https://jobs.example/1", company: "Nobody" }, "CZ")).toBeUndefined();
  });
});
