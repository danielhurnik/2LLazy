import type { JobSource as JobSourceEnum } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { contentHash } from "./dedupe";
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
