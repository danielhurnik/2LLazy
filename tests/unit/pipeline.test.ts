/**
 * End-to-end pipeline test with the network stubbed out.
 *
 * Exercises the whole chain a real search runs — country detection → board
 * selection → listing fetch → link selection → detail fetch → deterministic
 * extraction → lexical ranking — against fixture markup. This is the closest
 * thing to a live scrape that can run in CI, and it is what catches a break
 * between two modules that each still pass their own unit tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Fixture pages keyed by the URL path they answer. */
const LISTING_HTML = `<!doctype html><html><body>
  <nav><a href="/login">Login</a><a href="/about">About</a></nav>
  <div class="job-item"><h3 class="title">Senior React Developer</h3><a href="/job/senior-react-developer-101">Detail</a></div>
  <div class="job-item"><h3 class="title">Backend Engineer</h3><a href="/job/backend-engineer-102">Detail</a></div>
  <div class="job-item"><h3 class="title">IT Director</h3><a href="/job/it-director-103">Detail</a></div>
</body></html>`;

function detailPage(title: string, company: string, description: string, extra = ""): string {
  return `<!doctype html><html><head><script type="application/ld+json">
  {"@context":"https://schema.org","@type":"JobPosting",
   "title":${JSON.stringify(title)},
   "description":${JSON.stringify(description)},
   "hiringOrganization":{"@type":"Organization","name":${JSON.stringify(company)}},
   "jobLocation":{"@type":"Place","address":{"addressLocality":"Praha","addressCountry":"CZ"}},
   "datePosted":"2026-08-15"${extra}}
  </script></head><body><h1>${title}</h1></body></html>`;
}

const PAGES: Record<string, string> = {
  "/jobs": LISTING_HTML,
  "/job/senior-react-developer-101": detailPage(
    "Senior React Developer",
    "Pixel Labs",
    "React, TypeScript, Next.js, Redux and a shared component library. CSS and accessibility.",
    `,"baseSalary":{"@type":"MonetaryAmount","currency":"CZK","value":{"@type":"QuantitativeValue","minValue":90000,"maxValue":130000,"unitText":"MONTH"}}`,
  ),
  "/job/backend-engineer-102": detailPage(
    "Backend Engineer",
    "Cargoline",
    "Node.js and PostgreSQL REST APIs, microservices running on Kubernetes.",
  ),
  "/job/it-director-103": detailPage(
    "IT Director",
    "Meridian Group",
    "Lead the IT department. Budget ownership and vendor management. Familiarity with React and Node.js is a plus.",
  ),
};

const fetchCalls: string[] = [];

vi.mock("@/lib/scrapers/fetcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scrapers/fetcher")>();
  const serve = async (url: string) => {
    fetchCalls.push(url);
    const path = new URL(url).pathname;
    const html = PAGES[path];
    if (!html) throw new Error(`HTTP 404 for ${url}`);
    return { ...actual.parseDocument(html, url), status: 200 };
  };
  return { ...actual, fetchPage: serve, rawFetch: serve };
});

// Imported after the mock so the board picks up the stubbed fetcher.
const { fetchPage } = await import("@/lib/scrapers/fetcher");
const { runHtmlBoard } = await import("@/lib/scrapers/boards/helpers");
const { classifyQueryIntent, rankJobs, RELEVANCE_THRESHOLD } = await import("@/lib/matching");
const { detectCountry } = await import("@/lib/geo");
const { boardsForCountry, boardStatus } = await import("@/lib/scrapers/registry");

const BOARD_ORIGIN = "https://board.example";

/** A minimal board wired the same way the real HTML boards are. */
function scrapeFixtureBoard(signal?: AbortSignal) {
  return runHtmlBoard({
    id: "fixture",
    source: "FIXTURE",
    country: "CZ",
    maxPages: 1,
    deepSearch: false,
    signal,
    defaultLocation: "Czech Republic",
    buildUrl: () => `${BOARD_ORIGIN}/jobs`,
    fetchList: (url) => fetchPage(url),
    fetchDetail: (url) => fetchPage(url),
    select: { cardSelector: ".job-item", urlPattern: /\/job\// },
  });
}

beforeEach(() => {
  fetchCalls.length = 0;
});

describe("scrape pipeline", () => {
  it("walks listing → details → ScrapedJob without any model call", async () => {
    const jobs = await scrapeFixtureBoard();

    expect(jobs).toHaveLength(3);
    const react = jobs.find((j) => j.title === "Senior React Developer")!;
    expect(react.company).toBe("Pixel Labs");
    expect(react.location).toContain("Praha");
    expect(react.country).toBe("CZ");
    expect(react.salary).toContain("CZK");
    expect(react.source).toBe("FIXTURE");
    expect(react.postedAt?.toISOString().slice(0, 10)).toBe("2026-08-15");
  });

  it("never follows navigation links", async () => {
    await scrapeFixtureBoard();
    expect(fetchCalls.some((u) => u.includes("/login") || u.includes("/about"))).toBe(false);
  });

  it("ranks the fixture results the way a user would expect", async () => {
    const jobs = await scrapeFixtureBoard();
    const ranked = rankJobs(jobs, classifyQueryIntent("react"));

    expect(ranked[0].title).toBe("Senior React Developer");
    // The IT Director ad mentions React twice and must still be filtered out.
    const director = ranked.find((j) => j.title === "IT Director")!;
    expect(director.score).toBeLessThan(RELEVANCE_THRESHOLD);
  });

  it("returns an empty array when the board is unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = await runHtmlBoard({
      id: "dead",
      source: "DEAD",
      country: "CZ",
      maxPages: 1,
      deepSearch: false,
      buildUrl: () => `${BOARD_ORIGIN}/does-not-exist`,
      fetchList: (url) => fetchPage(url),
      fetchDetail: (url) => fetchPage(url),
      select: { urlPattern: /\/job\// },
    });

    expect(jobs).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("country routing", () => {
  it("gives every country at least the worldwide boards", () => {
    for (const country of ["CZ", "DE", "BR", "KE", "NZ", "ZZ"]) {
      const boards = boardsForCountry(country, { playwrightEnabled: true });
      expect(boards.length, country).toBeGreaterThan(0);
      expect(boards.some((b) => b.remoteOnly), country).toBe(true);
    }
  });

  it("adds the local boards on top for a covered country", () => {
    const cz = boardsForCountry("CZ", { playwrightEnabled: true }).map((b) => b.id);
    const br = boardsForCountry("BR", { playwrightEnabled: true }).map((b) => b.id);

    expect(cz).toContain("jobscz");
    expect(cz).toContain("cocuma");
    expect(br).not.toContain("jobscz");
    // Jooble runs a Brazilian site, so Brazil is not remote-only.
    expect(br).toContain("jooble");
  });

  it("puts local boards before the worldwide ones", () => {
    const boards = boardsForCountry("CZ", { playwrightEnabled: true });
    const firstWorldwide = boards.findIndex((b) => b.countries.includes("*"));
    const lastLocal = boards.map((b) => b.countries.includes("*")).lastIndexOf(false);
    expect(lastLocal).toBeLessThan(firstWorldwide);
  });

  it("skips browser boards when Playwright is off", () => {
    const ids = boardsForCountry("CZ", { playwrightEnabled: false }).map((b) => b.id);
    expect(ids).not.toContain("jobscz");
    expect(ids).toContain("cocuma");
  });

  it("skips a board whose credentials are missing and says why", () => {
    const adzuna = boardStatus("GB").find((b) => b.id === "adzuna")!;
    if (!process.env.ADZUNA_APP_ID) {
      expect(adzuna.enabled).toBe(false);
      expect(adzuna.disabledReason).toContain("ADZUNA_APP_ID");
    }
  });

  it("explains why an out-of-country board is not searched", () => {
    const cocuma = boardStatus("DE").find((b) => b.id === "cocuma")!;
    expect(cocuma.enabled).toBe(false);
    expect(cocuma.disabledReason).toContain("DE");
  });
});

describe("country detection", () => {
  it("prefers an explicit choice over everything else", () => {
    const headers = new Headers({ "cf-ipcountry": "DE", "accept-language": "cs-CZ" });
    expect(detectCountry({ explicit: "pl", profile: "CZ", headers })).toMatchObject({
      country: "PL",
      via: "explicit",
    });
  });

  it("falls back through profile, geo header and language", () => {
    const headers = new Headers({ "cf-ipcountry": "DE" });
    expect(detectCountry({ profile: "CZ", headers }).country).toBe("CZ");
    expect(detectCountry({ headers }).country).toBe("DE");
    expect(
      detectCountry({ headers: new Headers({ "accept-language": "pl-PL,pl;q=0.9" }) }),
    ).toMatchObject({ country: "PL", via: "accept-language" });
  });

  it("ends at the default when nothing is known", () => {
    expect(detectCountry({}).via).toBe("default");
  });

  it("ignores placeholder geo values", () => {
    expect(detectCountry({ headers: new Headers({ "cf-ipcountry": "XX" }) }).via).toBe("default");
  });
});
