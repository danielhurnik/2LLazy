import { describe, expect, it } from "vitest";
import {
  composeCoverLetter,
  streamCoverLetter,
  chunkForStreaming,
  extractKeywords,
  containsKeyword,
  SUPPORTED_LETTER_LANGUAGES,
} from "@/lib/coverLetter";
import { buildCvMatchReport, renderCvMatchMarkdown } from "@/lib/cvMatch";

const CV = `Jane Doe
jane.doe@example.com | +420 777 123 456 | github.com/janedoe

EXPERIENCE
Senior Frontend Developer, Acme s.r.o. (2022 - present)
- Built a React and TypeScript design system used by 40 engineers
- Cut bundle size by 38% and first paint by 1.2s
Frontend Developer, Beta Ltd (2019 - 2022)
- Vue 2 to Vue 3 migration across 60 components

SKILLS
React, TypeScript, JavaScript, CSS, Redux, Vite, Jest, Vue

EDUCATION
BSc Computer Science, Charles University, 2019`;

const JOB = {
  jobTitle: "Senior React Developer",
  company: "Pixel Labs",
  jobDescription:
    "We need a senior React developer. React, TypeScript, Next.js, Redux, GraphQL and Kubernetes. " +
    "Kubernetes experience is important. You will mentor juniors. GraphQL federation is a plus. Kubernetes again.",
};

describe("composeCoverLetter", () => {
  const letter = composeCoverLetter({ ...JOB, cvText: CV, language: "English" });

  it("names the role and company", () => {
    expect(letter.content).toContain("Senior React Developer");
    expect(letter.content).toContain("Pixel Labs");
  });

  it("only claims skills the CV actually evidences", () => {
    expect(letter.matchedSkills).toEqual(expect.arrayContaining(["React", "TypeScript", "Redux"]));
    // The CV never mentions these; the letter must not pretend otherwise.
    expect(letter.matchedSkills).not.toContain("Kubernetes");
    expect(letter.matchedSkills).not.toContain("GraphQL");
  });

  it("surfaces the gaps instead of hiding them", () => {
    expect(letter.gaps).toEqual(expect.arrayContaining(["Kubernetes", "GraphQL"]));
  });

  it("signs off with the details from the CV", () => {
    expect(letter.content).toContain("Jane Doe");
    expect(letter.content).toContain("jane.doe@example.com");
  });

  it("reads the current role without swallowing the date range", () => {
    // Regression: "(2022 - present)" made the role/company splitter fire on the
    // date dash, producing "Acme s.r.o. (2022 at present".
    expect(letter.content).toContain("Senior Frontend Developer");
    expect(letter.content).toContain("Acme s.r.o.");
    expect(letter.content).not.toContain("at present)");
    expect(letter.content).not.toMatch(/[^.]\.\.(?!\.)/);
  });

  it("marks every unknown as a placeholder rather than inventing it", () => {
    expect(letter.placeholders.length).toBeGreaterThan(0);
    for (const placeholder of letter.placeholders) {
      expect(letter.content).toContain(placeholder);
    }
    expect(letter.content).toMatch(/«.+»/);
  });

  it("leaves no unresolved template artefacts", () => {
    expect(letter.content).not.toContain("undefined");
    expect(letter.content).not.toContain("[object Object]");
    expect(letter.content).not.toMatch(/\{\w+\}/);
  });

  it("still produces a usable skeleton with no CV", () => {
    const empty = composeCoverLetter({ ...JOB, cvText: "", language: "English" });
    expect(empty.content).toContain("Pixel Labs");
    expect(empty.matchedSkills).toHaveLength(0);
    expect(empty.placeholders.length).toBeGreaterThan(0);
    expect(empty.content).not.toContain("undefined");
  });

  it("localises the fixed strings for every supported language", () => {
    const english = composeCoverLetter({ ...JOB, cvText: CV, language: "English" }).content;
    for (const language of SUPPORTED_LETTER_LANGUAGES) {
      const localised = composeCoverLetter({ ...JOB, cvText: CV, language }).content;
      expect(localised.length, language).toBeGreaterThan(100);
      expect(localised, language).toContain("Pixel Labs");
      if (language !== "English") expect(localised, language).not.toBe(english);
    }
  });

  it("falls back to English for an unknown language", () => {
    const letter = composeCoverLetter({ ...JOB, cvText: CV, language: "Klingon" });
    expect(letter.content).toContain("Pixel Labs");
    expect(letter.content.length).toBeGreaterThan(100);
  });
});

describe("streaming", () => {
  it("reassembles to exactly the composed letter", () => {
    const input = { ...JOB, cvText: CV, language: "English" };
    const whole = composeCoverLetter(input).content;
    expect([...streamCoverLetter(input)].join("")).toBe(whole);
  });

  it("chunks text losslessly", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const chunks = [...chunkForStreaming(text, 40)];
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("never splits a word across two chunks", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    // A chunk runs up to (not past) the next whitespace, so every boundary
    // lands between words and each following chunk opens with that whitespace.
    // The typing animation therefore never shows a half-written word.
    const chunks = [...chunkForStreaming(text, 40)];
    for (const chunk of chunks.slice(1)) {
      expect(chunk).toMatch(/^\s/);
    }
  });

  it("emits a single chunk for text with nowhere to break", () => {
    const unbroken = "a".repeat(250);
    expect([...chunkForStreaming(unbroken, 40)]).toEqual([unbroken]);
  });

  it("handles empty input", () => {
    expect([...chunkForStreaming("")].join("")).toBe("");
  });
});

describe("keyword vocabulary", () => {
  it("counts occurrences and orders by frequency", () => {
    const hits = extractKeywords(JOB.jobDescription);
    expect(hits[0].count).toBeGreaterThanOrEqual(hits[hits.length - 1].count);
    expect(hits.find((h) => h.label === "Kubernetes")?.count).toBe(3);
  });

  it("matches on word boundaries, not substrings", () => {
    expect(containsKeyword("We use Go daily", "Go")).toBe(true);
    expect(containsKeyword("A good going concern", "Go")).toBe(false);
  });

  it("ignores diacritics and case", () => {
    expect(containsKeyword("react a typescript", "React")).toBe(true);
  });
});

describe("buildCvMatchReport", () => {
  const report = buildCvMatchReport(CV, {
    title: JOB.jobTitle,
    company: JOB.company,
    description: JOB.jobDescription,
  });

  it("computes coverage from matched over total keywords", () => {
    expect(report.coverage).toBe(
      Math.round((report.matched.length / (report.matched.length + report.missing.length)) * 100),
    );
    expect(report.coverage).toBeGreaterThan(0);
    expect(report.coverage).toBeLessThan(100);
  });

  it("quotes the CV line backing each match", () => {
    for (const { cvContext } of report.matched) {
      expect(cvContext.length).toBeGreaterThan(0);
      expect(CV.replace(/\s+/g, " ")).toContain(cvContext.replace(/…$/, ""));
    }
  });

  it("calls out an emphasised requirement the CV never mentions", () => {
    expect(report.missing).toContain("Kubernetes");
    expect(report.suggestions.join(" ")).toContain("Kubernetes");
  });

  it("reports zero coverage rather than a divide-by-zero for an empty posting", () => {
    const empty = buildCvMatchReport(CV, { title: "", company: "", description: "" });
    expect(empty.coverage).toBe(0);
    expect(Number.isFinite(empty.coverage)).toBe(true);
    expect(empty.suggestions.length).toBeGreaterThan(0);
  });

  it("says so plainly when there is no CV", () => {
    const none = buildCvMatchReport("", {
      title: JOB.jobTitle,
      company: JOB.company,
      description: JOB.jobDescription,
    });
    expect(none.coverage).toBe(0);
    expect(none.suggestions.join(" ")).toMatch(/upload/i);
  });

  it("renders markdown that states what it is", () => {
    const markdown = renderCvMatchMarkdown(report, { title: JOB.jobTitle, company: JOB.company });
    expect(markdown).toContain("# CV match report");
    expect(markdown).toContain(`${report.coverage}%`);
    expect(markdown).toContain("keyword matching");
    expect(markdown).not.toContain("undefined");
  });
});
