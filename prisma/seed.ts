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

async function seed(): Promise<void> {
  await seedDemoData();
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
