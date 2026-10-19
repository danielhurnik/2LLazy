import { describe, it, expect } from "vitest";
import { enforceShape, findUnsupportedClaims } from "@/lib/apply/ollamaMapper";

const NAME = "Daniel Hurník";

describe("findUnsupportedClaims", () => {
  const cv = "Daniel Hurník. Frontend developer. React, TypeScript, Next.js, Node.js. Praha.";
  const job = "Hledáme vývojáře React + GIS. Požadujeme Esri, Kotlin, .NET, Java, TypeScript a AI nástroje.";

  it("flags technologies that come from the job description but not from the CV", () => {
    const draft = "Dobrý den,\n\nMám zkušenosti s Reactem, TypeScriptem a ESRI platformou a back-endem v Kotlin a .NET.\n\nDaniel Hurník";
    expect(findUnsupportedClaims(draft, cv, job, [NAME, "Integra"]).sort()).toEqual(["ESRI", "Kotlin", ".NET"].sort());
  });

  it("accepts claims that the CV supports and ignores names and sentence starts", () => {
    const draft = "Dobrý den,\n\nPracuji s React a TypeScript. Praha je moje město.\n\nDaniel Hurník";
    expect(findUnsupportedClaims(draft, cv, job, [NAME, "Integra Czech Republic"])).toEqual([]);
  });
});

describe("enforceShape", () => {
  it("replaces a wrong Czech greeting and keeps the signature line", () => {
    const text = "Dobré ráno,\n\nHlásím se na pozici.\n\nS pozdravem,\nDaniel Hurník";
    expect(enforceShape(text, true, NAME)).toBe("Dobrý den,\n\nHlásím se na pozici.\n\nS pozdravem,\nDaniel Hurník");
  });

  it("adds a greeting and a sign-off when the model left them out", () => {
    const text = "Hlásím se na pozici a rád se dozvím více.";
    expect(enforceShape(text, true, NAME)).toBe("Dobrý den,\n\nHlásím se na pozici a rád se dozvím více.\n\nS pozdravem,\nDaniel Hurník");
  });

  it("moves an inline signature onto its own last line", () => {
    const text = "Hello,\n\nI am applying for the role.\n\nBest regards, Daniel Hurník.";
    expect(enforceShape(text, false, NAME)).toBe("Hello,\n\nI am applying for the role.\n\nBest regards,\nDaniel Hurník");
  });

  it("normalises a trailing period after the name", () => {
    const text = "Dobrý den,\n\nText.\n\nDaniel Hurník.";
    expect(enforceShape(text, true, NAME).endsWith("\nDaniel Hurník")).toBe(true);
  });
});
