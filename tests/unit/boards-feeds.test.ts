/**
 * Worldwide API-backed job boards: Remotive, RemoteOK, Jobicy, Himalayas.
 *
 * Every test runs offline. `@/lib/scrapers/fetcher` is replaced with a queue
 * that records the URLs (and headers) a board asked for and answers each one
 * from a hand-authored fixture, so the assertions cover both halves of a board:
 * the request it builds and the `ScrapedJob` it maps back.
 *
 * The regional boards (Arbeitnow, We Work Remotely, Adzuna) live in
 * `boards-feeds-regional.test.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeQuery, Seniority } from "@/lib/scrapers/types";

// ─── Fetcher stub ─────────────────────────────────────────────────────────────

interface RecordedCall {
  url: string;
  headers?: Record<string, string>;
}
type Handler = () => unknown;

// `vi.hoisted` so the mock factory, which vitest lifts above this file's
// declarations, can still close over the state the tests read.
const net = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  responses: [] as Array<() => unknown>,
}));

vi.mock("@/lib/scrapers/fetcher", () => {
  const answer = (url: string, opts?: { headers?: Record<string, string> }) => {
    net.calls.push({ url, headers: opts?.headers });
    // The last queued handler answers every further request, so a board that
    // pages further than the test cares about still gets a response.
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

/** A successful JSON body. Cloned so a board cannot mutate the fixture. */
function json(value: unknown): Handler {
  return () => structuredClone(value);
}

/** A fetch that rejects, the way `fetchJson` reports a non-2xx response. */
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

const REMOTIVE = fixture("remotive.json");
const REMOTEOK = fixture("remoteok.json");
const JOBICY = fixture("jobicy.json");
const HIMALAYAS = fixture("himalayas.json");

// ─── Query building ───────────────────────────────────────────────────────────

const { classifyQueryIntent } = await import("@/lib/matching");

function query(overrides: Partial<ScrapeQuery> = {}): ScrapeQuery {
  const text = overrides.query ?? "react";
  return {
    query: text,
    seniority: null,
    city: "",
    country: "CZ",
    deepSearch: false,
    remoteOnly: false,
    intent: classifyQueryIntent(text, overrides.seniority as Seniority | null | undefined),
    ...overrides,
  };
}

/** Silences the board's one-line failure warning and hands it back for assertions. */
function captureWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

/** No markup, no HTML entities, no raw tag names left in a description. */
function expectPlainText(text: string): void {
  expect(text).not.toMatch(/<[a-z/][^>]*>/i);
  expect(text).not.toMatch(/&(amp|lt|gt|quot|#\d+|nbsp);/i);
}

// Imported after the mock so each board picks up the stubbed fetcher.
const { remotiveBoard, buildRemotiveUrl } = await import("@/lib/scrapers/boards/remotive");
const { remoteOkBoard } = await import("@/lib/scrapers/boards/remoteok");
const { jobicyBoard, buildJobicyUrl, geoForCountry } = await import(
  "@/lib/scrapers/boards/jobicy"
);
const { himalayasBoard, buildHimalayasUrl } = await import("@/lib/scrapers/boards/himalayas");

beforeEach(() => {
  net.calls.length = 0;
  net.responses = [];
  vi.restoreAllMocks();
});

/**
 * The four soft-failure modes every board must survive: a dead endpoint, a body
 * that is not JSON at all, a 200 whose payload lost the array the board reads,
 * and a well-formed but empty result set.
 */
function describeSoftFailures(
  name: string,
  scrape: () => Promise<unknown[]>,
  emptyPayload: unknown,
  /**
   * Jobicy is the exception: it reads a missing `jobs` key as "nothing matched"
   * (the API really does omit it), so an unrecognised object is silently empty
   * rather than warned about. See the Jobicy block below.
   */
  opts: { warnsOnShapelessPayload?: boolean } = {},
) {
  const warnsOnShapelessPayload = opts.warnsOnShapelessPayload ?? true;

  describe(`${name} fails soft`, () => {
    it("returns an empty array when the endpoint is down", async () => {
      const warn = captureWarn();
      serve(fails("HTTP 503 for the feed"));

      await expect(scrape()).resolves.toEqual([]);
      expect(warn).toHaveBeenCalled();
    });

    it("returns an empty array when the body is not JSON", async () => {
      const warn = captureWarn();
      serve(fails("Unexpected token < in JSON at position 0"));

      await expect(scrape()).resolves.toEqual([]);
      expect(warn).toHaveBeenCalled();
    });

    it("returns an empty array when the payload lost its job array", async () => {
      const warn = captureWarn();
      serve(json({ message: "service temporarily unavailable" }));

      await expect(scrape()).resolves.toEqual([]);
      if (warnsOnShapelessPayload) expect(warn).toHaveBeenCalled();
    });

    it("returns an empty array for an empty but well-formed result set", async () => {
      const warn = captureWarn();
      serve(json(emptyPayload));

      await expect(scrape()).resolves.toEqual([]);
      // An empty result set is a normal answer, not a fault worth logging.
      expect(warn).not.toHaveBeenCalled();
    });
  });
}

// ─── Remotive ─────────────────────────────────────────────────────────────────

describe("Remotive URL construction", () => {
  it("searches on the intent keyword with the shallow limit", () => {
    expect(buildRemotiveUrl(query({ query: "react" }))).toBe(
      "https://remotive.com/api/remote-jobs?search=React&limit=50",
    );
  });

  it("raises the limit instead of paging for a deep search", () => {
    expect(buildRemotiveUrl(query({ query: "react", deepSearch: true }))).toBe(
      "https://remotive.com/api/remote-jobs?search=React&limit=120",
    );
  });

  it("encodes a multi-word keyword", () => {
    expect(buildRemotiveUrl(query({ query: "product manager" }))).toContain(
      "search=product+manager",
    );
  });

  it("ignores city and country, which the API does not accept", () => {
    const url = buildRemotiveUrl(query({ city: "Praha", country: "CZ" }));
    expect(url).toBe("https://remotive.com/api/remote-jobs?search=React&limit=50");
  });

  it("issues exactly one request per search", async () => {
    serve(json(REMOTIVE));
    await remotiveBoard.scrape(query());

    expect(requestedUrls()).toEqual([
      "https://remotive.com/api/remote-jobs?search=React&limit=50",
    ]);
  });
});

describe("Remotive mapping", () => {
  it("maps a posting onto every ScrapedJob field", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Engineer")!;

    expect(job.company).toBe("Northwind Labs");
    expect(job.location).toBe("Europe");
    expect(job.sourceUrl).toBe(
      "https://remotive.com/remote-jobs/software-dev/senior-react-engineer-1900001",
    );
    expect(job.source).toBe("REMOTIVE");
    // Remotive publishes salary as free text, so it is passed through verbatim.
    expect(job.salary).toBe("$90,000 - $120,000");
    expect(job.workType).toBe("Remote");
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T09:14:00.000Z");
    // "Europe" names a region, not a country.
    expect(job.country).toBeUndefined();
  });

  it("resolves a country out of the candidate location", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query());

    expect(jobs.find((j) => j.title === "Backend Engineer (Go)")!.country).toBe("US");
  });

  it("fills in defaults for a posting with null fields", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Product Designer")!;

    expect(job.company).toBe("Unknown");
    expect(job.location).toBe("Worldwide");
    expect(job.description).toBe("");
    expect(job.salary).toBeUndefined();
    expect(job.postedAt).toBeUndefined();
  });

  it("drops an entry with no title or url rather than mapping a stub", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query());

    expect(jobs).toHaveLength(3);
    expect(jobs.some((j) => j.company === "Broken Payload Inc")).toBe(false);
  });

  it("floats the postings open to the searcher's region first", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query({ country: "CZ" }));

    // Europe (the searcher's region) outranks Worldwide, which outranks USA.
    expect(jobs.map((j) => j.location)).toEqual(["Europe", "Worldwide", "USA"]);
  });

  it("turns the HTML description into plain text", async () => {
    serve(json(REMOTIVE));
    const jobs = await remotiveBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Engineer")!.description;

    expectPlainText(description);
    expect(description).toContain("Senior React Engineer");
    expect(description).toContain("web & platform team");
    expect(description).toContain("5+ years with React and TypeScript");
  });
});

describeSoftFailures("Remotive", () => remotiveBoard.scrape(query()), { jobs: [] });

// ─── RemoteOK ─────────────────────────────────────────────────────────────────

describe("RemoteOK URL construction", () => {
  it("reads the whole feed from one fixed endpoint", async () => {
    serve(json(REMOTEOK));
    await remoteOkBoard.scrape(query());

    expect(requestedUrls()).toEqual(["https://remoteok.com/api"]);
  });

  it("does not change the request for a deep search — the feed has no paging", async () => {
    serve(json(REMOTEOK));
    await remoteOkBoard.scrape(query({ deepSearch: true, city: "Praha", country: "US" }));

    expect(requestedUrls()).toEqual(["https://remoteok.com/api"]);
  });

  it("sends a browser User-Agent, which the endpoint requires", async () => {
    serve(json(REMOTEOK));
    await remoteOkBoard.scrape(query());

    expect(net.calls[0].headers?.["User-Agent"]).toMatch(/^Mozilla\/5\.0/);
  });
});

describe("RemoteOK mapping", () => {
  it("skips the legal-notice object the feed puts first", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query());

    expect(jobs.every((j) => j.title.length > 0)).toBe(true);
    expect(jobs.some((j) => j.description.includes("legal"))).toBe(false);
    expect(jobs.some((j) => j.company === "Unknown")).toBe(false);
  });

  it("maps a posting onto every ScrapedJob field", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.company).toBe("Northwind Labs");
    expect(job.location).toBe("Europe");
    expect(job.sourceUrl).toBe("https://remoteok.com/remote-jobs/1010101-senior-react-developer");
    expect(job.source).toBe("REMOTEOK");
    expect(job.salary).toBe("$90,000 - $130,000 per year");
    expect(job.workType).toBe("Remote");
    expect(job.postedAt?.toISOString()).toBe("2026-08-19T08:00:00.000Z");
  });

  it("absolutises a root-relative url and reads its country", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query());
    const job = jobs.find((j) => j.title === "React Native Engineer")!;

    expect(job.sourceUrl).toBe("https://remoteok.com/remote-jobs/1010103-react-native-engineer");
    expect(job.country).toBe("US");
    // A min equal to the max is one figure, not a range.
    expect(job.salary).toBe("$70,000 per year");
  });

  it("builds a url from the id when the feed omits one", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query());
    const job = jobs.find((j) => j.title === "React Performance Consultant")!;

    expect(job.sourceUrl).toBe("https://remoteok.com/remote-jobs/1010104");
    expect(job.location).toBe("Worldwide");
    // Zeroed salary bounds mean "not disclosed", not "$0".
    expect(job.salary).toBeUndefined();
    // A unix-seconds timestamp, which this feed mixes in with ISO strings.
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T08:00:00.000Z");
  });

  it("filters out a posting unrelated to the query, having no server-side search", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query({ query: "react" }));

    expect(jobs.some((j) => j.title === "Warehouse Forklift Operator")).toBe(false);
    expect(jobs).toHaveLength(3);
  });

  it("keeps the posting when the query does match it", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query({ query: "warehouse" }));

    expect(jobs.map((j) => j.title)).toEqual(["Warehouse Forklift Operator"]);
  });

  it("turns the HTML description into plain text", async () => {
    serve(json(REMOTEOK));
    const jobs = await remoteOkBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Developer")!.description;

    expectPlainText(description);
    expect(description).toContain("frontend team & own the React design system");
  });
});

describe("RemoteOK fails soft", () => {
  it("returns an empty array when the endpoint is down", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 403 for https://remoteok.com/api"));

    await expect(remoteOkBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the body is not JSON", async () => {
    const warn = captureWarn();
    serve(fails("Unexpected token < in JSON at position 0"));

    await expect(remoteOkBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the payload is not an array at all", async () => {
    const warn = captureWarn();
    serve(json({ jobs: [] }));

    await expect(remoteOkBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for a feed holding only its legal notice", async () => {
    const warn = captureWarn();
    serve(json([{ legal: "no jobs today" }]));

    await expect(remoteOkBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ─── Jobicy ───────────────────────────────────────────────────────────────────

describe("Jobicy geo mapping", () => {
  it("uses the dedicated bucket for a country that has one", () => {
    const expected: Record<string, string> = {
      US: "usa",
      CA: "canada",
      GB: "uk",
      AU: "australia",
      DE: "germany",
      FR: "france",
      IN: "india",
      SG: "singapore",
      PH: "philippines",
    };
    for (const [country, geo] of Object.entries(expected)) {
      expect(geoForCountry(country), country).toBe(geo);
    }
  });

  it("falls back to the region for a country without one", () => {
    expect(geoForCountry("CZ")).toBe("europe");
    expect(geoForCountry("PL")).toBe("europe");
    expect(geoForCountry("ZA")).toBe("emea");
    expect(geoForCountry("JP")).toBe("apac");
    expect(geoForCountry("BR")).toBe("latam");
  });

  it("falls back to anywhere for a country the API does not cover", () => {
    expect(geoForCountry("KE")).toBe("anywhere");
    expect(geoForCountry("ZZ")).toBe("anywhere");
    expect(geoForCountry("")).toBe("anywhere");
  });

  it("accepts a lowercase country code", () => {
    expect(geoForCountry("us")).toBe("usa");
    expect(geoForCountry("cz")).toBe("europe");
  });
});

describe("Jobicy URL construction", () => {
  it("carries the geo, the industry and the intent keyword", () => {
    expect(buildJobicyUrl(query({ query: "react" }), "europe")).toBe(
      "https://jobicy.com/api/v2/remote-jobs?count=50&geo=europe&industry=dev&tag=React",
    );
  });

  it("omits the industry filter for a category it has no slug for", () => {
    const url = buildJobicyUrl(query({ query: "designer" }), "anywhere");

    expect(url).not.toContain("industry=");
    expect(url).toContain("tag=designer");
  });

  it("derives the geo from the searcher's country", async () => {
    serve(json(JOBICY));
    await jobicyBoard.scrape(query({ country: "DE" }));

    expect(requestedUrls()).toEqual([
      "https://jobicy.com/api/v2/remote-jobs?count=50&geo=germany&industry=dev&tag=React",
    ]);
  });

  it("adds the worldwide bucket as a second request on a deep search", async () => {
    serve(json(JOBICY));
    await jobicyBoard.scrape(query({ country: "CZ", deepSearch: true }));

    expect(requestedUrls()).toEqual([
      "https://jobicy.com/api/v2/remote-jobs?count=50&geo=europe&industry=dev&tag=React",
      "https://jobicy.com/api/v2/remote-jobs?count=50&geo=anywhere&industry=dev&tag=React",
    ]);
  });

  it("does not repeat the worldwide bucket when it is already the geo", async () => {
    serve(json(JOBICY));
    await jobicyBoard.scrape(query({ country: "KE", deepSearch: true }));

    expect(requestedUrls()).toHaveLength(1);
    expect(requestedUrls()[0]).toContain("geo=anywhere");
  });
});

describe("Jobicy mapping", () => {
  it("maps a posting onto every ScrapedJob field", async () => {
    serve(json(JOBICY));
    const jobs = await jobicyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Developer")!;

    expect(job.company).toBe("Northwind Labs");
    expect(job.location).toBe("Europe");
    expect(job.sourceUrl).toBe("https://jobicy.com/jobs/2200001-senior-react-developer");
    expect(job.source).toBe("JOBICY");
    expect(job.salary).toBe("€60,000 - €90,000 per year");
    expect(job.workType).toBe("Remote");
    // Jobicy stamps "YYYY-MM-DD HH:MM:SS" with no zone; it is read as UTC.
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T09:14:00.000Z");
    expect(job.country).toBeUndefined();
  });

  it("falls back to the excerpt when the description is missing", async () => {
    serve(json(JOBICY));
    const jobs = await jobicyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "React Native Engineer")!;

    expect(job.description).toBe("Ship iOS and Android from one codebase.");
    expect(job.country).toBe("US");
    expect(job.salary).toBeUndefined();
  });

  it("fills in defaults for a posting with null fields", async () => {
    serve(json(JOBICY));
    const jobs = await jobicyBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Frontend Engineer")!;

    expect(job.company).toBe("Unknown");
    expect(job.location).toBe("Anywhere");
    expect(job.salary).toBeUndefined();
    expect(job.postedAt).toBeUndefined();
  });

  it("drops an entry with no job title", async () => {
    serve(json(JOBICY));
    const jobs = await jobicyBoard.scrape(query());

    expect(jobs).toHaveLength(3);
    expect(jobs.some((j) => j.company === "Broken Payload Inc")).toBe(false);
  });

  it("turns the HTML description into plain text", async () => {
    serve(json(JOBICY));
    const jobs = await jobicyBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Developer")!.description;

    expectPlainText(description);
    expect(description).toContain("React component library & design system");
  });

  it("deduplicates the two geo requests of a deep search", async () => {
    serve(json(JOBICY), json(JOBICY));
    const jobs = await jobicyBoard.scrape(query({ deepSearch: true }));

    expect(net.calls).toHaveLength(2);
    expect(jobs).toHaveLength(3);
  });
});

describeSoftFailures(
  "Jobicy",
  () => jobicyBoard.scrape(query()),
  // Jobicy legitimately omits `jobs` entirely when nothing matched.
  { apiVersion: "2.0", jobCount: 0 },
  { warnsOnShapelessPayload: false },
);

describe("Jobicy payload shape handling", () => {
  it("reads a payload with no jobs key as an empty result set, not a fault", async () => {
    const warn = captureWarn();
    serve(json({ apiVersion: "2.0", jobCount: 0 }));

    await expect(jobicyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when jobs is present but is not an array", async () => {
    const warn = captureWarn();
    serve(json({ apiVersion: "2.0", jobs: { error: "rate limited" } }));

    await expect(jobicyBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("stops after a failed geo rather than trying the next one", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 500 for jobicy"), json(JOBICY));

    await expect(jobicyBoard.scrape(query({ deepSearch: true }))).resolves.toEqual([]);
    expect(net.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ─── Himalayas ────────────────────────────────────────────────────────────────

/** A page of exactly `PAGE_SIZE` entries, so the board keeps paging. */
function fullHimalayasPage(): unknown {
  const template = (HIMALAYAS as { jobs: unknown[] }).jobs[0];
  return {
    jobs: Array.from({ length: 50 }, (_, i) => ({
      ...structuredClone(template as Record<string, unknown>),
      applicationLink: `https://himalayas.app/jobs/filler-${i}`,
      guid: `https://himalayas.app/jobs/filler-${i}`,
    })),
  };
}

describe("Himalayas URL construction", () => {
  it("pages by offset in fifties", () => {
    expect(buildHimalayasUrl(0)).toBe("https://himalayas.app/jobs/api?limit=50&offset=0");
    expect(buildHimalayasUrl(150)).toBe("https://himalayas.app/jobs/api?limit=50&offset=150");
  });

  it("stops after the first short page", async () => {
    serve(json(HIMALAYAS));
    await himalayasBoard.scrape(query());

    expect(requestedUrls()).toEqual(["https://himalayas.app/jobs/api?limit=50&offset=0"]);
  });

  it("walks two pages of a full feed on a normal search", async () => {
    serve(json(fullHimalayasPage()), json(HIMALAYAS));
    await himalayasBoard.scrape(query());

    expect(requestedUrls()).toEqual([
      "https://himalayas.app/jobs/api?limit=50&offset=0",
      "https://himalayas.app/jobs/api?limit=50&offset=50",
    ]);
  });

  it("walks four pages on a deep search", async () => {
    serve(
      json(fullHimalayasPage()),
      json(fullHimalayasPage()),
      json(fullHimalayasPage()),
      json(HIMALAYAS),
    );
    await himalayasBoard.scrape(query({ deepSearch: true, query: "underwater welding" }));

    expect(requestedUrls().map((u) => new URL(u).searchParams.get("offset"))).toEqual([
      "0",
      "50",
      "100",
      "150",
    ]);
  });

  it("ignores city and country, which the API does not accept", async () => {
    serve(json(HIMALAYAS));
    await himalayasBoard.scrape(query({ city: "Praha", country: "CZ" }));

    expect(requestedUrls()[0]).toBe("https://himalayas.app/jobs/api?limit=50&offset=0");
  });
});

describe("Himalayas mapping", () => {
  it("maps a posting onto every ScrapedJob field", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Senior React Engineer")!;

    expect(job.company).toBe("Northwind Labs");
    expect(job.location).toBe("United States");
    expect(job.sourceUrl).toBe("https://himalayas.app/jobs/northwind-labs-senior-react-engineer");
    expect(job.source).toBe("HIMALAYAS");
    expect(job.salary).toBe("$120,000 - $160,000 per year");
    expect(job.workType).toBe("Remote");
    expect(job.postedAt?.toISOString()).toBe("2026-08-18T08:00:00.000Z");
    // A single restriction is a country the posting is actually open in.
    expect(job.country).toBe("US");
  });

  it("treats several location restrictions as a region, not a country", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query());
    const job = jobs.find((j) => j.title === "Frontend Engineer")!;

    expect(job.location).toBe("United States, Canada");
    expect(job.country).toBeUndefined();
    // Only a lower bound was published.
    expect(job.salary).toBe("From $90,000 per year");
    // The application link is null, so the guid stands in for it.
    expect(job.sourceUrl).toBe("https://himalayas.app/jobs/helios-frontend-engineer");
  });

  it("defaults an unrestricted posting to Worldwide", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query({ query: "customer support" }));
    const job = jobs.find((j) => j.title === "Customer Support Representative")!;

    expect(job.location).toBe("Worldwide");
    expect(job.company).toBe("Tidewater");
    expect(job.salary).toBeUndefined();
  });

  it("drops entries with no title and with no usable link", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query());

    expect(jobs.some((j) => j.company === "Broken Payload Inc")).toBe(false);
    // "React Native Developer" has an empty applicationLink and an empty guid.
    expect(jobs.some((j) => j.title === "React Native Developer")).toBe(false);
    expect(jobs).toHaveLength(2);
  });

  it("filters out a posting unrelated to the query, having no server-side search", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query({ query: "react" }));

    expect(jobs.some((j) => j.title === "Customer Support Representative")).toBe(false);
    expect(jobs.map((j) => j.title)).toEqual(["Senior React Engineer", "Frontend Engineer"]);
  });

  it("turns the HTML description into plain text", async () => {
    serve(json(HIMALAYAS));
    const jobs = await himalayasBoard.scrape(query());
    const description = jobs.find((j) => j.title === "Senior React Engineer")!.description;

    expectPlainText(description);
    expect(description).toContain("React platform work & mentor the team");
  });
});

describeSoftFailures("Himalayas", () => himalayasBoard.scrape(query()), { jobs: [] });

// ─── Registry metadata ────────────────────────────────────────────────────────

const { arbeitnowBoard } = await import("@/lib/scrapers/boards/arbeitnow");
const { weWorkRemotelyBoard } = await import("@/lib/scrapers/boards/weworkremotely");
const { adzunaBoard } = await import("@/lib/scrapers/boards/adzuna");

const FEED_BOARDS = [
  remotiveBoard,
  remoteOkBoard,
  jobicyBoard,
  himalayasBoard,
  weWorkRemotelyBoard,
  arbeitnowBoard,
  adzunaBoard,
];

describe("feed board metadata", () => {
  it("gives every board a unique id", () => {
    const ids = FEED_BOARDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(FEED_BOARDS.map((b) => [b.id, b] as const))("%s is well formed", (id, board) => {
    expect(board.id).toMatch(/^[a-z0-9]+$/);
    expect(board.name.trim()).not.toBe("");
    // `source` is written straight onto JobPosting.source, so it must be uppercase.
    expect(board.source).toBe(board.source.toUpperCase());
    expect(board.source).toMatch(/^[A-Z0-9]+$/);
    expect(board.homepage).not.toBe("");
    expect(() => new URL(board.homepage)).not.toThrow();
    expect(new URL(board.homepage).protocol).toBe("https:");

    expect(board.countries.length).toBeGreaterThan(0);
    if (board.countries.includes("*")) {
      expect(board.countries).toEqual(["*"]);
    } else {
      for (const code of board.countries) expect(code, `${id}: ${code}`).toMatch(/^[A-Z]{2}$/);
      expect(new Set(board.countries).size).toBe(board.countries.length);
    }

    expect(typeof board.remoteOnly).toBe("boolean");
    expect(typeof board.requiresBrowser).toBe("boolean");
    // These boards all talk to an API; none of them needs a browser.
    expect(board.requiresBrowser).toBe(false);
    expect(typeof board.scrape).toBe("function");
  });

  it("declares required env vars only where credentials are genuinely needed", () => {
    for (const board of FEED_BOARDS) {
      if (board.requiredEnv === undefined) continue;
      expect(board.requiredEnv.length, board.id).toBeGreaterThan(0);
      for (const name of board.requiredEnv) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
    const keyed = FEED_BOARDS.filter((b) => (b.requiredEnv ?? []).length > 0).map((b) => b.id);
    expect(keyed).toEqual(["adzuna"]);
  });

  it("marks the worldwide boards remote-only and the regional ones not", () => {
    for (const board of FEED_BOARDS) {
      expect(board.remoteOnly, board.id).toBe(board.countries.includes("*"));
    }
  });
});
