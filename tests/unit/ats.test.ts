/**
 * ATS adapter tests.
 *
 * These matter unusually much: the endpoints cannot be reached from CI, so the
 * shapes below are the only check that each vendor's JSON is read correctly.
 * Every fixture mirrors the documented response for that platform, including
 * the awkward parts — Greenhouse HTML-escaping its descriptions, Lever calling
 * the title `text` and dating in epoch milliseconds, SmartRecruiters omitting
 * descriptions from the list endpoint entirely.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const responses = new Map<string, unknown>();
const calls: string[] = [];

vi.mock("@/lib/scrapers/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scrapers/fetcher")>();
  return {
    ...actual,
    fetchJson: async (url: string) => {
      calls.push(url);
      for (const [pattern, body] of responses) {
        if (url.includes(pattern)) {
          if (body instanceof Error) throw body;
          return body;
        }
      }
      throw new Error(`HTTP 404 for ${url}`);
    },
  };
});

const {
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  recruiteeAdapter,
  workableAdapter,
  ATS_ADAPTERS,
} = await import("@/lib/scrapers/boards/ats/adapters");
const { EMPLOYERS, employersForCountry, employersOn } = await import(
  "@/lib/scrapers/boards/ats/employers"
);
const { ATS_BOARDS } = await import("@/lib/scrapers/boards/ats");

const employer = (over = {}) =>
  ({ slug: "acme", name: "Acme", ats: "greenhouse", countries: ["CZ"], ...over }) as never;

beforeEach(() => {
  responses.clear();
  calls.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Greenhouse", () => {
  it("maps a posting, decoding the HTML-escaped description", async () => {
    responses.set("boards-api.greenhouse.io", {
      jobs: [
        {
          id: 1,
          title: "Senior React Developer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/1",
          updated_at: "2026-08-20T10:00:00Z",
          location: { name: "Prague, Czechia" },
          offices: [{ name: "Prague" }],
          departments: [{ name: "Engineering" }],
          // Greenhouse escapes the entire body into the JSON string.
          content: "&lt;p&gt;We need &lt;strong&gt;React&lt;/strong&gt; &amp; TypeScript.&lt;/p&gt;",
        },
      ],
    });

    const [job] = await greenhouseAdapter.fetchPostings(employer());
    expect(job.title).toBe("Senior React Developer");
    expect(job.url).toBe("https://boards.greenhouse.io/acme/jobs/1");
    // The office "Prague" is already covered by "Prague, Czechia".
    expect(job.location).toBe("Prague, Czechia");
    expect(job.department).toBe("Engineering");
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe("2026-08-20");
    // The description must arrive as readable text, not escaped markup.
    expect(job.description).toContain("React");
    expect(job.description).toContain("&");
    expect(job.description).not.toContain("&lt;");
    expect(job.description).not.toContain("<strong>");
  });

  it("requests the description explicitly", async () => {
    responses.set("boards-api.greenhouse.io", { jobs: [] });
    await greenhouseAdapter.fetchPostings(employer());
    expect(calls[0]).toContain("content=true");
    expect(calls[0]).toContain("/boards/acme/jobs");
  });

  it("flags a remote office", async () => {
    responses.set("boards-api.greenhouse.io", {
      jobs: [{ title: "Engineer", absolute_url: "https://x/1", location: { name: "Remote - EU" } }],
    });
    const [job] = await greenhouseAdapter.fetchPostings(employer());
    expect(job.remote).toBe(true);
  });
});

describe("Lever", () => {
  it("reads the title from `text` and the epoch-millisecond date", async () => {
    responses.set("api.lever.co", [
      {
        id: "abc",
        text: "Backend Engineer",
        hostedUrl: "https://jobs.lever.co/acme/abc",
        createdAt: 1755000000000,
        categories: { location: "Berlin", department: "Platform", commitment: "Full-time" },
        descriptionPlain: "Go and PostgreSQL.",
        workplaceType: "remote",
      },
    ]);

    const [job] = await leverAdapter.fetchPostings(employer({ ats: "lever" }));
    expect(job.title).toBe("Backend Engineer");
    expect(job.location).toBe("Berlin");
    expect(job.department).toBe("Platform");
    expect(job.employmentType).toBe("Full-time");
    expect(job.description).toBe("Go and PostgreSQL.");
    expect(job.remote).toBe(true);
    expect(job.postedAt?.getUTCFullYear()).toBe(2025);
  });

  it("asks for JSON explicitly", async () => {
    responses.set("api.lever.co", []);
    await leverAdapter.fetchPostings(employer({ ats: "lever" }));
    expect(calls[0]).toContain("mode=json");
  });

  it("falls back to the HTML description when there is no plain text", async () => {
    responses.set("api.lever.co", [
      { text: "Dev", hostedUrl: "https://x/1", description: "<p>Hello <b>world</b></p>" },
    ]);
    const [job] = await leverAdapter.fetchPostings(employer({ ats: "lever" }));
    expect(job.description).toContain("Hello");
    expect(job.description).not.toContain("<b>");
  });
});

describe("Ashby", () => {
  it("maps a posting and its compensation", async () => {
    responses.set("api.ashbyhq.com", {
      jobs: [
        {
          title: "Platform Engineer",
          jobUrl: "https://jobs.ashbyhq.com/acme/1",
          location: "Remote",
          secondaryLocations: ["Lisbon"],
          descriptionPlain: "Kubernetes and Terraform.",
          publishedAt: "2026-08-18T00:00:00Z",
          isRemote: true,
          employmentType: "FullTime",
          compensation: {
            summaryComponents: [
              {
                compensationType: "Salary",
                minValue: 90000,
                maxValue: 120000,
                currencyCode: "EUR",
                interval: "PER_YEAR",
              },
            ],
          },
        },
      ],
    });

    const [job] = await ashbyAdapter.fetchPostings(employer({ ats: "ashby" }));
    expect(job.title).toBe("Platform Engineer");
    expect(job.remote).toBe(true);
    expect(job.location).toContain("Lisbon");
    expect(job.salary).toMatch(/€|EUR/);
    expect(job.salary).toContain("90");
    expect(job.salary).toContain("120");
    expect(job.salary).toContain("year");
  });

  it("copes with a board that publishes no compensation", async () => {
    responses.set("api.ashbyhq.com", {
      jobs: [{ title: "Dev", jobUrl: "https://x/1", location: "Berlin" }],
    });
    const [job] = await ashbyAdapter.fetchPostings(employer({ ats: "ashby" }));
    expect(job.salary).toBeUndefined();
  });
});

describe("SmartRecruiters", () => {
  it("builds the public posting URL and joins the location", async () => {
    responses.set("api.smartrecruiters.com", {
      totalFound: 1,
      content: [
        {
          id: "743",
          name: "QA Engineer",
          location: { city: "Brno", region: "JM", country: "cz", remote: false },
          releasedDate: "2026-08-19T12:00:00.000Z",
          typeOfEmployment: { label: "Full-time" },
        },
      ],
    });

    const [job] = await smartRecruitersAdapter.fetchPostings(employer({ ats: "smartrecruiters" }));
    expect(job.title).toBe("QA Engineer");
    expect(job.url).toBe("https://jobs.smartrecruiters.com/acme/743");
    expect(job.location).toContain("Brno");
    expect(job.postedAt?.toISOString().slice(0, 10)).toBe("2026-08-19");
  });

  it("stops paging when the page is short", async () => {
    responses.set("api.smartrecruiters.com", {
      totalFound: 1,
      content: [{ id: "1", name: "Dev", location: {} }],
    });
    await smartRecruitersAdapter.fetchPostings(employer({ ats: "smartrecruiters" }));
    expect(calls).toHaveLength(1);
  });
});

describe("Recruitee", () => {
  it("uses the per-company subdomain and merges description with requirements", async () => {
    responses.set("recruitee.com", {
      offers: [
        {
          id: 5,
          title: "Frontend Developer",
          careers_url: "https://acme.recruitee.com/o/frontend-developer",
          city: "Prague",
          country: "Czech Republic",
          description: "<p>Build our UI.</p>",
          requirements: "<p>React, TypeScript.</p>",
          published_at: "2026-08-15",
          department: "Product",
          remote: false,
        },
      ],
    });

    const [job] = await recruiteeAdapter.fetchPostings(employer({ ats: "recruitee" }));
    expect(calls[0]).toBe("https://acme.recruitee.com/api/offers/");
    expect(job.title).toBe("Frontend Developer");
    expect(job.description).toContain("Build our UI");
    expect(job.description).toContain("React");
    expect(job.location).toContain("Prague");
  });
});

describe("Workable", () => {
  it("maps the widget payload", async () => {
    responses.set("apply.workable.com", {
      name: "Acme",
      jobs: [
        {
          title: "Data Engineer",
          shortcode: "ABC123",
          url: "https://apply.workable.com/acme/j/ABC123",
          city: "Warsaw",
          country: "Poland",
          telecommuting: true,
          employment_type: "Full-time",
          published_on: "2026-08-10",
          description: "<p>Airflow and dbt.</p>",
        },
      ],
    });

    const [job] = await workableAdapter.fetchPostings(employer({ ats: "workable" }));
    expect(job.title).toBe("Data Engineer");
    expect(job.remote).toBe(true);
    expect(job.location).toContain("Warsaw");
    expect(job.description).toContain("Airflow");
  });
});

describe("every adapter", () => {
  it("returns an empty array rather than throwing on an unreachable board", async () => {
    for (const adapter of ATS_ADAPTERS) {
      const result = await adapter.fetchPostings(employer({ ats: adapter.platform }));
      expect(result, adapter.platform).toEqual([]);
    }
  });

  it("returns an empty array on a payload of the wrong shape", async () => {
    for (const adapter of ATS_ADAPTERS) {
      responses.clear();
      responses.set("", { unexpected: true });
      const result = await adapter.fetchPostings(employer({ ats: adapter.platform }));
      expect(result, adapter.platform).toEqual([]);
    }
  });

  it("drops entries missing a title or a URL", async () => {
    responses.set("boards-api.greenhouse.io", {
      jobs: [{ title: "", absolute_url: "https://x/1" }, { title: "Ok", absolute_url: "" }],
    });
    expect(await greenhouseAdapter.fetchPostings(employer())).toEqual([]);
  });
});

describe("employer registry", () => {
  it("has a valid entry for every employer", () => {
    const platforms = new Set(ATS_ADAPTERS.map((a) => a.platform));
    for (const entry of EMPLOYERS) {
      expect(entry.slug, entry.name).toMatch(/^[a-z0-9][a-z0-9._-]*$/i);
      expect(entry.name.length, entry.slug).toBeGreaterThan(1);
      expect(platforms.has(entry.ats), `${entry.slug}: ${entry.ats}`).toBe(true);
      for (const country of entry.countries) {
        expect(country, entry.slug).toMatch(/^[A-Z]{2}$/);
      }
      // An employer with no countries and no remote flag would never be
      // selected for anyone, which is silently useless.
      expect(entry.countries.length > 0 || entry.remote === true, entry.slug).toBe(true);
    }
  });

  it("has no duplicate slug on the same platform", () => {
    const seen = new Set<string>();
    for (const entry of EMPLOYERS) {
      const key = `${entry.ats}/${entry.slug}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("offers remote-anywhere employers to every country", () => {
    const remoteCount = EMPLOYERS.filter((e) => e.remote).length;
    for (const country of ["CZ", "BR", "KE", "ZZ"]) {
      expect(employersForCountry(country).length, country).toBeGreaterThanOrEqual(remoteCount);
    }
  });

  it("includes country-specific employers for their own country only", () => {
    const czOnly = EMPLOYERS.find((e) => e.countries.includes("CZ") && !e.remote);
    if (czOnly) {
      expect(employersForCountry("CZ")).toContainEqual(czOnly);
      expect(employersForCountry("BR")).not.toContainEqual(czOnly);
    }
  });

  it("registers every platform with at least one employer", () => {
    for (const adapter of ATS_ADAPTERS) {
      expect(employersOn(adapter.platform).length, adapter.platform).toBeGreaterThan(0);
    }
  });
});

describe("ATS boards", () => {
  it("exposes one board per platform, all worldwide and browser-free", () => {
    expect(ATS_BOARDS).toHaveLength(ATS_ADAPTERS.length);
    for (const board of ATS_BOARDS) {
      expect(board.countries).toEqual(["*"]);
      expect(board.requiresBrowser).toBe(false);
      expect(board.supportsLiveSearch).toBe(true);
      expect(board.ingest).toBeTypeOf("function");
      expect(board.source).toMatch(/^[A-Z]+$/);
    }
  });

  it("turns a posting into a ScrapedJob with the employer as the company", async () => {
    responses.set("boards-api.greenhouse.io", {
      jobs: [
        {
          title: "Senior React Developer",
          absolute_url: "https://boards.greenhouse.io/productboard/jobs/1",
          location: { name: "Prague, Czechia" },
          content: "React and TypeScript.",
          updated_at: "2026-08-20T00:00:00Z",
        },
      ],
    });

    const board = ATS_BOARDS.find((b) => b.id === "ats-greenhouse")!;
    const jobs = await board.scrape({
      query: "react",
      seniority: null,
      city: "",
      country: "CZ",
      deepSearch: false,
      remoteOnly: false,
      intent: { query: "react", category: "Frontend", seniority: null, terms: [{ term: "react", weight: 3 }], negativeTerms: [], includedTitles: [], excludedTitles: [], canonicalText: "react", scrapingKeyword: "React" },
    });

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].source).toBe("GREENHOUSE");
    // The company is the employer, never the ATS vendor.
    expect(jobs[0].company).not.toBe("Greenhouse");
    expect(jobs[0].country).toBe("CZ");
  });
});
