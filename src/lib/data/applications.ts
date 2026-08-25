import { prisma } from "@/lib/prisma";
import { ApplicationStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { Application, AppStatus } from "@/types";
import { ALL_STATUSES } from "@/types";

/**
 * `source` is a free-form board id now that boards live in the runtime
 * registry, so validate the shape rather than membership of a fixed enum.
 */
function sourceFilter(source: string | undefined): string | undefined {
  if (!source || source === "ALL") return undefined;
  return /^[A-Z0-9_]{2,32}$/.test(source) ? source : undefined;
}

export interface ApplicationFilters {
  status?: string;
  source?: string;
  position?: string;
  hasSalary?: boolean;
}

function buildJobWhere(filters?: Omit<ApplicationFilters, "status">): Prisma.JobPostingWhereInput | undefined {
  const { source, position, hasSalary } = filters ?? {};
  const clause: Prisma.JobPostingWhereInput = {};
  const validSource = sourceFilter(source);
  if (validSource) clause.source = validSource;
  if (hasSalary) clause.salary = { not: null };
  if (position?.trim()) {
    clause.OR = [
      { title: { contains: position.trim(), mode: "insensitive" } },
      { company: { contains: position.trim(), mode: "insensitive" } },
    ];
  }
  return Object.keys(clause).length > 0 ? clause : undefined;
}

export const APPLICATIONS_TAG = "applications";
export const applicationTag = (userId: string) => `${APPLICATIONS_TAG}:${userId}`;

async function _getApplications(userId: string, filters?: ApplicationFilters): Promise<Application[]> {
  const { status, ...rest } = filters ?? {};
  const job = buildJobWhere(rest);
  const apps = await prisma.application.findMany({
    where: {
      userId,
      ...(status && status !== "ALL" ? { status: status as ApplicationStatus } : {}),
      ...(job ? { job } : {}),
    },
    include: { job: true, coverLetter: true, interview: true },
    orderBy: { createdAt: "desc" },
  });

  return apps.map((app) => ({
    id: app.id,
    status: app.status as AppStatus,
    appliedAt: app.appliedAt?.toISOString() ?? null,
    errorMessage: app.errorMessage,
    notes: app.notes ?? null,
    job: {
      id: app.job.id,
      title: app.job.title,
      company: app.job.company,
      location: app.job.location ?? "",
      description: app.job.description,
      source: app.job.source,
      sourceUrl: app.job.sourceUrl,
      salary: app.job.salary ?? null,
    },
    coverLetter: app.coverLetter
      ? { id: app.coverLetter.id, content: app.coverLetter.content }
      : null,
    interview: app.interview
      ? {
        id: app.interview.id,
        scheduledAt: app.interview.scheduledAt.toISOString(),
        durationMinutes: app.interview.durationMinutes,
        notes: app.interview.notes,
      }
      : null,
  }));
}

async function _getApplicationSources(userId: string): Promise<string[]> {
  const rows = await prisma.jobPosting.findMany({
    where: { applications: { some: { userId } } },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
  });
  return rows.map((r) => r.source as string);
}

async function _getApplicationStatusCounts(
  userId: string,
  filters?: Omit<ApplicationFilters, "status">,
): Promise<Record<string, number>> {
  const job = buildJobWhere(filters);
  const groups = await prisma.application.groupBy({
    by: ["status"],
    where: { userId, ...(job ? { job } : {}) },
    _count: true,
  });
  const counts: Record<string, number> = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0]),
  );
  for (const g of groups) {
    counts[g.status] = g._count;
  }
  return counts;
}

export function getApplications(userId: string, filters?: ApplicationFilters) {
  return _getApplications(userId, filters);
}

export function getApplicationSources(userId: string) {
  return _getApplicationSources(userId);
}

export function getApplicationStatusCounts(userId: string, filters?: Omit<ApplicationFilters, "status">) {
  return _getApplicationStatusCounts(userId, filters);
}

