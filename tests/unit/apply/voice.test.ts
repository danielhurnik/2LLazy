import { describe, expect, it } from "vitest";
import { bannedPhrases, enforceShape, styleProblems } from "@/lib/apply/ollamaMapper";
import { calibrationActive, centroid, cosine, meaningfullyEdited, samplesForPrompt, textSimilarity, thresholdFromSamples, type VoiceConfig } from "@/lib/apply/voice";

const VOICE: VoiceConfig = {
  tone: [],
  limits: { minWords: 40, maxWords: 80, paragraphs: 2 },
  neverSay: ["rád bych se ucházel", "I would like to apply"],
  neverDo: [],
  samples: [
    { lang: "cs", text: "Dobrý den,\n\nhlásím se na pozici frontend vývojáře.\n\nDaniel" },
    { lang: "cs", text: "Dobrý den,\n\nmám zájem o React pozici u vás.\n\nDaniel" },
    { lang: "en", text: "Hi,\n\nI'm applying for the frontend role.\n\nDaniel" },
  ],
  calibration: { approvedSamplesNeeded: 10 },
};

describe("voice rules", () => {
  it("flags template openers from the config and the built-in list", () => {
    expect(bannedPhrases("Rád bych se ucházel o pozici.", VOICE.neverSay)).toContain("rád bych se ucházel");
    expect(bannedPhrases("I would like to apply for the role and I look forward to it.", VOICE.neverSay).length).toBeGreaterThanOrEqual(2);
    expect(bannedPhrases("hlásím se na pozici frontend vývojáře.", VOICE.neverSay)).toEqual([]);
  });

  it("flags gender slashes and skill lists", () => {
    expect(styleProblems("rád/a bych se dozvěděl/a víc.")[0]).toMatch(/gender slash/);
    expect(styleProblems("Umím React, TypeScript, Node a Docker.")).toContain("skill list");
    expect(styleProblems("Poslední rok dělám hlavně React a trochu backend.")).toEqual([]);
  });

  it("shapes the message in the relaxed register", () => {
    expect(enforceShape("Hello,\n\nI'm applying for the frontend role.\n\nBest regards,\nDaniel Hurník", false, "Daniel", "Daniel Hurník")).toBe(
      "Hi,\n\nI'm applying for the frontend role.\n\nThanks,\nDaniel",
    );
    expect(enforceShape("hlásím se na pozici.", true, "Daniel", "Daniel Hurník")).toBe("Dobrý den,\n\nhlásím se na pozici.\n\nDaniel");
    expect(enforceShape("Dobrý den,\n\nhlásím se.\n\nS pozdravem,\nDaniel", true, "Daniel")).toBe("Dobrý den,\n\nhlásím se.\n\nDíky,\nDaniel");
  });
});

describe("voice samples and guard maths", () => {
  it("rotates up to three samples of the right language", () => {
    const picked = samplesForPrompt(VOICE, "cs");
    expect(picked.length).toBe(2);
    expect(picked.every((s) => s.lang === "cs")).toBe(true);
    expect(samplesForPrompt(VOICE, "en").length).toBe(1);
  });

  it("stays in calibration until enough samples are approved", () => {
    expect(calibrationActive(VOICE)).toBe(true);
    expect(calibrationActive({ ...VOICE, samples: new Array(10).fill(VOICE.samples[0]) })).toBe(false);
  });

  it("derives a capped leave-one-out threshold with a wider margin for small pools", () => {
    const a = [1, 0, 0];
    const b = [0.9, 0.1, 0];
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(centroid([a, b])).toEqual([0.95, 0.05, 0]);
    const threshold = thresholdFromSamples([a, b]);
    expect(threshold).toBeLessThanOrEqual(0.85);
    expect(threshold).toBeLessThan(cosine(a, b) - 0.1);
    expect(thresholdFromSamples([a])).toBe(0.5);
  });

  it("treats a lightly touched draft as not edited and a rewritten one as edited", () => {
    const draft = "Dobrý den,\n\nhlásím se na pozici frontend vývojáře, poslední roky dělám React.\n\nDaniel";
    expect(textSimilarity(draft, draft)).toBe(1);
    expect(meaningfullyEdited(draft, draft.replace("poslední roky", "poslední tři roky"))).toBe(false);
    expect(meaningfullyEdited(draft, "Dobrý den,\n\nmám zájem o tu React pozici, teď dělám hlavně interní nástroje pro logistiku.\n\nDaniel")).toBe(true);
    expect(meaningfullyEdited(null, "napsal jsem si to sám")).toBe(true);
    expect(meaningfullyEdited(draft, "   ")).toBe(false);
  });
});
