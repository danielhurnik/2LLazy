/**
 * Ranking tests.
 *
 * These assert *ordering*, not absolute scores. The exact number a posting gets
 * is a tuning detail that should be free to move; what must not regress is that
 * a React job outranks a Vue job outranks a Kubernetes job when somebody
 * searches for React. That is the property the old embedding ranker provided
 * and the property this replacement has to keep.
 */
import { describe, expect, it } from "vitest";
import {
  buildCorpusStats,
  classifyQueryIntent,
  rankJobs,
  scoreJob,
  RELEVANCE_THRESHOLD,
  type ScoreInput,
} from "@/lib/matching";

/** A small corpus spanning the roles a developer search has to separate. */
const CORPUS: ScoreInput[] = [
  {
    title: "Senior React Developer",
    company: "Pixel Labs",
    description:
      "We are looking for a senior React developer to build our customer dashboard. You will work with React hooks, Redux, TypeScript and Next.js, and own the component library. Strong CSS skills required.",
    location: "Prague, Czech Republic",
    workType: "Hybrid",
  },
  {
    title: "Frontend Engineer (React)",
    company: "Northwind",
    description:
      "Join our frontend team building single-page applications in React and TypeScript. Responsive design, accessibility, and a shared component library. Some Node.js for BFF endpoints.",
    location: "Remote",
    workType: "Remote",
  },
  {
    title: "Vue.js Developer",
    company: "Atlas",
    description:
      "Vue 3 and Nuxt developer wanted. Composition API, Pinia, TypeScript, responsive CSS. You will build our storefront frontend.",
    location: "Berlin, Germany",
    workType: "Onsite",
  },
  {
    title: "Fullstack Developer (React / Node.js)",
    company: "Orbit",
    description:
      "Fullstack role owning features end to end: React frontend, Node.js and PostgreSQL backend, REST APIs, deployed with Docker.",
    location: "Remote",
    workType: "Remote",
  },
  {
    title: "Backend Engineer — Node.js",
    company: "Cargoline",
    description:
      "Backend developer building REST and GraphQL APIs in Node.js and TypeScript, PostgreSQL, Redis, microservices on Kubernetes.",
    location: "Prague, Czech Republic",
    workType: "Hybrid",
  },
  {
    title: "DevOps Engineer",
    company: "Statecraft",
    description:
      "Kubernetes, Terraform, CI/CD pipelines, AWS infrastructure, Prometheus and Grafana observability. Infrastructure as code.",
    location: "Remote",
    workType: "Remote",
  },
  {
    title: "iOS Developer",
    company: "Handset",
    description: "Native iOS development in Swift and SwiftUI, UIKit, Core Data, App Store releases.",
    location: "Prague, Czech Republic",
    workType: "Onsite",
  },
  {
    title: "QA Automation Engineer",
    company: "Provenance",
    description:
      "Test automation with Playwright and Cypress, regression suites, CI test pipelines, Jira bug tracking.",
    location: "Brno, Czech Republic",
    workType: "Hybrid",
  },
  {
    title: "Data Engineer",
    company: "Riverbed",
    description: "ETL pipelines with Airflow and Spark, dbt models, BigQuery warehouse, Python and SQL.",
    location: "Remote",
    workType: "Remote",
  },
  // Traps: plausible-looking postings that must not win a developer search.
  {
    title: "IT Director",
    company: "Meridian Group",
    description:
      "Lead our IT department. Budget ownership, vendor management, team leadership. Familiarity with modern web technologies such as React and Node.js is a plus.",
    location: "Prague, Czech Republic",
    workType: "Onsite",
  },
  {
    title: "Technical Recruiter",
    company: "Talentworks",
    description:
      "Hire React, Node.js and Kubernetes engineers. You will source candidates, run screening calls and manage the pipeline.",
    location: "Remote",
    workType: "Remote",
  },
  {
    title: "Junior React Developer",
    company: "Startbase",
    description:
      "Entry-level React position. You will learn React, JavaScript and CSS alongside our senior developers. No prior commercial experience required.",
    location: "Prague, Czech Republic",
    workType: "Onsite",
  },
];

function rank(query: string, skillLevel = "", ctx = {}) {
  const intent = classifyQueryIntent(query, skillLevel);
  return rankJobs(CORPUS, intent, ctx);
}

function positionOf(ranked: Array<{ title: string }>, title: string): number {
  return ranked.findIndex((job) => job.title === title);
}

function scoreOf(ranked: Array<{ title: string; score: number }>, title: string): number {
  return ranked.find((job) => job.title === title)?.score ?? 0;
}

describe("scoreJob — ordering for a React search", () => {
  const ranked = rank("react");

  it("puts the React roles above the Vue role", () => {
    expect(positionOf(ranked, "Senior React Developer")).toBeLessThan(positionOf(ranked, "Vue.js Developer"));
    expect(positionOf(ranked, "Frontend Engineer (React)")).toBeLessThan(positionOf(ranked, "Vue.js Developer"));
  });

  it("puts the React roles above the backend and infrastructure roles", () => {
    const worstReact = Math.max(
      positionOf(ranked, "Senior React Developer"),
      positionOf(ranked, "Frontend Engineer (React)"),
    );
    expect(worstReact).toBeLessThan(positionOf(ranked, "Backend Engineer — Node.js"));
    expect(worstReact).toBeLessThan(positionOf(ranked, "DevOps Engineer"));
    expect(worstReact).toBeLessThan(positionOf(ranked, "iOS Developer"));
  });

  it("drops the traps below the relevance threshold", () => {
    // Both mention React repeatedly, which is exactly why they used to leak in.
    expect(scoreOf(ranked, "IT Director")).toBeLessThan(RELEVANCE_THRESHOLD);
    expect(scoreOf(ranked, "Technical Recruiter")).toBeLessThan(RELEVANCE_THRESHOLD);
  });

  it("keeps the clearly relevant roles above the threshold", () => {
    expect(scoreOf(ranked, "Senior React Developer")).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
    expect(scoreOf(ranked, "Frontend Engineer (React)")).toBeGreaterThanOrEqual(RELEVANCE_THRESHOLD);
  });

  it("surfaces the fullstack role, which genuinely involves React", () => {
    expect(scoreOf(ranked, "Fullstack Developer (React / Node.js)")).toBeGreaterThanOrEqual(
      RELEVANCE_THRESHOLD,
    );
  });
});

describe("scoreJob — other queries", () => {
  it("a backend search does not surface the frontend-only roles", () => {
    const ranked = rank("backend");
    expect(positionOf(ranked, "Backend Engineer — Node.js")).toBeLessThan(
      positionOf(ranked, "Senior React Developer"),
    );
    expect(scoreOf(ranked, "Vue.js Developer")).toBeLessThan(RELEVANCE_THRESHOLD);
  });

  it("a fullstack search surfaces both sides of the stack", () => {
    const ranked = rank("fullstack");
    expect(scoreOf(ranked, "Fullstack Developer (React / Node.js)")).toBeGreaterThanOrEqual(
      RELEVANCE_THRESHOLD,
    );
    expect(positionOf(ranked, "Fullstack Developer (React / Node.js)")).toBeLessThan(
      positionOf(ranked, "DevOps Engineer"),
    );
  });

  it("a devops search leads with the infrastructure role", () => {
    const ranked = rank("devops");
    expect(ranked[0].title).toBe("DevOps Engineer");
  });

  it("a QA search leads with the QA role", () => {
    const ranked = rank("qa");
    expect(ranked[0].title).toBe("QA Automation Engineer");
  });

  it("an unknown query still ranks by literal match", () => {
    const ranked = rank("airflow");
    expect(ranked[0].title).toBe("Data Engineer");
  });

  it("a query naming two skills favours the posting that has both", () => {
    const ranked = rank("react node");
    expect(positionOf(ranked, "Fullstack Developer (React / Node.js)")).toBeLessThan(
      positionOf(ranked, "Vue.js Developer"),
    );
  });
});

describe("scoreJob — modifiers", () => {
  it("demotes a junior posting when the user asked for senior", () => {
    const senior = rank("react", "Senior");
    const any = rank("react");
    expect(scoreOf(senior, "Junior React Developer")).toBeLessThan(
      scoreOf(any, "Junior React Developer"),
    );
    expect(positionOf(senior, "Senior React Developer")).toBeLessThan(
      positionOf(senior, "Junior React Developer"),
    );
  });

  it("demotes onsite roles when remoteOnly is set", () => {
    const withoutFlag = rank("react");
    const withFlag = rank("react", "", { remoteOnly: true });
    expect(scoreOf(withFlag, "Junior React Developer")).toBeLessThan(
      scoreOf(withoutFlag, "Junior React Developer"),
    );
    expect(scoreOf(withFlag, "Frontend Engineer (React)")).toBeCloseTo(
      scoreOf(withoutFlag, "Frontend Engineer (React)"),
      5,
    );
  });

  it("boosts a posting in the searched city", () => {
    const neutral = rank("react");
    const inPrague = rank("react", "", { city: "Prague" });
    expect(scoreOf(inPrague, "Senior React Developer")).toBeGreaterThan(
      scoreOf(neutral, "Senior React Developer"),
    );
  });

  it("ranks a title match above the same term in the body only", () => {
    const intent = classifyQueryIntent("kubernetes");
    const inTitle = scoreJob(
      { title: "Kubernetes Platform Engineer", description: "Platform work." },
      intent,
    );
    const inBody = scoreJob(
      { title: "Software Engineer", description: "Some of our services run on Kubernetes." },
      intent,
    );
    expect(inTitle.score).toBeGreaterThan(inBody.score);
  });

  it("never penalises a posting for having no date", () => {
    const intent = classifyQueryIntent("react");
    const job: ScoreInput = { title: "React Developer", description: "React and TypeScript." };
    const undated = scoreJob(job, intent);
    const fresh = scoreJob({ ...job, postedAt: new Date() }, intent);
    expect(fresh.score).toBeGreaterThanOrEqual(undated.score);
  });
});

describe("scoreJob — explanations", () => {
  it("reports the terms it matched and why", () => {
    const intent = classifyQueryIntent("react");
    const result = scoreJob(CORPUS[0], intent);
    expect(result.matched).toContain("react");
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.join(" ")).toMatch(/title/i);
  });

  it("explains why a trap was demoted", () => {
    const intent = classifyQueryIntent("react");
    const result = scoreJob(CORPUS.find((j) => j.title === "IT Director")!, intent);
    expect(result.reasons.join(" ").toLowerCase()).toMatch(/excluded|different role/);
  });

  it("does not claim to have matched a term the posting lacks", () => {
    const intent = classifyQueryIntent("react");
    const result = scoreJob({ title: "Gardener", description: "Plants and soil." }, intent);
    expect(result.matched).toHaveLength(0);
    expect(result.score).toBeLessThan(RELEVANCE_THRESHOLD);
  });
});

describe("buildCorpusStats", () => {
  it("gives a rare term a higher IDF than a ubiquitous one", () => {
    const { idf } = buildCorpusStats([
      "react typescript",
      "react python",
      "react java",
      "react kubernetes airflow",
    ]);
    expect(idf.get("airflow")!).toBeGreaterThan(idf.get("react")!);
  });

  it("returns a usable average length for an empty corpus", () => {
    const { idf, avgDocLength } = buildCorpusStats([]);
    expect(idf.size).toBe(0);
    expect(avgDocLength).toBeGreaterThan(0);
  });
});
