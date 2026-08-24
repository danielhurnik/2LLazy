import { describe, expect, it } from "vitest";
import {
  classifyQueryIntent,
  detectSeniority,
  expandQuery,
  findTaxonomyEntries,
  findTaxonomyEntry,
  TAXONOMY,
  tokenize,
} from "@/lib/matching";

describe("taxonomy data", () => {
  it("has unique ids and complete entries", () => {
    const ids = TAXONOMY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of TAXONOMY) {
      expect(entry.label, entry.id).toBeTruthy();
      expect(entry.aliases.length, entry.id).toBeGreaterThan(0);
      expect(entry.strong.length, entry.id).toBeGreaterThan(0);
      expect(entry.canonicalText.length, entry.id).toBeGreaterThan(40);
      expect(entry.scrapingKeyword, entry.id).toBeTruthy();
    }
  });

  it("never lists a term as both strong and negative in one entry", () => {
    for (const entry of TAXONOMY) {
      const strong = new Set(entry.strong.map((t) => t.toLowerCase()));
      for (const negative of entry.negative) {
        expect(strong.has(negative.toLowerCase()), `${entry.id}: ${negative}`).toBe(false);
      }
    }
  });
});

describe("findTaxonomyEntry", () => {
  it("resolves aliases and spelling variants", () => {
    for (const alias of ["react", "React.js", "REACTJS", "next.js"]) {
      expect(findTaxonomyEntry(alias)?.id, alias).toBe("react");
    }
    expect(findTaxonomyEntry("golang")?.id).toBe("go");
    expect(findTaxonomyEntry("k8s")?.id).toBe("kubernetes");
    expect(findTaxonomyEntry("ror")?.id).toBe("ruby");
  });

  it("returns null for something it does not know", () => {
    expect(findTaxonomyEntry("underwater basket weaving")).toBeNull();
  });

  it("prefers the longer alias when two overlap", () => {
    const entries = findTaxonomyEntries("react native developer");
    expect(entries[0].id).toBe("react-native");
  });
});

describe("classifyQueryIntent", () => {
  it("classifies a known query", () => {
    const intent = classifyQueryIntent("react", "Senior");
    expect(intent.category).toBe("Frontend");
    expect(intent.seniority).toBe("Senior");
    expect(intent.scrapingKeyword).toBe("React");
    expect(intent.terms.some((t) => t.term === "react")).toBe(true);
    expect(intent.negativeTerms).toContain("backend");
  });

  it("still produces usable terms for an unknown query", () => {
    const intent = classifyQueryIntent("cobol mainframe");
    expect(intent.category).toBe("Other");
    expect(intent.terms.length).toBeGreaterThan(0);
    expect(intent.terms.map((t) => t.term)).toContain("cobol");
    expect(intent.excludedTitles).toHaveLength(0);
  });

  it("merges two skills and drops the contradiction between them", () => {
    const intent = classifyQueryIntent("react node");
    const terms = intent.terms.map((t) => t.term);
    expect(terms).toContain("react");
    expect(terms).toContain("node.js");
    // "backend" is negative for React and positive for Node — it must not fight itself.
    expect(intent.negativeTerms).not.toContain("backend");
  });

  it("reads seniority out of the query when no skill level is given", () => {
    expect(classifyQueryIntent("senior react developer").seniority).toBe("Senior");
    expect(classifyQueryIntent("junior python").seniority).toBe("Junior");
  });

  it("lets an explicit skill level win over the query text", () => {
    expect(classifyQueryIntent("junior react", "Senior").seniority).toBe("Senior");
  });

  it("treats Any and empty as no preference", () => {
    expect(classifyQueryIntent("react", "Any").seniority).toBeNull();
    expect(classifyQueryIntent("react", "").seniority).toBeNull();
  });

  it("never returns an empty term list for a query with real characters", () => {
    for (const query of ["react", "a", "zzzz qqqq", "C#", "vývojář"]) {
      expect(classifyQueryIntent(query).terms.length, query).toBeGreaterThan(0);
    }
  });

  it("returns no terms for a query with nothing searchable in it", () => {
    // The scrape route rejects these before they reach a board; the classifier
    // just must not invent a term to match on.
    expect(classifyQueryIntent("???").terms).toHaveLength(0);
  });
});

describe("detectSeniority", () => {
  it("recognises levels in several languages", () => {
    expect(detectSeniority("Medior Java Developer")).toBe("Mid");
    expect(detectSeniority("Praktikant Frontend")).toBe("Junior");
    expect(detectSeniority("Tech Lead")).toBe("Lead");
  });

  it("prefers the most senior mention", () => {
    expect(detectSeniority("Senior or Lead Engineer")).toBe("Lead");
  });

  it("returns null when nothing is stated", () => {
    expect(detectSeniority("React Developer")).toBeNull();
  });
});

describe("tokenize", () => {
  it("keeps punctuation that is part of a tech name", () => {
    expect(tokenize("Node.js and C# with CI/CD")).toEqual(
      expect.arrayContaining(["node.js", "c#", "ci/cd"]),
    );
  });

  it("folds diacritics so Czech and Polish text matches", () => {
    expect(tokenize("vývojář")).toContain("vyvojar");
    expect(tokenize("Programista Główny")).toContain("glowny");
  });

  it("collapses English plurals onto the singular", () => {
    expect(tokenize("developers")).toContain("developer");
  });

  it("returns an empty list for junk input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ---   ")).toEqual([]);
  });
});

describe("expandQuery", () => {
  it("weights an exact alias above a related term", () => {
    const { terms } = expandQuery("react");
    const react = terms.find((t) => t.term === "react")!;
    const css = terms.find((t) => t.term === "css")!;
    expect(react.weight).toBeGreaterThan(css.weight);
  });

  it("includes the user's own words even when unknown", () => {
    const { terms } = expandQuery("react wombat");
    expect(terms.map((t) => t.term)).toContain("wombat");
  });
});
