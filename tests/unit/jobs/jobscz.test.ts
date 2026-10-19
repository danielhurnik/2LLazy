import { describe, it, expect } from "vitest";
import { parseCzechDate } from "@/lib/jobs/sources/jobscz";

describe("parseCzechDate", () => {
  const now = new Date(2026, 9, 13);

  it("parses day + Czech month name in the current year", () => {
    expect(parseCzechDate("22. září", now)).toEqual(new Date(2026, 8, 22));
    expect(parseCzechDate(" 1. října ", now)).toEqual(new Date(2026, 9, 1));
  });

  it("rolls future dates back a year", () => {
    expect(parseCzechDate("5. prosince", now)).toEqual(new Date(2025, 11, 5));
  });

  it("returns undefined for status words", () => {
    expect(parseCzechDate("Nové")).toBeUndefined();
    expect(parseCzechDate("")).toBeUndefined();
  });
});
