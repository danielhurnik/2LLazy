import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { applicationTag } from "./applications";

const STATS_CACHE_SECONDS = 60;

interface WeeklyCountRow {
  week: string;
  count: bigint;
}

interface SourceCountRow {
  source: string;
  count: bigint;
}

function countApplicationsByStatus(userId: string) {
  return prisma.application.groupBy({ by: ["status"], where: { userId }, _count: { _all: true } });
}

function countApplicationsPerWeekOverLastEightWeeks(userId: string) {
  return prisma.$queryRaw<WeeklyCountRow[]>`
    SELECT TO_CHAR(DATE_TRUNC('week', "createdAt"), 'YYYY-MM-DD') as week, COUNT(*) as count
    FROM "Application"
    WHERE "createdAt" > NOW() - INTERVAL '8 weeks'
      AND "userId" = ${userId}
    GROUP BY week ORDER BY week
  `;
}

function countApplicationsBySource(userId: string) {
  return prisma.$queryRaw<SourceCountRow[]>`
    SELECT j.source, COUNT(*) as count
    FROM "Application" a
    JOIN "JobPosting" j ON a."jobId" = j.id
    WHERE a."userId" = ${userId}
    GROUP BY j.source
  `;
}

function percentage(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

async function findStatsData(userId: string) {
  const [statusGroups, weeklyRows, sourceRows] = await Promise.all([
    countApplicationsByStatus(userId),
    countApplicationsPerWeekOverLastEightWeeks(userId),
    countApplicationsBySource(userId),
  ]);

  const byStatus = statusGroups.map((group) => ({ status: group.status, count: group._count._all }));
  const totalApplications = byStatus.reduce((sum, { count }) => sum + count, 0);
  const interviewCount = byStatus.find(({ status }) => status === "INTERVIEW")?.count ?? 0;

  return {
    byStatus,
    bySource: sourceRows.map((row) => ({ source: row.source, count: Number(row.count) })),
    weekly: weeklyRows.map((row) => ({ week: row.week, count: Number(row.count) })),
    totalApplications,
    interviewRate: percentage(interviewCount, totalApplications),
  };
}

export function getStatsData(userId: string) {
  return unstable_cache(
    () => findStatsData(userId),
    ["get-stats", userId],
    { revalidate: STATS_CACHE_SECONDS, tags: [applicationTag(userId)] },
  )();
}
