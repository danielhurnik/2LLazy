import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, ApplicationStatus } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const isNeonDatabase = databaseUrl?.includes("neon.tech") ?? false;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isNeonDatabase ? { rejectUnauthorized: false } : false,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const ROLE_PROFILES: Array<{
  category: string;
  description: string;
  antiQuery: string;
}> = [
    {
      category: "Frontend",
      description:
        "Frontend web developer skilled in React.js, Vue.js, or Angular with deep expertise in JavaScript and TypeScript. " +
        "Builds responsive, accessible user interfaces using HTML5, CSS3, and modern component libraries (Material UI, Tailwind, Ant Design). " +
        "Strong knowledge of client-side state management (Redux, Zustand, Pinia), bundlers (Vite, Webpack), and cross-browser testing. " +
        "Works closely with designers to implement pixel-perfect UIs and collaborates with backend teams to integrate REST and GraphQL APIs. " +
        "Typical roles: Frontend Developer, UI Developer, React Developer, Vue Developer, Angular Developer.",
      antiQuery:
        "Backend engineer designing server-side REST APIs, managing PostgreSQL databases, deploying Kubernetes containers, " +
        "building iOS or Android native apps, performing QA automation testing, or working in data engineering and machine learning pipelines.",
    },
    {
      category: "Backend",
      description:
        "Backend software engineer specialising in server-side application development, API design, and database management. " +
        "Proficient in Node.js, Python, Java, Go, or Ruby, building scalable microservices and RESTful or GraphQL APIs. " +
        "Deep experience with relational databases (PostgreSQL, MySQL), caching (Redis), and message queues (Kafka, RabbitMQ). " +
        "Deploys services to AWS, GCP, or Azure and applies security best practices including authentication and authorisation. " +
        "Typical roles: Backend Developer, Node.js Engineer, Python Developer, API Engineer, Software Engineer.",
      antiQuery:
        "Frontend developer building React or Vue user interfaces, mobile iOS or Android engineer writing Swift or Kotlin, " +
        "DevOps infra engineer managing Kubernetes clusters, QA automation tester, or machine learning data scientist.",
    },
    {
      category: "Fullstack",
      description:
        "Fullstack developer comfortable across the entire web stack — from React or Vue frontends to Node.js or Python backends. " +
        "Implements product features end-to-end: designing database schemas, building REST or GraphQL APIs, and creating polished UI components. " +
        "Experienced with TypeScript, PostgreSQL, CI/CD pipelines, and cloud deployment (AWS, Netlify, Vercel, GCP). " +
        "Can work independently on a feature from design mockup to production deployment. " +
        "Typical roles: Fullstack Developer, Full-Stack Engineer, Software Engineer (web), React + Node Developer.",
      antiQuery:
        "Pure DevOps or cloud infrastructure engineer, QA-only automation engineer, native iOS or Android mobile developer, " +
        "data engineer building ETL pipelines, or machine learning researcher.",
    },
    {
      category: "Mobile",
      description:
        "Mobile application developer building cross-platform or native apps for iOS and Android. " +
        "Expert in React Native or Flutter for cross-platform development, and/or Swift/SwiftUI for iOS or Kotlin/Jetpack Compose for Android. " +
        "Publishes apps to the App Store and Google Play, integrates device APIs (push notifications, camera, GPS), and optimises for mobile performance. " +
        "Collaborates with backend teams on REST API contracts and applies mobile security best practices. " +
        "Typical roles: React Native Developer, Flutter Developer, iOS Developer, Android Developer, Mobile Engineer.",
      antiQuery:
        "Web frontend developer building React or Vue browser applications, backend API engineer, DevOps cloud infrastructure engineer, " +
        "QA engineer, or data scientist.",
    },
    {
      category: "DevOps",
      description:
        "DevOps or Platform Engineer managing cloud infrastructure, CI/CD pipelines, and developer tooling. " +
        "Expert in Kubernetes, Docker, Terraform/Pulumi (IaC), and cloud platforms (AWS, GCP, Azure). " +
        "Designs and maintains GitLab CI, GitHub Actions, or Jenkins pipelines for automated testing and deployment. " +
        "Sets up observability stacks (Prometheus, Grafana, ELK), manages secrets, and enforces security policies. " +
        "Typical roles: DevOps Engineer, Cloud Engineer, Platform Engineer, SRE, Infrastructure Engineer.",
      antiQuery:
        "Frontend web developer, backend feature developer, mobile iOS or Android programmer, QA tester, " +
        "data engineer building ETL pipelines.",
    },
    {
      category: "Data",
      description:
        "Data engineer or data scientist building data pipelines, warehouses, and machine learning workflows. " +
        "Skilled in Python, SQL, Apache Spark, Airflow, and modern data platforms (BigQuery, Snowflake, Databricks). " +
        "Designs ETL/ELT pipelines, maintains data quality, and builds dashboards in Tableau or Metabase. " +
        "For ML roles: trains and deploys models using scikit-learn, TensorFlow, or PyTorch, applying MLOps practices. " +
        "Typical roles: Data Engineer, Data Analyst, Data Scientist, ML Engineer, Analytics Engineer.",
      antiQuery:
        "Frontend web developer, backend API engineer, DevOps cloud engineer, mobile developer, QA automation engineer.",
    },
    {
      category: "QA",
      description:
        "QA engineer or SDET responsible for test strategy, automation frameworks, and release quality. " +
        "Builds and maintains automated test suites using Selenium, Playwright, Cypress, or Jest. " +
        "Designs unit, integration, and end-to-end test plans; integrates tests into CI/CD pipelines. " +
        "Collaborates with developers to reproduce bugs, triage issues in Jira, and enforce quality gates. " +
        "Typical roles: QA Automation Engineer, SDET, Test Engineer, QA Analyst.",
      antiQuery:
        "Frontend UI developer, backend service engineer, DevOps cloud engineer, mobile app developer, " +
        "data engineer.",
    },
    {
      category: "Design",
      description:
        "UX/UI designer creating user-centred digital product experiences. " +
        "Produces wireframes, prototypes, and high-fidelity designs in Figma or Sketch, runs usability tests and conducts user research. " +
        "Collaborates closely with frontend engineers to ensure design implementation fidelity. " +
        "Applies design systems thinking and ensures WCAG accessibility compliance. " +
        "Typical roles: UX Designer, UI Designer, Product Designer, UX Researcher.",
      antiQuery:
        "Software engineer writing code, backend API developer, DevOps cloud engineer, data scientist, QA testing engineer.",
    },
  ];

const FAVOURITE_JOB_TITLE_FRAGMENTS = [
  "Senior Frontend Engineer, React.js",
  "Senior Backend/Fullstack Node.JS Developer",
  "Frontend React Developer",
  "React developer",
  "Full Stack Developer",
];

const INTERVIEW_FAVOURITE_INDEX = 0;

type DemoApplication = {
  favouriteIndex: number;
  status: ApplicationStatus;
  appliedAt: Date | null;
};

const DEMO_APPLICATIONS: DemoApplication[] = [
  { favouriteIndex: INTERVIEW_FAVOURITE_INDEX, status: ApplicationStatus.INTERVIEW, appliedAt: new Date("2026-03-28") },
  { favouriteIndex: 1, status: ApplicationStatus.APPLIED, appliedAt: new Date("2026-04-01") },
  { favouriteIndex: 2, status: ApplicationStatus.PENDING, appliedAt: null },
  { favouriteIndex: 3, status: ApplicationStatus.REJECTED, appliedAt: new Date("2026-03-20") },
];

const DEMO_INTERVIEW = {
  scheduledAt: new Date("2026-04-10T10:00:00Z"),
  timezone: "Europe/Prague",
  durationMinutes: 60,
  notes: "Technical interview — React, TypeScript, system design. Prepare: virtual DOM, memoization, GraphQL patterns.",
};

type FavouritedJob = {
  id: string;
  title: string;
};

async function resolveSeedUserId(): Promise<string | undefined> {
  const configuredUserId = process.env.SEED_USER_ID;
  if (configuredUserId) return configuredUserId;
  const firstUser = await prisma.user.findFirst({ select: { id: true } });
  return firstUser?.id;
}

async function favouriteDemoJobs(userId: string): Promise<FavouritedJob[]> {
  const favouritedJobs: FavouritedJob[] = [];
  for (const titleFragment of FAVOURITE_JOB_TITLE_FRAGMENTS) {
    const job = await prisma.jobPosting.findFirst({ where: { title: { contains: titleFragment } } });
    if (!job) continue;
    await prisma.userFavourite.upsert({
      where: { userId_jobId: { userId, jobId: job.id } },
      create: { userId, jobId: job.id },
      update: {},
    });
    favouritedJobs.push({ id: job.id, title: job.title });
    console.log(`⭐ Favourited: ${job.title} @ ${job.company}`);
  }
  return favouritedJobs;
}

async function createDemoApplications(userId: string, favouritedJobs: FavouritedJob[]): Promise<void> {
  for (const { favouriteIndex, status, appliedAt } of DEMO_APPLICATIONS) {
    const job = favouritedJobs[favouriteIndex];
    if (!job) continue;
    const existingApplication = await prisma.application.findFirst({ where: { jobId: job.id, userId } });
    if (existingApplication) {
      console.log(`⏭️  Application already exists: ${job.title}`);
      continue;
    }
    await prisma.application.create({ data: { userId, jobId: job.id, status, appliedAt } });
    console.log(`✅ Application: ${job.title} → ${status}`);
  }
}

async function scheduleDemoInterview(userId: string, jobId: string): Promise<void> {
  const interviewApplication = await prisma.application.findFirst({
    where: { jobId, status: ApplicationStatus.INTERVIEW, userId },
  });
  if (!interviewApplication) return;

  const existingInterview = await prisma.interview.findUnique({
    where: { applicationId: interviewApplication.id },
  });
  if (existingInterview) {
    console.log("⏭️  Interview already exists");
    return;
  }

  await prisma.interview.create({
    data: { applicationId: interviewApplication.id, ...DEMO_INTERVIEW },
  });
  console.log("✅ Interview scheduled for Apr 10");
}

async function seedDemoData(): Promise<void> {
  console.log("🌱 Seeding demo data...\n");

  const userId = await resolveSeedUserId();
  if (!userId) {
    console.log("⚠️  No user found. Log in via Google OAuth first, then re-run the seed.");
    console.log("   Or set SEED_USER_ID=<your-user-id> in .env");
    return;
  }
  console.log(`👤 Seeding for userId: ${userId}\n`);

  const favouritedJobs = await favouriteDemoJobs(userId);
  if (favouritedJobs.length === 0) {
    console.log("⚠️  No matching jobs found to favourite. Run a scrape first.");
    return;
  }

  await createDemoApplications(userId, favouritedJobs);
  await scheduleDemoInterview(userId, favouritedJobs[INTERVIEW_FAVOURITE_INDEX].id);

  console.log("\n🎉 Done! Dashboard, Favourites and Interviews are ready to demo.");
}

async function seedRoleProfiles() {
  console.log("\n📚 Seeding role profiles (keyword descriptions only — no embeddings)…");

  for (const profile of ROLE_PROFILES) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "RoleProfile" (id, category, description, "antiQuery", "updatedAt")
        VALUES (gen_random_uuid()::text, ${profile.category}, ${profile.description}, ${profile.antiQuery}, NOW())
        ON CONFLICT (category) DO UPDATE SET
          description = EXCLUDED.description,
          "antiQuery" = EXCLUDED."antiQuery",
          "updatedAt" = NOW()
      `;
      console.log(`  ✅ ${profile.category}`);
    } catch (err) {
      console.error(`  ❌ ${profile.category}:`, err);
    }
  }
}

async function seed(): Promise<void> {
  await seedDemoData();
  await seedRoleProfiles();
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
