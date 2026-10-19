import { describe, it, expect } from "vitest";
import { bannedPhrases, copiedPhrases, enforceShape, findUnsupportedClaims, shortCompanyName } from "@/lib/apply/ollamaMapper";

const NAME = "Daniel Hurník";

describe("anti-template checks", () => {
  it("flags the usual AI tells in Czech and English", () => {
    const czech = bannedPhrases("Jsem nadšený, že firma hledá šikovného vývojáře. Můj AI-mindset by mohl být prospěšný.");
    expect(czech.map((p) => p.toLowerCase().slice(0, 5)).sort()).toEqual(["minds", "nadše", "prosp", "šikov"].sort());
    expect(bannedPhrases("I am excited to leverage my passion.").length).toBe(3);
    expect(bannedPhrases("hlásím se na pozici frontend vývojáře.")).toEqual([]);
  });

  it("flags five-word phrases copied from the job description but not the job title", () => {
    const job = "Zapojíte se do projektu zaměřeného na automatizované plánování a projektování optické sítě.";
    expect(copiedPhrases("Zaujal mě projekt zaměřený na automatizované plánování a projektování optické sítě.", job)).toContain("automatizované plánování a projektování optické");
    expect(copiedPhrases("Zaujala mě práce s mapovými daty.", job)).toEqual([]);
    expect(copiedPhrases("hlásím se na pozici Vývojář React + GIS se zaměřením na AI.", "Vývojář React + GIS se zaměřením na AI a automatizaci", "Vývojář React + GIS se zaměřením na AI a automatizaci")).toEqual([]);
  });

  it("only treats experience sentences as claims", () => {
    const cv = "React, TypeScript.";
    const job = "Požadujeme Kotlin a Esri.";
    expect(findUnsupportedClaims("Dobrý den,\n\nmám zkušenosti s Kotlin.\n\nDaniel", cv, job, [])).toEqual(["Kotlin"]);
    expect(findUnsupportedClaims("Dobrý den,\n\nrád bych se naučil Kotlin.\n\nDaniel", cv, job, [])).toEqual([]);
  });

  it("catches inflected domain terms and years borrowed from the ad", () => {
    const cv = "Jsem vývojář s více než tříletou praxí ve vývoji SaaS aplikací. React, TypeScript.";
    const job = "Budete pracovat s mapovými daty a geografickými informačními systémy. Požadujeme čtyři roky praxe.";
    const draft = "Dobrý den,\n\nmám za sebou více než čtyři roky práce s React a v minulosti jsem se podílel na projektu, který využíval mapová data.\n\nDaniel";
    const skills = ["GIS", "mapová data", "React"];
    const flagged = findUnsupportedClaims(draft, cv, job, ["Daniel Hurník"], skills);
    expect(flagged.some((f) => /mapov/i.test(f))).toBe(true);
    expect(flagged.some((f) => /čtyři roky/i.test(f))).toBe(true);
    const honest = "Dobrý den,\n\nmám za sebou více než tři roky práce s React a TypeScriptem a rád bych se naučil pracovat s mapovými daty.\n\nDaniel";
    expect(findUnsupportedClaims(honest, cv, job, ["Daniel Hurník"], skills)).toEqual([]);
    const ordinary = "Dobrý den,\n\nposledních pár let pracuji s React a využívám moderní nástroje.\n\nDaniel";
    expect(findUnsupportedClaims(ordinary, cv, "V posledních letech využíváme moderní nástroje.", ["Daniel Hurník"], skills)).toEqual([]);
  });

  it("drops the legal suffix from company names", () => {
    expect(shortCompanyName("Integra Czech Republic, s.r.o.")).toBe("Integra Czech Republic");
    expect(shortCompanyName("Dawiso a.s.")).toBe("Dawiso");
    expect(shortCompanyName("Dawiso")).toBe("Dawiso");
  });
});

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
  it("replaces a wrong Czech greeting, lowercases the continuation and keeps the signature line", () => {
    const text = "Dobré ráno,\n\nHlásím se na pozici.\n\nS pozdravem,\nDaniel Hurník";
    expect(enforceShape(text, true, NAME)).toBe("Dobrý den,\n\nhlásím se na pozici.\n\nS pozdravem,\nDaniel Hurník");
  });

  it("adds a greeting and a sign-off when the model left them out", () => {
    const text = "Hlásím se na pozici a rád se dozvím více.";
    expect(enforceShape(text, true, NAME)).toBe("Dobrý den,\n\nhlásím se na pozici a rád se dozvím více.\n\nS pozdravem,\nDaniel Hurník");
  });

  it("moves an inline signature onto its own last line", () => {
    const text = "Hello,\n\nI am applying for the role.\n\nBest regards, Daniel Hurník.";
    expect(enforceShape(text, false, NAME)).toBe("Hello,\n\nI am applying for the role.\n\nBest regards,\nDaniel Hurník");
  });

  it("drops anything the model wrote under the signature and never signs twice", () => {
    const text = "Dobrý den,\n\nhlásím se.\n\nDaniel Hurník\nIntegra Czech Republic";
    expect(enforceShape(text, true, NAME)).toBe("Dobrý den,\n\nhlásím se.\n\nDaniel Hurník");
  });

  it("lowercases a shouting first word", () => {
    expect(enforceShape("Dobrý den,\n\nHLÁSÍM SE na pozici.\n\nDaniel Hurník", true, NAME)).toBe("Dobrý den,\n\nhlásím se na pozici.\n\nDaniel Hurník");
  });

  it("normalises a trailing period after the name", () => {
    const text = "Dobrý den,\n\nText.\n\nDaniel Hurník.";
    expect(enforceShape(text, true, NAME).endsWith("\nDaniel Hurník")).toBe(true);
  });
});
