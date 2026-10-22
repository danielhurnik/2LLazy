import { describe, it, expect } from "vitest";
import {
  detectCity,
  detectSeniority,
  detectWorkType,
  extractSkills,
  normalizeJob,
  parseSalary,
} from "@/lib/jobs/normalize";

describe("parseSalary", () => {
  it("parses Czech monthly ranges with thousands separators", () => {
    expect(parseSalary("45 000 - 80 000 Kč / měsíc")).toEqual({ min: 45000, max: 80000, currency: "CZK", period: "month" });
  });

  it("handles 'až 210 000 Kč / měsíc' (single figure)", () => {
    expect(parseSalary("až 210 000 Kč / měsíc")).toMatchObject({ min: 210000, max: 210000, currency: "CZK" });
  });

  it("expands k / tis. suffixes and a dropped-thousands first figure", () => {
    expect(parseSalary("45-80 tis. Kč")).toMatchObject({ min: 45000, max: 80000 });
    expect(parseSalary("45-80 000 Kč")).toMatchObject({ min: 45000, max: 80000 });
  });

  it("recognises EUR and hourly rates", () => {
    expect(parseSalary("600 - 900 € / MD")).toMatchObject({ min: 600, max: 900, currency: "EUR", period: "day" });
    expect(parseSalary("800 Kč/hod")).toMatchObject({ min: 800, currency: "CZK", period: "hour" });
  });

  it("returns nulls for empty or 'Navrhni si mzdu'", () => {
    expect(parseSalary(undefined).min).toBeNull();
    expect(parseSalary("Navrhni si mzdu").min).toBeNull();
  });
});

describe("detectCity", () => {
  it("maps Czech and English spellings to one canonical name", () => {
    expect(detectCity("Praha, Česká Republika")).toBe("Praha");
    expect(detectCity("Prague (hybrid)")).toBe("Praha");
    expect(detectCity("Hradec Králové")).toBe("Hradec Králové");
    expect(detectCity("Remote")).toBeNull();
  });
});

describe("detectWorkType / detectSeniority", () => {
  it("reads explicit and implicit work modes", () => {
    expect(detectWorkType({ workType: "Fully remote", title: "", location: "" })).toBe("Remote");
    expect(detectWorkType({ title: "Frontend Developer | Angular | Hybrid (Prague)", location: "Praha" })).toBe("Hybrid");
    expect(detectWorkType({ title: "Java Developer", location: "Brno" })).toBeUndefined();
  });

  it("detects seniority from the title", () => {
    expect(detectSeniority("Senior Frontend Developer")).toBe("senior");
    expect(detectSeniority("NEXT.js developer (Medior)")).toBe("mid");
    expect(detectSeniority("Frontend Architect")).toBe("lead");
    expect(detectSeniority("Absolvent – tester")).toBe("junior");
    expect(detectSeniority("React developer")).toBeNull();
  });
});

describe("extractSkills", () => {
  it("finds skills including symbol-bearing names", () => {
    const skills = extractSkills("We use React, TypeScript, Next.js, C# and .NET on AWS with Docker.");
    expect(skills).toEqual(expect.arrayContaining(["React", "TypeScript", "Next.js", "C#", ".NET", "AWS", "Docker"]));
    expect(skills).not.toContain("Go");
  });
});

describe("normalizeJob", () => {
  it("produces a canonical, enriched job", () => {
    const job = normalizeJob(
      {
        title: "React developerReact developer",
        company: "TESCO SW a.s.",
        location: "Olomouc, Česko",
        description: "Hledáme frontend programátora.\n\n\n\nZnalost React, TypeScript.",
        url: "https://www.jobs.cz/rpd/1/?searchId=x&rps=1",
        source: "JOBSCZ",
        salary: "45 000 - 80 000 Kč / měsíc",
      },
      "CZ",
    );
    expect(job.title).toBe("React developer");
    expect(job.sourceUrl).toBe("https://www.jobs.cz/rpd/1/");
    expect(job.city).toBe("Olomouc");
    expect(job.salaryMin).toBe(45000);
    expect(job.salaryCurrency).toBe("CZK");
    expect(job.skills).toEqual(expect.arrayContaining(["React", "TypeScript"]));
    expect(job.description).not.toMatch(/\n{3,}/);
    expect(job.remote).toBeNull();
  });
});

describe("normalizeJob apply path", () => {
  const raw = {
    title: "React developer",
    company: "Firma s.r.o.",
    description: "Hledáme React vývojáře.",
    url: "https://firma.cz/kariera/react",
    source: "WEB" as const,
  };

  it("keeps the apply path a source provided", () => {
    const applyPath = { kind: "ats-api" as const, url: raw.url, ats: "recruitee", slug: "firma", postingId: "1" };
    expect(normalizeJob({ ...raw, applyPath }, "CZ").applyPath).toEqual(applyPath);
  });

  it("captures a hiring address from the description", () => {
    const job = normalizeJob({ ...raw, description: "Životopis pošlete na Kariera@firma.cz, dotazy na gdpr@firma.cz." }, "CZ");
    expect(job.applyPath).toEqual({ kind: "email", url: raw.url, email: "kariera@firma.cz" });
  });

  it("falls back to the board form", () => {
    expect(normalizeJob(raw, "CZ").applyPath).toEqual({ kind: "board-form", url: raw.url });
  });
});
