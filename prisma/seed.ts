/**
 * Demo seed — gives a fresh clone something to look at.
 *
 * Creates a demo user + profile, a handful of realistic job postings spread
 * across several countries, then favourites/applies/schedules an interview so
 * the dashboard, favourites and interview views all render with data.
 *
 * Safe to re-run: every write is an upsert or is guarded by an existence check.
 * There is deliberately no model API involved — postings here mimic what the
 * deterministic scrapers produce.
 *
 * Run: npx tsx prisma/seed.ts
 * Env: SEED_USER_ID — seed against an existing user instead of the demo one.
 */
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ApplicationStatus } from "@prisma/client";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // TLS is opt-in through the connection string (`?sslmode=require`),
  // exactly like any other PostgreSQL client.
  ssl: /sslmode=(require|verify-ca|verify-full)/.test(process.env.DATABASE_URL ?? "")
    ? { rejectUnauthorized: false }
    : false,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DEMO_EMAIL = "demo@2llazy.local";

/** Postings are ranked by freshness, so seed relative dates — never fixed ones. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── Sample postings ──────────────────────────────────────────────────────────

/**
 * `source` is a free-text uppercase board id resolved by the scraper registry at
 * runtime, not a database enum — these are the ids of boards the registry ships
 * with. `country` is ISO 3166-1 alpha-2 (uppercase); null means worldwide/remote,
 * which is how remote-only boards report their listings.
 */
const SAMPLE_JOBS: Array<{
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  source: string;
  salary: string | null;
  workType: string | null;
  sourceUrl: string;
  postedDaysAgo: number;
  description: string;
}> = [
  {
    title: "Senior Frontend Engineer (React/TypeScript)",
    company: "Rohlik Group",
    location: "Praha, Czechia",
    country: "CZ",
    source: "STARTUPJOBS",
    salary: "90 000 – 130 000 Kč/month",
    workType: "Hybrid",
    sourceUrl: "https://example.invalid/demo/cz/senior-frontend-engineer",
    postedDaysAgo: 2,
    description:
      "We are looking for a Senior Frontend Engineer to own our customer-facing web app. " +
      "You will work in React 19 with TypeScript, Next.js App Router and a shared design system, " +
      "ship features end to end, and mentor two mid-level engineers. " +
      "We care about Core Web Vitals, accessibility (WCAG 2.2 AA) and a fast CI. " +
      "Requirements: 5+ years of frontend work, strong TypeScript, experience with server components, " +
      "testing with Vitest and Playwright. Czech is not required — the team works in English.",
  },
  {
    title: "Backend Developer — Node.js & PostgreSQL",
    company: "Kiwi.com",
    location: "Brno, Czechia",
    country: "CZ",
    source: "JOBSCZ",
    salary: "80 000 – 110 000 Kč/month",
    workType: "Remote",
    sourceUrl: "https://example.invalid/demo/cz/backend-developer-node",
    postedDaysAgo: 5,
    description:
      "Join the booking platform team building the services behind millions of itineraries. " +
      "Stack: Node.js, TypeScript, PostgreSQL, Redis, Kafka, Kubernetes on GCP. " +
      "You will design REST and GraphQL APIs, own schema migrations, and keep p99 latency honest. " +
      "Requirements: 3+ years backend experience, solid SQL, comfort with observability tooling " +
      "(Prometheus, Grafana, OpenTelemetry). Fully remote within the EU.",
  },
  {
    title: "Full Stack Engineer (Vue + Go)",
    company: "Slido",
    location: "Bratislava, Slovakia",
    country: "SK",
    source: "STARTUPJOBS",
    salary: "3 200 – 4 500 EUR/month",
    workType: "Hybrid",
    sourceUrl: "https://example.invalid/demo/sk/full-stack-engineer",
    postedDaysAgo: 9,
    description:
      "Build interactive audience-engagement features used in live events worldwide. " +
      "Frontend in Vue 3 and TypeScript, backend services in Go, data in PostgreSQL. " +
      "You will work across the stack: schema design, API contracts, and the UI that consumes them. " +
      "Requirements: 4+ years across frontend and backend, an eye for real-time UX, " +
      "experience with WebSockets or SSE. Two days a week in the Bratislava office.",
  },
  {
    title: "Python Data Engineer",
    company: "Allegro",
    location: "Warszawa, Poland",
    country: "PL",
    source: "NOFLUFFJOBS",
    salary: "18 000 – 26 000 PLN/month",
    workType: "Remote",
    sourceUrl: "https://example.invalid/demo/pl/python-data-engineer",
    postedDaysAgo: 1,
    description:
      "Own the ETL pipelines feeding our recommendation and pricing systems. " +
      "Stack: Python, Apache Airflow, Spark, BigQuery, dbt, Terraform on GCP. " +
      "You will model datasets, enforce data quality contracts, and cut pipeline cost. " +
      "Requirements: 3+ years in data engineering, strong Python and SQL, " +
      "experience operating batch pipelines at terabyte scale. Polish not required.",
  },
  {
    title: "DevOps Engineer (Kubernetes, Terraform)",
    company: "Zalando",
    location: "Berlin, Germany",
    country: "DE",
    source: "ARBEITNOW",
    salary: "70 000 – 95 000 EUR/year",
    workType: "Hybrid",
    sourceUrl: "https://example.invalid/demo/de/devops-engineer",
    postedDaysAgo: 4,
    description:
      "Platform engineering for several hundred product teams. " +
      "You will maintain multi-tenant Kubernetes clusters, write Terraform modules, " +
      "and improve the golden path so teams ship without filing tickets. " +
      "Stack: AWS, Kubernetes, Terraform, ArgoCD, GitHub Actions, Prometheus. " +
      "Requirements: 4+ years in DevOps/SRE, strong Linux fundamentals, " +
      "a bias for automation over runbooks. German is a plus, not a requirement.",
  },
  {
    title: "Remote React Native Developer",
    company: "Doist",
    location: "Remote (worldwide)",
    country: null,
    source: "REMOTIVE",
    salary: "60 000 – 85 000 USD/year",
    workType: "Remote",
    sourceUrl: "https://example.invalid/demo/remote/react-native-developer",
    postedDaysAgo: 7,
    description:
      "Fully async, fully remote mobile team shipping to iOS and Android from one React Native codebase. " +
      "You will own features end to end, from spec to store release, with no daily standups. " +
      "Stack: React Native, TypeScript, Reanimated, Detox, Fastlane. " +
      "Requirements: 3+ years of React Native in production, published apps in both stores, " +
      "excellent written communication — we work across 12 time zones.",
  },
  {
    title: "QA Automation Engineer (Playwright)",
    company: "Monzo",
    location: "London, United Kingdom",
    country: "GB",
    source: "ADZUNA",
    salary: "55 000 – 75 000 GBP/year",
    workType: "Hybrid",
    sourceUrl: "https://example.invalid/demo/gb/qa-automation-engineer",
    postedDaysAgo: 12,
    description:
      "Own the end-to-end test suite for our web banking experience. " +
      "You will build and maintain Playwright suites, wire them into CI, " +
      "and work with engineers to make flaky tests a solved problem rather than a chore. " +
      "Requirements: 3+ years in test automation, TypeScript, experience with CI pipelines " +
      "and with debugging failures across browsers. Two days a week in the London office.",
  },
  {
    title: "Junior Frontend Developer",
    company: "Productboard",
    location: "Praha, Czechia",
    country: "CZ",
    source: "JOBSTACK",
    salary: "45 000 – 65 000 Kč/month",
    workType: "On-site",
    sourceUrl: "https://example.invalid/demo/cz/junior-frontend-developer",
    postedDaysAgo: 20,
    description:
      "A first engineering role with real mentoring attached. " +
      "You will pair with senior engineers on the product UI, start with well-scoped tickets, " +
      "and grow into owning features. Stack: React, TypeScript, GraphQL, Storybook. " +
      "Requirements: solid JavaScript fundamentals, some React (school, side projects or an internship), " +
      "curiosity, and willingness to ask questions early.",
  },
];

const DEMO_COVER_LETTER = `Dear Hiring Team,

I am writing to express my strong interest in this role. With 4+ years of experience building production React and TypeScript applications, I am excited by the opportunity to contribute to your engineering team.

In my recent projects I led a full migration from a legacy codebase to a modern Next.js + TypeScript stack, introduced a shared component library, and reduced bundle size by 40% through code-splitting. I am comfortable across the full stack — Node.js APIs, PostgreSQL, GraphQL, and cloud deployments.

I would love the opportunity to discuss how I can contribute to your team's goals. Thank you for your consideration.

Best regards,
Demo User`;

// ─── Seed steps ───────────────────────────────────────────────────────────────

/**
 * Prefer an explicitly named user, then any existing one, and only create the
 * demo account as a last resort — so running the seed on a real database
 * decorates the real account rather than adding a stray user.
 */
async function resolveUserId(): Promise<string> {
  const fromEnv = process.env.SEED_USER_ID?.trim();
  if (fromEnv) return fromEnv;

  const existing = await prisma.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;

  const demo = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "Demo User", emailVerified: new Date() },
  });
  console.log(`👤 Created demo user ${DEMO_EMAIL}`);
  return demo.id;
}

/** Seeds the profile that drives country-aware scraping and the settings page. */
async function seedProfile(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error(`No user with id ${userId} — check SEED_USER_ID.`);

  await prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      name: user.name ?? "Demo User",
      email: user.email,
      country: "CZ",
      preferredWorkType: "Remote",
      remoteOnly: false,
      coverLetterLanguage: "English",
    },
  });
  console.log("✅ User profile ready (country: CZ)");
}

/** Upserts the sample postings by sourceUrl, which is the scrapers' natural key. */
async function seedJobs(): Promise<string[]> {
  const ids: string[] = [];
  for (const job of SAMPLE_JOBS) {
    const { postedDaysAgo, sourceUrl, ...rest } = job;
    const postedAt = daysAgo(postedDaysAgo);
    const record = await prisma.jobPosting.upsert({
      where: { sourceUrl },
      update: { ...rest, postedAt, scrapedAt: new Date() },
      create: { ...rest, sourceUrl, postedAt, scrapedAt: new Date(), firstSeenAt: postedAt },
    });
    ids.push(record.id);
  }
  console.log(`✅ ${ids.length} sample postings across CZ, SK, PL, DE, GB and remote`);
  return ids;
}

async function seedFavourites(userId: string, jobIds: string[]): Promise<void> {
  for (const jobId of jobIds.slice(0, 5)) {
    await prisma.userFavourite.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
  }
  console.log("⭐ Favourited the first 5 postings");
}

/** Returns the cover letter id so the first application can reference it. */
async function seedCoverLetter(userId: string, jobId: string): Promise<string> {
  const existing = await prisma.coverLetter.findFirst({ where: { jobId, userId } });
  if (existing) return existing.id;

  const created = await prisma.coverLetter.create({
    data: { userId, jobId, content: DEMO_COVER_LETTER, generatedFromTemplate: true },
  });
  console.log("✅ Cover letter composed from the template");
  return created.id;
}

async function seedApplications(userId: string, jobIds: string[], coverLetterId: string): Promise<void> {
  const plan: Array<{ idx: number; status: ApplicationStatus; appliedDaysAgo: number | null }> = [
    { idx: 0, status: ApplicationStatus.INTERVIEW, appliedDaysAgo: 14 },
    { idx: 1, status: ApplicationStatus.APPLIED, appliedDaysAgo: 6 },
    { idx: 2, status: ApplicationStatus.PENDING, appliedDaysAgo: null },
    { idx: 3, status: ApplicationStatus.REJECTED, appliedDaysAgo: 25 },
    { idx: 4, status: ApplicationStatus.OFFER, appliedDaysAgo: 30 },
  ];

  for (const { idx, status, appliedDaysAgo } of plan) {
    const jobId = jobIds[idx];
    if (!jobId) continue;
    const existing = await prisma.application.findFirst({ where: { jobId, userId } });
    if (existing) continue;
    await prisma.application.create({
      data: {
        userId,
        jobId,
        status,
        appliedAt: appliedDaysAgo === null ? null : daysAgo(appliedDaysAgo),
        coverLetterId: idx === 0 ? coverLetterId : undefined,
      },
    });
    console.log(`✅ Application → ${status}`);
  }
}

async function seedInterview(userId: string, jobId: string): Promise<void> {
  const application = await prisma.application.findFirst({
    where: { jobId, userId, status: ApplicationStatus.INTERVIEW },
  });
  if (!application) return;

  const existing = await prisma.interview.findUnique({ where: { applicationId: application.id } });
  if (existing) return;

  await prisma.interview.create({
    data: {
      applicationId: application.id,
      scheduledAt: daysAgo(-3), // three days from now
      timezone: "Europe/Prague",
      durationMinutes: 60,
      notes:
        "Technical interview — React, TypeScript, system design. " +
        "Prepare: server components, memoization, GraphQL schema design.",
    },
  });
  console.log("✅ Interview scheduled 3 days out");
}

async function main() {
  console.log("🌱 Seeding demo data…\n");

  const userId = await resolveUserId();
  console.log(`👤 Seeding for userId: ${userId}\n`);

  await seedProfile(userId);
  const jobIds = await seedJobs();
  await seedFavourites(userId, jobIds);
  const coverLetterId = await seedCoverLetter(userId, jobIds[0]);
  await seedApplications(userId, jobIds, coverLetterId);
  await seedInterview(userId, jobIds[0]);

  console.log("\n🎉 Done. Dashboard, Favourites and Interviews are ready to demo.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
