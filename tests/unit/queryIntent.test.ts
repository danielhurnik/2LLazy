import { describe, it, expect } from "vitest";
import { lookupIntent } from "@/lib/queryIntent";

const QUERIES_WITH_KNOWN_CATEGORIES = ["react", "node", "python", "fullstack", "devops", "vue"];
const MIN_CANONICAL_TEXT_LENGTH = 20;
const UNKNOWN_QUERY = "zig-lang";
const OBJECT_PROTOTYPE_KEYS = ["constructor", "toString", "__proto__"];

const categoryOf = (query: string) => lookupIntent(query).category;

describe("lookupIntent — static intent table", () => {
  it("classifies 'react' as Frontend", () => {
    expect(categoryOf("react")).toBe("Frontend");
  });

  it("is case-insensitive and alias-aware", () => {
    expect(categoryOf("React")).toBe("Frontend");
    expect(categoryOf("React.js")).toBe("Frontend");
    expect(categoryOf("node.js")).toBe("Backend");
  });

  it("react intent includes React titles and excludes Backend", () => {
    const intent = lookupIntent("react");
    expect(intent.includedTitles.join(" ")).toMatch(/React/i);
    expect(intent.excludedTitles).toContain("Backend");
  });

  it("classifies node / fullstack / devops", () => {
    expect(categoryOf("node")).toBe("Backend");
    expect(categoryOf("fullstack")).toBe("Fullstack");
    expect(categoryOf("devops")).toBe("DevOps");
  });

  it("provides a scrapingKeyword and canonicalText for known categories", () => {
    for (const query of QUERIES_WITH_KNOWN_CATEGORIES) {
      const intent = lookupIntent(query);
      expect(intent.scrapingKeyword).toBeTruthy();
      expect(intent.canonicalText.length).toBeGreaterThan(MIN_CANONICAL_TEXT_LENGTH);
    }
  });

  it("falls back to the strongest token in a multi-word query", () => {
    expect(categoryOf("senior react developer")).toBe("Frontend");
    expect(categoryOf("python backend engineer")).toBe("Backend");
  });

  it("returns a keyword-only intent for unknown queries without any network call", () => {
    const intent = lookupIntent(UNKNOWN_QUERY);
    expect(intent.category).toBe("Other");
    expect(intent.scrapingKeyword).toBe(UNKNOWN_QUERY);
    expect(intent.includedTitles).toEqual([]);
  });

  it("treats Object.prototype keys as unknown queries", () => {
    for (const query of OBJECT_PROTOTYPE_KEYS) {
      expect(categoryOf(query)).toBe("Other");
    }
  });
});
