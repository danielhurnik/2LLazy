import { describe, it, expect } from "vitest";
import type { JobSource } from "@prisma/client";
import { alsoOnEntries, boardLabel } from "@/lib/jobs/crossListing";

const labels = new Map<JobSource, string>([
  ["JOBSCZ", "Jobs.cz"],
  ["WEB", "Web search"],
]);

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
    expect(alsoOnEntries([], labels)).toBeUndefined();
    expect(
      alsoOnEntries(
        [
          { id: "1", source: "JOBSCZ", sourceUrl: "https://www.jobs.cz/rpd/1/" },
          { id: "2", source: "WEB", sourceUrl: "https://www.prace.cz/nabidka/x/" },
        ],
        labels,
      ),
    ).toEqual([
      { source: "JOBSCZ", label: "Jobs.cz", url: "https://www.jobs.cz/rpd/1/" },
      { source: "WEB", label: "prace.cz", url: "https://www.prace.cz/nabidka/x/" },
    ]);
  });
});
