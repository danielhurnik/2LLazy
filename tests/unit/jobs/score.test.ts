import { describe, it, expect } from "vitest";
import { lookupIntent } from "@/lib/queryIntent";
import { normalizeJob } from "@/lib/jobs/normalize";
import { SCORE_THRESHOLD, scoreJob, type ScoreRequest } from "@/lib/jobs/score";
import type { RawJob } from "@/lib/jobs/sources/types";

const ONE_DAY_MS = 86_400_000;
const STRONG_MATCH_SCORE = 0.7;

function normalizedJob(overrides: Partial<RawJob> = {}) {
  return normalizeJob(
    {
      title: "React Developer",
      company: "Acme",
      location: "Praha",
      description: "React, TypeScript, Next.js, CSS, REST API integration, modern frontend tooling.",
      url: "https://example.com/job/1",
      source: "JOBSCZ",
      salary: "60 000 - 90 000 Kč / měsíc",
      postedAt: new Date(Date.now() - 2 * ONE_DAY_MS),
      ...overrides,
    },
    "CZ",
  );
}

const scoreRequest = (overrides: Partial<ScoreRequest> = {}): ScoreRequest => ({
  query: "react",
  skillLevel: "Any",
  city: "",
  intent: lookupIntent("react"),
  ...overrides,
});

describe("scoreJob", () => {
  it("ranks a matching, recent, salaried posting well above the threshold with reasons", () => {
    const result = scoreJob(scoreRequest(), normalizedJob());
    expect(result.score).toBeGreaterThan(STRONG_MATCH_SCORE);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^Title matches/), "Praha", "Posted this week", "Salary listed"]));
    expect(result.rejectedBy).toBeUndefined();
  });

  it("hard-rejects excluded titles that nothing in the title rescues", () => {
    const result = scoreJob(scoreRequest(), normalizedJob({ title: "DevOps Engineer", description: "Kubernetes and AWS." }));
    expect(result.score).toBe(0);
    expect(result.rejectedBy).toBe("DevOps");
  });

  it("keeps a 'Fullstack React developer' for a React search", () => {
    const result = scoreJob(scoreRequest(), normalizedJob({ title: "Fullstack React developer" }));
    expect(result.rejectedBy).toBeUndefined();
    expect(result.score).toBeGreaterThanOrEqual(SCORE_THRESHOLD);
  });

  it("ranks a same-city job above a stronger-titled job in another city", () => {
    const brnoWeakTitle = scoreJob(scoreRequest({ query: "React developer", city: "Brno" }), normalizedJob({ title: "Frontend developer", location: "Brno" }));
    const prahaExactTitle = scoreJob(scoreRequest({ query: "React developer", city: "Brno" }), normalizedJob({ title: "React developer", location: "Praha" }));
    expect(prahaExactTitle.reasons).toContain("Located in Praha, not Brno");
    expect(brnoWeakTitle.score).toBeGreaterThan(prahaExactTitle.score);
  });

  it("demotes a job in an unlisted town when a city was requested, but not one whose location says remote", () => {
    const request = scoreRequest({ query: "React developer", city: "Brno" });
    const smallTown = scoreJob(request, normalizedJob({ location: "Český Krumlov" }));
    const remoteRegion = scoreJob(request, normalizedJob({ location: "Jižní Čechy/remote" }));
    const brno = scoreJob(request, normalizedJob({ location: "Brno" }));
    expect(smallTown.reasons).toContain("Located in Český Krumlov, not Brno");
    expect(remoteRegion.reasons).not.toContainEqual(expect.stringMatching(/^Located in/));
    expect(brno.score).toBeGreaterThan(smallTown.score);
  });

  it("prefers the requested city and treats remote as a match", () => {
    const praha = scoreJob(scoreRequest({ city: "Praha" }), normalizedJob()).score;
    const brno = scoreJob(scoreRequest({ city: "Praha" }), normalizedJob({ location: "Brno" })).score;
    const remote = scoreJob(scoreRequest({ city: "Praha" }), normalizedJob({ location: "Remote", workType: "Remote" })).score;
    expect(praha).toBeGreaterThan(brno);
    expect(remote).toBeGreaterThan(brno);
  });

  it("penalises a seniority mismatch and rewards a match", () => {
    const senior = scoreJob(scoreRequest({ skillLevel: "Senior" }), normalizedJob({ title: "Senior React Developer" }));
    const junior = scoreJob(scoreRequest({ skillLevel: "Senior" }), normalizedJob({ title: "Junior React Developer" }));
    expect(senior.score).toBeGreaterThan(junior.score);
    expect(junior.reasons).toContain("Seniority mismatch (junior)");
  });

  it("uses a salary range when the user gives one", () => {
    const inRange = scoreJob(scoreRequest({ salaryMin: 50000, salaryMax: 100000 }), normalizedJob());
    const outOfRange = scoreJob(scoreRequest({ salaryMin: 150000, salaryMax: null }), normalizedJob());
    expect(inRange.reasons).toContain("Salary in your range");
    expect(inRange.score).toBeGreaterThan(outOfRange.score);
  });

  it("drops an unrelated posting below the threshold", () => {
    const result = scoreJob(scoreRequest(), normalizedJob({ title: "Accountant", description: "Invoices, bookkeeping, VAT.", salary: undefined }));
    expect(result.score).toBeLessThan(SCORE_THRESHOLD);
  });
});
