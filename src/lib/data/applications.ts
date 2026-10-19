import { prisma } from "@/lib/prisma";
import { JobSource } from "@prisma/client";
import type { ApplicationStatus, Prisma } from "@prisma/client";
import type { Application } from "@/types";
import { ALL_STATUSES } from "@/types";

const ALL_OPTION = "ALL";
const JOB_SOURCES: ReadonlySet<string> = new Set(Object.values(JobSource));

const APPLICATION_INCLUDE = { job: true, interview: true } satisfies Prisma.ApplicationInclude;

type ApplicationWithRelations = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

export interface JobPostingFilters {
  source?: string;
  position?: string;
  hasSalary?: boolean;
}

export interface ApplicationFilters extends JobPostingFilters {
  status?: string;
}

const APPLICATIONS_TAG = "applications";
export const applicationTag = (userId: string) => `${APPLICATIONS_TAG}:${userId}`;

function isJobSource(value: string): value is JobSource {
  return JOB_SOURCES.has(value);
}

export function buildJobPostingWhere(
  filters?: JobPostingFilters,
): Prisma.JobPostingWhereInput | undefined {
  const { source, position, hasSalary } = filters ?? {};
  const where: Prisma.JobPostingWhereInput = {};
  if (source && isJobSource(source)) where.source = source;
  if (hasSalary) where.salary = { not: null };
  const searchTerm = position?.trim();
  if (searchTerm) {
    where.OR = [
      { title: { contains: searchTerm, mode: "insensitive" } },
      { company: { contains: searchTerm, mode: "insensitive" } },
    ];
  }
  return Object.keys(where).length > 0 ? where : undefined;
}

export async function findDistinctJobSources(where: Prisma.JobPostingWhereInput): Promise<string[]> {
  const rows = await prisma.jobPosting.findMany({
    where,
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
  });
  return rows.map((row) => row.source);
}

function matchingStatus(status?: string): Prisma.ApplicationWhereInput {
  return status && status !== ALL_OPTION ? { status: status as ApplicationStatus } : {};
}

function matchingJob(filters?: JobPostingFilters): Prisma.ApplicationWhereInput {
  const job = buildJobPostingWhere(filters);
  return job ? { job } : {};
}

function toApplicationInterview(
  interview: ApplicationWithRelations["interview"],
): Application["interview"] {
  if (!interview) return null;
  return {
    id: interview.id,
    scheduledAt: interview.scheduledAt.toISOString(),
    durationMinutes: interview.durationMinutes,
    notes: interview.notes,
  };
}

function toApplication(application: ApplicationWithRelations): Application {
  const { job } = application;
  return {
    id: application.id,
    status: application.status,
    appliedAt: application.appliedAt?.toISOString() ?? null,
    notes: application.notes,
    errorMessage: application.errorMessage,
    appliedVia: application.appliedVia,
    evidencePath: application.evidencePath,
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location ?? "",
      description: job.description,
      source: job.source,
      sourceUrl: job.sourceUrl,
      salary: job.salary,
    },
    interview: toApplicationInterview(application.interview),
  };
}

export async function getApplications(
  userId: string,
  filters?: ApplicationFilters,
): Promise<Application[]> {
  const { status, ...jobFilters } = filters ?? {};
  const applications = await prisma.application.findMany({
    where: { userId, ...matchingStatus(status), ...matchingJob(jobFilters) },
    include: APPLICATION_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return applications.map(toApplication);
}

export function getApplicationSources(userId: string): Promise<string[]> {
  return findDistinctJobSources({ applications: { some: { userId } } });
}

export async function getApplicationStatusCounts(
  userId: string,
  filters?: Omit<ApplicationFilters, "status">,
): Promise<Record<string, number>> {
  const groups = await prisma.application.groupBy({
    by: ["status"],
    where: { userId, ...matchingJob(filters) },
    _count: true,
  });
  const counts: Record<string, number> = Object.fromEntries(
    ALL_STATUSES.map((status) => [status, 0]),
  );
  for (const group of groups) {
    counts[group.status] = group._count;
  }
  return counts;
}
