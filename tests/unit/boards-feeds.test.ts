/**
 * Remotive and RemoteOK, plus the registry-metadata checks that cover all seven
 * API-backed boards.
 *
 * Every test runs offline. `@/lib/scrapers/fetcher` is replaced with a queue
 * that records the URLs (and headers) a board asked for and answers each one
 * from a hand-authored fixture, so the assertions cover both halves of a board:
 * the request it builds and the `ScrapedJob` it maps back. The same harness is
 * repeated in `boards-feeds-jobicy`, `-himalayas`, `-arbeitnow`, `-wwr` and
 * `-adzuna`, one file per board.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeQuery, Seniority } from "@/lib/scrapers/types";

// `vi.hoisted` so the mock factory, which vitest lifts above these
// declarations, can still close over the state the assertions read.
const net = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; headers?: Record<string, string> }>,
  responses: [] as Array<() => unknown>,
}));

vi.mock("@/lib/scrapers/fetcher", () => {
  const answer = (url: string, opts?: { headers?: Record<string, string> }) => {
    net.calls.push({ url, headers: opts?.headers });
    // The last queued handler answers every further request, so a board paging
    // beyond what a test cares about still gets a response.
    const handler = net.responses.length > 1 ? net.responses.shift() : net.responses[0];
    if (!handler) throw new Error(`no fixture queued for ${url}`);
    return handler();
  };
  const refuse = () => {
    throw new Error("feed boards must not fetch HTML pages");
  };
  return {
    fetchJson: async (u: string, o?: { headers?: Record<string, string> }) => answer(u, o),
    fetchText: async (u: string, o?: { headers?: Record<string, string> }) => String(answer(u, o)),
    rawFetch: refuse,
    fetchPage: refuse,
    parseDocument: refuse,
  };
});

/** Queues one response per fetch; the last handler answers any extra fetches. */
const serve = (...handlers: Array<() => unknown>) => {
  net.responses = handlers;
};
/** A successful JSON body, cloned so a board cannot mutate the fixture. */
const json = (value: unknown) => () => structuredClone(value);
/** A fetch that rejects, the way `fetchJson` reports a non-2xx response. */
const fails = (message: string) => () => {
  throw new Error(message);
};
const requestedUrls = () => net.calls.map((c) => c.url);
/** Silences a board's one-line failure warning and hands it back to assert on. */
const captureWarn = () => vi.spyOn(console, "warn").mockImplementation(() => {});

const FEEDS = fileURLToPath(new URL("../fixtures/feeds/", import.meta.url));

function readFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(`${FEEDS}${name}`, "utf8")) as T;
}

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

/** No markup and no HTML entities left in a description. */
function expectPlainText(value: string): void {
  expect(value).not.toMatch(/<[a-z/][^>]*>/i);
  expect(value).not.toMatch(/&(amp|lt|gt|quot|#\d+|nbsp);/i);
}

const REMOTIVE = readFixture("remotive.json");
const REMOTEOK = readFixture("remoteok.json");

// Imported after the mock so each board picks up the stubbed fetcher.
const { remotiveBoard, buildRemotiveUrl } = await import("@/lib/scrapers/boards/remotive");
const { remoteOkBoard } = await import("@/lib/scrapers/boards/remoteok");

beforeEach(() => {
  net.calls.length = 0;
  net.responses = [];
  vi.restoreAllMocks();
});

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
    expect(buildRemotiveUrl(query({ city: "Praha", country: "CZ" }))).toBe(
      "https://remotive.com/api/remote-jobs?search=React&limit=50",
    );
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

describe("Remotive fails soft", () => {
  it("returns an empty array when the endpoint is down", async () => {
    const warn = captureWarn();
    serve(fails("HTTP 503 for https://remotive.com/api/remote-jobs"));

    await expect(remotiveBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the body is not JSON", async () => {
    const warn = captureWarn();
    serve(fails("Unexpected token < in JSON at position 0"));

    await expect(remotiveBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array when the payload lost its job array", async () => {
    const warn = captureWarn();
    serve(json({ message: "service temporarily unavailable" }));

    await expect(remotiveBoard.scrape(query())).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty array for an empty but well-formed result set", async () => {
    const warn = captureWarn();
    serve(json({ "job-count": 0, jobs: [] }));

    await expect(remotiveBoard.scrape(query())).resolves.toEqual([]);
    // An empty result set is a normal answer, not a fault worth logging.
    expect(warn).not.toHaveBeenCalled();
  });
});

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

// ─── Registry metadata, all seven feed boards ─────────────────────────────────

const { jobicyBoard } = await import("@/lib/scrapers/boards/jobicy");
const { himalayasBoard } = await import("@/lib/scrapers/boards/himalayas");
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
