import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const RECENT_JOB_LIMIT = 50;
const TITLE_COLUMN_WIDTH = 45;
const COMPANY_COLUMN_WIDTH = 20;
const ISO_MINUTE_PRECISION = 16;

const databaseUrl = process.env.DATABASE_URL;
const requiresTls = databaseUrl?.includes("neon.tech") ?? false;

async function printRecentJobs() {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: requiresTls ? { rejectUnauthorized: false } : false,
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const jobs = await prisma.jobPosting.findMany({
    select: { title: true, company: true, source: true, scrapedAt: true },
    orderBy: { scrapedAt: "desc" },
    take: RECENT_JOB_LIMIT,
  });

  console.log(`\nTotal jobs in DB: ${jobs.length}\n`);
  console.table(
    jobs.map((job) => ({
      title: job.title.slice(0, TITLE_COLUMN_WIDTH),
      company: job.company.slice(0, COMPANY_COLUMN_WIDTH),
      source: job.source,
      scrapedAt: job.scrapedAt.toISOString().slice(0, ISO_MINUTE_PRECISION),
    })),
  );

  await prisma.$disconnect();
}

printRecentJobs().catch((error) => {
  console.error(error);
  process.exit(1);
});
