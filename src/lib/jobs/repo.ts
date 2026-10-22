import type { ApplicationStatus, JobSource as JobSourceEnum, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { GroupPosting } from "./crossListing";
import { contentHash, jobKey } from "./dedupe";
import type { NormalizedJob } from "./normalize";
import { DEFAULT_COUNTRY, type CountryCode } from "./sources/types";
import { MS_PER_DAY } from "@/lib/time";

export interface StoredJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  sourceUrl: string;
  source: JobSourceEnum;
  salary: string | null;
  workType: string | null;
  postedAt: Date | null;
  scrapedAt: Date;
  firstSeenAt: Date;
  country: string;
  city: string | null;
  groupKey: string | null;
}

export interface EarlierGroupApplication {
  applicationId: string;
  status: ApplicationStatus;
  jobId: string;
  source: JobSourceEnum;
  sourceUrl: string;
  createdAt: Date;
}

interface RecentSearch {
  titleTerms: string[];
  query: string;
  days: number;
  limit: number;
  country?: CountryCode;
}

const MIN_TITLE_TERM_LENGTH = 2;
const MIN_DESCRIPTION_QUERY_LENGTH = 3;
const CASE_INSENSITIVE = "insensitive" as const;
export const STATUSES_THAT_ALLOW_APPLYING_AGAIN: ApplicationStatus[] = ["REJECTED", "FAILED"];
const RECENT_APPLICATION_WINDOW_DAYS = 90;

type Db = Prisma.TransactionClient | typeof prisma;

const STORED_JOB_COLUMNS = {
  id: true,
  title: true,
  company: true,
  location: true,
  description: true,
  sourceUrl: true,
  source: true,
  salary: true,
  workType: true,
  postedAt: true,
  scrapedAt: true,
  firstSeenAt: true,
  country: true,
  city: true,
  groupKey: true,
} as const;

export async function findByUrls(urls: string[]): Promise<Map<string, StoredJob>> {
  if (urls.length === 0) return new Map();
  const rows = await prisma.jobPosting.findMany({ where: { sourceUrl: { in: urls } }, select: STORED_JOB_COLUMNS });
  return new Map(rows.map((row) => [row.sourceUrl, row]));
}

function persistedFields(job: NormalizedJob) {
  return {
    title: job.title,
    company: job.company,
    location: job.location || null,
    description: job.description,
    salary: job.salary ?? null,
    workType: job.workType ?? null,
    postedAt: job.postedAt ?? null,
    country: job.country,
    city: job.city,
    remote: job.remote,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    skills: job.skills,
    contentHash: contentHash(job.description),
    groupKey: jobKey({ company: job.company, title: job.title, city: job.city }),
    ...(job.applyPath ? { applyPath: job.applyPath } : {}),
  };
}

export async function upsertJob(job: NormalizedJob): Promise<StoredJob> {
  const fields = persistedFields(job);
  return prisma.jobPosting.upsert({
    where: { sourceUrl: job.sourceUrl },
    create: { ...fields, sourceUrl: job.sourceUrl, source: job.source },
    update: { ...fields, scrapedAt: new Date(), expiredAt: null },
    select: STORED_JOB_COLUMNS,
  });
}

function distinctTitleTerms(titleTerms: string[]): string[] {
  const trimmed = titleTerms.map((term) => term.trim()).filter((term) => term.length >= MIN_TITLE_TERM_LENGTH);
  return Array.from(new Set(trimmed));
}

function keywordMatchers(titleTerms: string[], query: string) {
  const trimmedQuery = query.trim();
  const titleMatchers = distinctTitleTerms(titleTerms).map((term) => ({
    title: { contains: term, mode: CASE_INSENSITIVE },
  }));
  const descriptionMatchers =
    trimmedQuery.length >= MIN_DESCRIPTION_QUERY_LENGTH
      ? [{ description: { contains: trimmedQuery, mode: CASE_INSENSITIVE } }]
      : [];
  return [...titleMatchers, ...descriptionMatchers];
}

export async function searchRecent({
  titleTerms,
  query,
  days,
  limit,
  country = DEFAULT_COUNTRY,
}: RecentSearch): Promise<StoredJob[]> {
  const matchers = keywordMatchers(titleTerms, query);
  if (matchers.length === 0) return [];
  return prisma.jobPosting.findMany({
    where: { country, expiredAt: null, scrapedAt: { gte: new Date(Date.now() - days * MS_PER_DAY) }, OR: matchers },
    orderBy: { scrapedAt: "desc" },
    take: limit,
    select: STORED_JOB_COLUMNS,
  });
}

export async function knownWebHosts(): Promise<Set<string>> {
  const rows = await prisma.webDomain.findMany({ select: { host: true } });
  return new Set(rows.map((row) => row.host));
}

export async function recordWebHost(host: string): Promise<void> {
  if (!host) return;
  await prisma.webDomain.upsert({
    where: { host },
    create: { host, jobPostings: 1 },
    update: { jobPostings: { increment: 1 }, lastSeenAt: new Date() },
  });
}

export async function favouriteIdsFor(userId: string): Promise<Set<string>> {
  const rows = await prisma.userFavourite.findMany({ where: { userId }, select: { jobId: true } });
  return new Set(rows.map((row) => row.jobId));
}

export async function crossListingsByGroup(rows: Pick<StoredJob, "groupKey">[]): Promise<Map<string, GroupPosting[]>> {
  const keys = Array.from(new Set(rows.flatMap((row) => (row.groupKey ? [row.groupKey] : []))));
  const byGroup = new Map<string, GroupPosting[]>();
  if (keys.length === 0) return byGroup;
  const postings = await prisma.jobPosting.findMany({
    where: { groupKey: { in: keys }, expiredAt: null },
    select: { id: true, source: true, sourceUrl: true, groupKey: true },
    orderBy: { firstSeenAt: "asc" },
  });
  for (const posting of postings) {
    const key = posting.groupKey ?? "";
    byGroup.set(key, [...(byGroup.get(key) ?? []), posting]);
  }
  return byGroup;
}

export async function crossListingsOf(row: Pick<StoredJob, "id" | "groupKey">): Promise<GroupPosting[]> {
  if (!row.groupKey) return [];
  const group = (await crossListingsByGroup([row])).get(row.groupKey) ?? [];
  return group.filter((other) => other.id !== row.id);
}

export async function earlierApplicationInGroup(userId: string, jobId: string, db: Db = prisma): Promise<EarlierGroupApplication | null> {
  const posting = await db.jobPosting.findUnique({ where: { id: jobId }, select: { groupKey: true } });
  if (!posting?.groupKey) return null;
  const since = new Date(Date.now() - RECENT_APPLICATION_WINDOW_DAYS * MS_PER_DAY);
  const application = await db.application.findFirst({
    where: {
      userId,
      jobId: { not: jobId },
      status: { notIn: STATUSES_THAT_ALLOW_APPLYING_AGAIN },
      createdAt: { gte: since },
      job: { groupKey: posting.groupKey },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true, jobId: true, createdAt: true, job: { select: { source: true, sourceUrl: true } } },
  });
  if (!application) return null;
  return {
    applicationId: application.id,
    status: application.status,
    jobId: application.jobId,
    source: application.job.source,
    sourceUrl: application.job.sourceUrl,
    createdAt: application.createdAt,
  };
}
