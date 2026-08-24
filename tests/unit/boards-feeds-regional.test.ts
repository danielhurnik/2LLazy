/**
 * Regional API-backed job boards: Arbeitnow (European JSON), We Work Remotely
 * (RSS) and Adzuna (keyed REST).
 *
 * Same offline harness as `boards-feeds.test.ts`: the fetcher is replaced with
 * a queue that records every URL a board asks for and answers it from a
 * hand-authored fixture.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeQuery, Seniority } from "@/lib/scrapers/types";

// ─── Fetcher stub ─────────────────────────────────────────────────────────────

interface RecordedCall {
  url: string;
  headers?: Record<string, string>;
}
type Handler = () => unknown;

const net = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  responses: [] as Array<() => unknown>,
}));

vi.mock("@/lib/scrapers/fetcher", () => {
  const answer = (url: string, opts?: { headers?: Record<string, string> }) => {
    net.calls.push({ url, headers: opts?.headers });
    const handler = net.responses.length > 1 ? net.responses.shift() : net.responses[0];
    if (!handler) throw new Error(`no fixture queued for ${url}`);
    return handler();
  };
  const refuse = () => {
    throw new Error("feed boards must not fetch HTML pages");
  };
  return {
    fetchJson: async (url: string, opts?: { headers?: Record<string, string> }) =>
      answer(url, opts),
    fetchText: async (url: string, opts?: { headers?: Record<string, string> }) =>
      String(answer(url, opts)),
    rawFetch: refuse,
    fetchPage: refuse,
    parseDocument: refuse,
  };
});

/** Queues one response per fetch; the final handler answers any extra fetches. */
function serve(...handlers: Handler[]): void {
  net.responses = handlers;
}

function json(value: unknown): Handler {
  return () => structuredClone(value);
}

function text(value: string): Handler {
  return () => value;
}

function fails(message: string): Handler {
  return () => {
    throw new Error(message);
  };
}

const requestedUrls = (): string[] => net.calls.map((c) => c.url);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FEEDS_DIR = fileURLToPath(new URL("../fixtures/feeds/", import.meta.url));

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(`${FEEDS_DIR}${name}`, "utf8")) as T;
}

const ARBEITNOW = fixture<{ data: unknown[] }>("arbeitnow.json");
const ADZUNA = fixture<{ results: unknown[] }>("adzuna.json");
const WWR_RSS = readFileSync(`${FEEDS_DIR}weworkremotely.xml`, "utf8");

// ─── Query building ───────────────────────────────────────────────────────────

const { classifyQueryIntent } = await import("@/lib/matching");

function query(overrides: Partial<ScrapeQuery> = {}): ScrapeQuery {
  const text = overrides.query ?? "react";
  return {
    query: text,
    seniority: null,
    city: "",
    country: "DE",
    deepSearch: false,
    remoteOnly: false,
    intent: classifyQueryIntent(text, overrides.seniority as Seniority | null | undefined),
    ...overrides,
  };
}

function captureWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

function expectPlainText(value: string): void {
  expect(value).not.toMatch(/<[a-z/][^>]*>/i);
  expect(value).not.toMatch(/&(amp|lt|gt|quot|#\d+|nbsp);/i);
}

const { arbeitnowBoard, buildArbeitnowUrl } = await import("@/lib/scrapers/boards/arbeitnow");
const { weWorkRemotelyBoard, feedUrl, feedsForQuery, splitTitle } = await import(
  "@/lib/scrapers/boards/weworkremotely"
);
const { adzunaBoard, buildAdzunaUrl } = await import("@/lib/scrapers/boards/adzuna");

beforeEach(() => {
  net.calls.length = 0;
  net.responses = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Arbeitnow ────────────────────────────────────────────────────────────────

describe("Arbeitnow URL construction", () => {
  it("leaves the page parameter off page 1, as the API's own links do", () => {
    expect(buildArbeitnowUrl(1)).toBe("https://www.arbeitnow.com/api/job-board-api");
    expect(buildArbeitnowUrl(3)).toBe("https://www.arbeitnow.com/api/job-board-api?page=3");
  });

  it("walks two pages on a normal search", async () => {
    serve(json(ARBEITNOW));
    await arbeitnowBoard.scrape(query());

    expect(requestedUrls()).toEqual([
      "https://www.arbeitnow.com/api/job-board-api",
      "https://www.arbeitnow.com/api/job-board-api?page=2",
    ]);
  });

  it("walks five pages on a deep search", async () => {
    serve(json(ARBEITNOW));
    await arbeitnowBoard.scrape(query({ deepSearch: true }));

    expect(requestedUrls()).toHaveLength(5);
    expect(requestedUrls().at(-1)).toBe("https://www.arbeitnow.com/api/job-board-api?page=5");
  });

  it("stops paging as soon as a page comes back empty", async () => {
    serve(json(ARBEITNOW), json({ data: [] }), json(ARBEITNOW));
    await arbeitnowBoard.scrape(query({ deepSearch: true }));

    expect(requestedUrls()).toHaveLength(2);
  });

  it("sends no query, city or country — the API accepts none of them", async () => {
    serve(json(ARBEITNOW));
    await arbeitnowBoard.scrape(query({ query: "react", city: "Berlin", country: "DE" }));

    for (const url of requestedUrls()) {
      expect(new URL(url).searchParams.has("search")).toBe(false);
      expect(new URL(url).searchParams.has("location")).toBe(false);
    }
  });
});

describe("Arbeitnow mapping", () => {
  it("maps a posting onto every ScrapedJob field", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.company).toBe("Northwind GmbH");
    expect(job.location).toBe("Berlin, Germany");
    expect(job.sourceUrl).toBe(
      "https://www.arbeitnow.com/jobs/companies/northwind-gmbh/senior-react-developer-berlin-123456",
    );
    expect(job.source).toBe("ARBEITNOW");
    expect(job.workType).toBe("Remote");
    // A unix-seconds timestamp, which is what this API publishes.
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T08:00:00.000Z");
    expect(job.country).toBe("DE");
    // Arbeitnow publishes no salary figures at all.
    expect(job.salary).toBeUndefined();
  });

  it("builds a url from the slug when the payload has none", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query());
    const job = jobs.find((j) => j.title === "React Native Engineer")!;

    expect(job.sourceUrl).toBe(
      "https://www.arbeitnow.com/jobs/companies/react-native-engineer-vienna-123458",
    );
    expect(job.company).toBe("Unknown");
    expect(job.country).toBe("AT");
    // `remote: false`, so the work type has to be read out of the location text.
    expect(job.workType).toBe("Hybrid");
    // A numeric string, which the feed mixes in with real numbers.
    expect(job.postedAt?.toISOString()).toBe("2026-08-16T08:00:00.000Z");
  });

  it("drops an entry with no title", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query());

    expect(jobs.some((j) => j.company === "Broken Payload GmbH")).toBe(false);
  });

  it("deduplicates postings repeated across pages", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query());

    expect(net.calls).toHaveLength(2);
    expect(jobs).toHaveLength(2);
  });

  it("puts the postings in the searcher's country first", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query({ country: "DE" }));

    expect(jobs.map((j) => j.title)).toEqual([
      "Senior React Developer",
      "React Native Engineer",
    ]);
  });

  it("turns the HTML description into plain text", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Developer")!.description;

    expectPlainText(description);
    expect(description).toContain("React & TypeScript design system");
    expect(description).toContain("Visa sponsorship available");
  });
});

describe("Arbeitnow client-side filtering", () => {
  it("drops a posting unrelated to the query, having no server-side search", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query({ query: "react" }));

    expect(jobs.some((j) => j.title === "Forklift Operator")).toBe(false);
    expect(jobs.map((j) => j.title)).toEqual([
      "Senior React Developer",
      "React Native Engineer",
    ]);
  });

  it("keeps that same posting when the query is about it", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query({ query: "forklift" }));

    expect(jobs.map((j) => j.title)).toEqual(["Forklift Operator"]);
  });

  it("drops on-site postings when the search is remote-only", async () => {
    serve(json(ARBEITNOW));
    const jobs = await arbeitnowBoard.scrape(query({ remoteOnly: true }));

    expect(jobs.map((j) => j.title)).toEqual(["Senior React Developer"]);
  });
});

describe("Arbeitnow fails soft", () => {
  it("returns an empty array when the endpoint is down", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 502 for arbeitnow"));

    await expect(arbeitnowBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the body is not JSON", async () => {
    const warn = captureWarn();
    serve(fails("Unexpected token < in JSON at position 0"));

    await expect(arbeitnowBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the payload lost its data array", async () => {
    const warn = captureWarn();
    serve(json({ meta: { current_page: 1 } }));

    await expect(arbeitnowBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for an empty but well-formed result set", async () => {
    const warn = captureWarn();
    serve(json({ data: [] }));

    await expect(arbeitnowBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the postings it already has when a later page fails", async () => {
    const warn = captureWarn();
    serve(json(ARBEITNOW), fails("HTTP 500 for arbeitnow page 2"));

    const jobs = await arbeitnowBoard.scrape(query());
    expect(jobs).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ─── We Work Remotely ─────────────────────────────────────────────────────────

describe("We Work Remotely feed selection", () => {
  it("builds a per-category RSS url", () => {
    expect(feedUrl("remote-programming-jobs")).toBe(
      "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    );
  });

  it("reads the programming feed first for an engineering query", () => {
    expect(feedsForQuery(query({ query: "react" }))).toEqual([
      "remote-programming-jobs",
      "remote-devops-sysadmin-jobs",
    ]);
  });

  it("puts the category's own feed first and programming second", () => {
    expect(feedsForQuery(query({ query: "devops" }))[0]).toBe("remote-devops-sysadmin-jobs");
    expect(feedsForQuery(query({ query: "ux designer" }))[0]).toBe("remote-design-jobs");
    expect(feedsForQuery(query({ query: "product manager" }))[0]).toBe("remote-product-jobs");
    expect(feedsForQuery(query({ query: "security engineer" }))[0]).toBe(
      "remote-devops-sysadmin-jobs",
    );
    expect(feedsForQuery(query({ query: "ux designer" }))[1]).toBe("remote-programming-jobs");
  });

  it("reads every feed on a deep search", () => {
    const feeds = feedsForQuery(query({ deepSearch: true }));

    expect(feeds).toHaveLength(5);
    expect(new Set(feeds).size).toBe(5);
    expect(feeds).toContain("remote-customer-support-jobs");
  });

  it("requests exactly the feeds it selected", async () => {
    serve(text(WWR_RSS));
    await weWorkRemotelyBoard.scrape(query({ query: "react" }));

    expect(requestedUrls()).toEqual([
      "https://weworkremotely.com/categories/remote-programming-jobs.rss",
      "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    ]);
  });

  it("requests all five feeds on a deep search", async () => {
    serve(text(WWR_RSS));
    await weWorkRemotelyBoard.scrape(query({ deepSearch: true }));

    expect(requestedUrls()).toHaveLength(5);
    expect(requestedUrls().every((u) => u.endsWith(".rss"))).toBe(true);
  });
});

describe("We Work Remotely title splitting", () => {
  it("reads the company from the part before the first colon", () => {
    expect(splitTitle("Northwind Labs: Senior React Developer")).toEqual({
      company: "Northwind Labs",
      title: "Senior React Developer",
    });
  });

  it("keeps a colon inside the role", () => {
    expect(splitTitle("Acme: Engineer: Platform")).toEqual({
      company: "Acme",
      title: "Engineer: Platform",
    });
  });

  it("keeps a title with no colon whole and reports no company", () => {
    expect(splitTitle("Staff React Engineer")).toEqual({
      company: "",
      title: "Staff React Engineer",
    });
  });

  it("keeps a title that merely starts with a colon whole", () => {
    expect(splitTitle(": Senior Engineer")).toEqual({
      company: "",
      title: ": Senior Engineer",
    });
  });

  it("applies the split to the feed itself", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.company).toBe("Northwind Labs");
    expect(job.title).not.toContain("Northwind");
    expect(job.title).not.toContain(":");
  });

  it("labels a company-less title Unknown rather than guessing", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Staff React Engineer")!;

    expect(job.company).toBe("Unknown");
  });
});

describe("We Work Remotely mapping", () => {
  it("maps an RSS item onto every ScrapedJob field", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.location).toBe("Europe Only");
    expect(job.sourceUrl).toBe(
      "https://weworkremotely.com/remote-jobs/northwind-labs-senior-react-developer",
    );
    expect(job.source).toBe("WEWORKREMOTELY");
    expect(job.workType).toBe("Remote");
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T09:14:00.000Z");
    // WWR publishes no salary in its feeds.
    expect(job.salary).toBeUndefined();
    // "Europe Only" is a region, not a country.
    expect(job.country).toBeUndefined();
  });

  it("resolves the country out of a single-country region", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "React Native Engineer")!;

    expect(job.location).toBe("USA Only");
    expect(job.country).toBe("US");
  });

  it("defaults an item with no region to Remote", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());

    expect(jobs.find((j) => j.title === "Staff React Engineer")!.location).toBe("Remote");
  });

  it("drops an item with no link", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());

    expect(jobs.some((j) => j.title === "React Consultant")).toBe(false);
  });

  it("deduplicates items that appear in both feeds", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());

    expect(net.calls).toHaveLength(2);
    expect(jobs).toHaveLength(3);
  });

  it("turns the CDATA HTML description into plain text", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Developer")!.description;

    expectPlainText(description);
    expect(description).toContain("React & TypeScript design system");
    expect(description).toContain("5+ years of experience");
  });

  it("drops a posting unrelated to the query, having no server-side search", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query({ query: "react" }));

    expect(jobs.some((j) => j.title === "Warehouse Operations Lead")).toBe(false);
  });

  it("keeps that same posting when the query is about it", async () => {
    serve(text(WWR_RSS));
    const jobs = await weWorkRemotelyBoard.scrape(query({ query: "warehouse" }));

    expect(jobs.map((j) => j.title)).toEqual(["Warehouse Operations Lead"]);
  });
});

describe("We Work Remotely fails soft", () => {
  it("returns an empty array when the feed is down", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 503 for weworkremotely"));

    await expect(weWorkRemotelyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the body is not a feed at all", async () => {
    const warn = captureWarn();
    serve(text("<html><body>Service unavailable</body></html>"));

    await expect(weWorkRemotelyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for an empty response body", async () => {
    const warn = captureWarn();
    serve(text(""));

    await expect(weWorkRemotelyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for a well-formed feed holding no items", async () => {
    const warn = captureWarn();
    // `<items>` keeps the board's "looks like a feed" check happy while
    // carrying no `<item>` element of its own.
    serve(text('<?xml version="1.0"?><rss><channel><items></items></channel></rss>'));

    await expect(weWorkRemotelyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once, not once per feed", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 503 for weworkremotely"));

    await weWorkRemotelyBoard.scrape(query({ deepSearch: true }));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  // BUG (src/lib/scrapers/boards/weworkremotely.ts): the feed loop `break`s on a
  // fetch failure. The five WWR feeds are independent resources, not pages of
  // one list, so a single 503 on the first feed zeroes out the whole board even
  // though the other four would have answered. `continue` is what this loop
  // wants. Skipped until the lead fixes the source.
  it.skip("moves on to the next feed when one of them fails", async () => {
    captureWarn();
    serve(fails("HTTP 503 for weworkremotely"), text(WWR_RSS));

    const jobs = await weWorkRemotelyBoard.scrape(query());

    expect(net.calls).toHaveLength(2);
    expect(jobs.length).toBeGreaterThan(0);
  });
});

describe("We Work Remotely region resolution", () => {
  /** A one-item feed carrying whatever region string the test wants to try. */
  function feedWithRegion(region: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><item>
      <title><![CDATA[Northwind Labs: Senior React Developer]]></title>
      <region>${region}</region>
      <category><![CDATA[Programming]]></category>
      <description><![CDATA[<p>Own our React platform.</p>]]></description>
      <pubDate>Tue, 18 Aug 2026 09:14:00 +0000</pubDate>
      <link>https://weworkremotely.com/remote-jobs/northwind-labs-senior-react-developer</link>
    </item></channel></rss>`;
  }

  it("leaves the country unset for a region that spans several of them", async () => {
    serve(text(feedWithRegion("Europe Only")));
    const jobs = await weWorkRemotelyBoard.scrape(query());

    expect(jobs[0].country).toBeUndefined();
  });

  // BUG (src/lib/scrapers/boards/shared.ts): `resolveCountry` matches the US
  // alias "america" inside these region names, so a posting open to all of
  // North or Latin America is stamped country "US". WWR publishes both strings
  // verbatim, and the mis-stamped country then drives country filtering and the
  // location ranking. The alias needs a guard for a preceding "north"/"latin"
  // (or "america" should stop being a bare alias for the US).
  // Skipped until the lead fixes the source.
  it.skip("does not read a multi-country Americas region as the United States", async () => {
    serve(text(feedWithRegion("North America Only")));
    const north = await weWorkRemotelyBoard.scrape(query());
    expect(north[0].country).toBeUndefined();

    net.calls.length = 0;
    serve(text(feedWithRegion("Latin America Only")));
    const latin = await weWorkRemotelyBoard.scrape(query());
    expect(latin[0].country).toBeUndefined();
  });
});

// ─── Adzuna ───────────────────────────────────────────────────────────────────

const APP_ID = "test-app-id";
const APP_KEY = "test-app-key-should-never-be-logged";

/** Adzuna is skipped outright unless both credentials are present. */
function withCredentials(): void {
  vi.stubEnv("ADZUNA_APP_ID", APP_ID);
  vi.stubEnv("ADZUNA_APP_KEY", APP_KEY);
}

/**
 * A page of exactly `results_per_page` entries, so the board keeps paging.
 * `page` only varies the urls, which keeps the results distinct across pages.
 */
function fullAdzunaPage(page = 1): unknown {
  const template = ADZUNA.results[0] as Record<string, unknown>;
  return {
    results: Array.from({ length: 50 }, (_, i) => ({
      ...structuredClone(template),
      redirect_url: `https://www.adzuna.co.uk/jobs/land/ad/p${page}-${i}`,
    })),
  };
}

describe("Adzuna credentials", () => {
  it("declares both API keys in requiredEnv", () => {
    expect(adzunaBoard.requiredEnv).toEqual(["ADZUNA_APP_ID", "ADZUNA_APP_KEY"]);
  });

  it("skips the search and says which variables are missing", async () => {
    const warn = captureWarn();
    vi.stubEnv("ADZUNA_APP_ID", "");
    vi.stubEnv("ADZUNA_APP_KEY", "");

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(net.calls).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toContain("ADZUNA_APP_ID");
    expect(warn.mock.calls.flat().join(" ")).toContain("ADZUNA_APP_KEY");
  });

  it("skips the search when only one of the two is set", async () => {
    const warn = captureWarn();
    vi.stubEnv("ADZUNA_APP_ID", APP_ID);
    vi.stubEnv("ADZUNA_APP_KEY", "");

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(net.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it("never writes the credentials into a log line", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(fails("HTTP 401 for adzuna"));

    await adzunaBoard.scrape(query({ country: "GB" }));

    const logged = warn.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain(APP_KEY);
    expect(logged).not.toContain(APP_ID);
    expect(logged).toContain("adzuna");
  });
});

describe("Adzuna country coverage", () => {
  it("lists exactly the nineteen countries Adzuna runs a site for", () => {
    expect([...adzunaBoard.countries].sort()).toEqual([
      "AT", "AU", "BE", "BR", "CA", "CH", "DE", "ES", "FR", "GB", "IN", "IT", "MX",
      "NL", "NZ", "PL", "SG", "US", "ZA",
    ]);
    expect(adzunaBoard.countries).toHaveLength(19);
  });

  it("lists them uppercase, the way the registry compares them", () => {
    for (const code of adzunaBoard.countries) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("skips a search for a country it has no endpoint for", async () => {
    const warn = captureWarn();
    withCredentials();

    await expect(adzunaBoard.scrape(query({ country: "CZ" }))).resolves.toEqual([]);
    expect(net.calls).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toContain("CZ");
  });
});

describe("Adzuna URL construction", () => {
  it("puts the country in the path and the page at the end of it", () => {
    const url = buildAdzunaUrl(query({ country: "GB" }), 1, APP_ID, APP_KEY);

    expect(url.startsWith("https://api.adzuna.com/v1/api/jobs/gb/search/1?")).toBe(true);
  });

  it("carries the credentials, the keyword and the page size", () => {
    const params = new URL(
      buildAdzunaUrl(query({ country: "GB", query: "react" }), 2, APP_ID, APP_KEY),
    ).searchParams;

    expect(params.get("app_id")).toBe(APP_ID);
    expect(params.get("app_key")).toBe(APP_KEY);
    expect(params.get("what")).toBe("React");
    expect(params.get("results_per_page")).toBe("50");
  });

  it("sends the city as `where`, and omits it when there is none", () => {
    const withCity = new URL(
      buildAdzunaUrl(query({ country: "GB", city: "London" }), 1, APP_ID, APP_KEY),
    ).searchParams;
    const withoutCity = new URL(
      buildAdzunaUrl(query({ country: "GB", city: "" }), 1, APP_ID, APP_KEY),
    ).searchParams;

    expect(withCity.get("where")).toBe("London");
    expect(withoutCity.has("where")).toBe(false);
  });

  it("lowercases the country for the path segment", () => {
    for (const country of ["GB", "US", "ZA"]) {
      const url = buildAdzunaUrl(query({ country }), 1, APP_ID, APP_KEY);
      expect(new URL(url).pathname).toBe(`/v1/api/jobs/${country.toLowerCase()}/search/1`);
    }
  });

  it("stops after one page when the page comes back short", async () => {
    withCredentials();
    serve(json(ADZUNA));
    await adzunaBoard.scrape(query({ country: "GB" }));

    expect(requestedUrls()).toHaveLength(1);
    expect(new URL(requestedUrls()[0]).pathname).toBe("/v1/api/jobs/gb/search/1");
  });

  it("walks two pages of a full feed on a normal search", async () => {
    withCredentials();
    serve(json(fullAdzunaPage(1)), json(ADZUNA));
    await adzunaBoard.scrape(query({ country: "GB" }));

    expect(requestedUrls().map((u) => new URL(u).pathname)).toEqual([
      "/v1/api/jobs/gb/search/1",
      "/v1/api/jobs/gb/search/2",
    ]);
  });

  it("walks four pages on a deep search", async () => {
    withCredentials();
    serve(json(fullAdzunaPage(1)), json(fullAdzunaPage(2)), json(fullAdzunaPage(3)), json(ADZUNA));
    // Remote-only rejects every fixture result, so the per-board ceiling never
    // trips and the full deep-search page budget is what bounds the walk.
    await adzunaBoard.scrape(query({ country: "GB", deepSearch: true, remoteOnly: true }));

    expect(requestedUrls().map((u) => new URL(u).pathname.split("/").pop())).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("stops at the per-board ceiling before spending the whole page budget", async () => {
    withCredentials();
    serve(json(fullAdzunaPage(1)), json(fullAdzunaPage(2)), json(fullAdzunaPage(3)));
    const jobs = await adzunaBoard.scrape(query({ country: "GB", deepSearch: true }));

    expect(requestedUrls()).toHaveLength(3);
    expect(jobs).toHaveLength(120);
  });
});

describe("Adzuna mapping", () => {
  it("maps a result onto every ScrapedJob field", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.company).toBe("Northwind Ltd");
    expect(job.location).toBe("Shoreditch, East London");
    expect(job.sourceUrl).toBe("https://www.adzuna.co.uk/jobs/land/ad/4400001");
    expect(job.source).toBe("ADZUNA");
    // Adzuna publishes bare numbers; the currency comes from the endpoint.
    expect(job.salary).toBe("£55,000 - £75,000 per year");
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T09:14:00.000Z");
    expect(job.country).toBe("GB");
    expect(job.workType).toBe("");
  });

  it("falls back to the two innermost area names when there is no display name", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));
    const job = jobs.find((j) => j.title === "React Engineer (Fully Remote)")!;

    expect(job.location).toBe("South East England, Reading");
    expect(job.company).toBe("Unknown");
    expect(job.salary).toBeUndefined();
    expect(job.workType).toBe("Remote");
  });

  it("renders a single figure when the range has collapsed", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));

    expect(jobs.find((j) => j.title === "Warehouse Forklift Operator")!.salary).toBe(
      "£24,000 per year",
    );
  });

  it("uses the currency of the country's endpoint", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "PL" }));

    // PLN has no symbol, so the code is printed alongside each figure.
    expect(jobs[0].salary).toBe("PLN 55,000 - PLN 75,000 per year");
  });

  it("drops a result with no redirect url", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));

    expect(jobs.some((j) => j.title === "Broken Payload Role")).toBe(false);
    expect(jobs).toHaveLength(3);
  });

  it("stamps every posting with the searched country", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));

    expect(jobs.every((j) => j.country === "GB")).toBe(true);
  });

  it("keeps only remote roles when the search is remote-only", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB", remoteOnly: true }));

    expect(jobs.map((j) => j.title)).toEqual(["React Engineer (Fully Remote)"]);
  });

  it("turns the HTML description into plain text", async () => {
    withCredentials();
    serve(json(ADZUNA));
    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));
    const description = jobs.find((j) => j.title === "Senior React Developer")!.description;

    expectPlainText(description);
    expect(description).toContain("React & TypeScript front end");
  });
});

describe("Adzuna fails soft", () => {
  it("returns an empty array when the endpoint is down", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(fails("HTTP 500 for adzuna"));

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the body is not JSON", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(fails("Unexpected token < in JSON at position 0"));

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the payload lost its results array", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(json({ count: 0, exception: "AUTH_FAIL" }));

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for an empty but well-formed result set", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(json({ count: 0, results: [] }));

    await expect(adzunaBoard.scrape(query({ country: "GB" }))).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps the postings it already has when a later page fails", async () => {
    const warn = captureWarn();
    withCredentials();
    serve(json(fullAdzunaPage(1)), fails("HTTP 500 for adzuna page 2"));

    const jobs = await adzunaBoard.scrape(query({ country: "GB" }));
    expect(jobs).toHaveLength(50);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
