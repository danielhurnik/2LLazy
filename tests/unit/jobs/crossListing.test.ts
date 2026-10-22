import { describe, it, expect } from "vitest";
import type { JobSource } from "@prisma/client";
import { alreadyAppliedMessage, alsoOnEntries, boardLabel } from "@/lib/jobs/crossListing";

const labels = new Map<JobSource, string>([
  ["JOBSCZ", "Jobs.cz"],
  ["WEB", "Web search"],
]);
const posting = { id: "0", source: "JOBSCZ" as const, sourceUrl: "https://www.jobs.cz/rpd/0/" };

describe("boardLabel", () => {
  it("names boards by their label and web finds by their host", () => {
    expect(boardLabel("JOBSCZ", "https://www.jobs.cz/rpd/1/", labels)).toBe("Jobs.cz");
    expect(boardLabel("WEB", "https://www.prace.cz/nabidka/x/", labels)).toBe("prace.cz");
    expect(boardLabel("WEB", "not a url", labels)).toBe("Web search");
    expect(boardLabel("JOOBLE", "https://cz.jooble.org/x", labels)).toBe("JOOBLE");
  });
});

describe("alsoOnEntries", () => {
  it("is absent without cross-listings and lists each other board otherwise", () => {
    expect(alsoOnEntries(posting, [], labels)).toBeUndefined();
    expect(
      alsoOnEntries(
        posting,
        [
          { id: "1", source: "JOBSCZ", sourceUrl: "https://www.jobs.cz/rpd/1/" },
          { id: "2", source: "WEB", sourceUrl: "https://www.prace.cz/nabidka/x/" },
        ],
        labels,
      ),
    ).toEqual([{ source: "WEB", label: "prace.cz", url: "https://www.prace.cz/nabidka/x/" }]);
  });

  it("treats web and company-careers finds on another host as another board", () => {
    const webPosting = { id: "0", source: "WEB" as const, sourceUrl: "https://firma.cz/kariera/react" };
    const others = [
      { id: "1", source: "WEB" as const, sourceUrl: "https://firma.cz/kariera/react?ref=x" },
      { id: "2", source: "WEB" as const, sourceUrl: "https://www.hitprace.cz/nabidka/1" },
    ];
    expect(alsoOnEntries(webPosting, others, labels)).toEqual([{ source: "WEB", label: "hitprace.cz", url: "https://www.hitprace.cz/nabidka/1" }]);
  });
});

describe("alreadyAppliedMessage", () => {
  it("names the board", () => {
    expect(alreadyAppliedMessage("Jobs.cz")).toBe("You already applied to this job via Jobs.cz.");
  });
});
