import { describe, it, expect } from "vitest";
import { heuristicProfile, searchProfileSchema } from "@/lib/jobs/profile";

const CV = `Jan Novák
Senior Frontend Developer
Praha, Czech Republic · jan@example.com · +420 777 123 456

Profile
Frontend developer with 8 years of experience building React and TypeScript applications. Open to remote work.

Experience
Senior Frontend Developer — Acme (2020–2024)
- Built a Next.js dashboard, GraphQL API integration, Playwright tests
Frontend Developer — Beta s.r.o. (2016–2020)
- Vue.js, Node.js, PostgreSQL

Languages
Czech (native), English (C1), German (A2)
`;

describe("heuristicProfile", () => {
  const profile = heuristicProfile(CV, "CZ");

  it("reads titles, skills, seniority, city, remote preference and languages from the CV text", () => {
    expect(profile.titles[0]).toBe("Senior Frontend Developer");
    expect(profile.titles).toContain("Frontend Developer");
    expect(profile.skills).toEqual(expect.arrayContaining(["React", "TypeScript", "Next.js", "GraphQL", "PostgreSQL"]));
    expect(profile.seniority).toBe("senior");
    expect(profile.cities).toEqual(["Praha"]);
    expect(profile.remote).toBe(true);
    expect(profile.languages).toEqual(expect.arrayContaining(["Czech", "English", "German"]));
    expect(profile.source).toBe("cv");
  });

  it("falls back to years of experience when no title carries a seniority word", () => {
    const junior = heuristicProfile("Frontend developer with 2 years of experience in React.", "CZ");
    expect(junior.seniority).toBe("junior");
    const mid = heuristicProfile("Backend engineer, 4 years building Java services.", "CZ");
    expect(mid.seniority).toBe("mid");
  });

  it("produces a profile that satisfies the stored schema", () => {
    expect(searchProfileSchema.safeParse(profile).success).toBe(true);
    expect(searchProfileSchema.safeParse({ ...profile, seniority: "guru" }).success).toBe(false);
  });
});
