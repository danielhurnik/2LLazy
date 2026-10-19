import type { JobSource as JobSourceEnum } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { batchProcess } from "@/lib/scrapers/utils";
import { HttpError } from "./http";
import { resolveIntent } from "./intent";
import { normalizeJob } from "./normalize";
import { sourcesFor } from "./registry";
import { upsertJob } from "./repo";
import { DEFAULT_COUNTRY, isSupportedCountry, type CountryCode, type FetchContext, type JobSource, type Listing, type SearchRequest } from "./sources/types";
import { MS_PER_DAY, MS_PER_MINUTE } from "@/lib/time";

const STALE_AFTER_MS = MS_PER_DAY;
const KEEP_POSTINGS_FOR_DAYS = 60;
const POSTINGS_PER_RUN = 25;
const REFRESH_CONCURRENCY = 3;
const DETAIL_TIMEOUT_MS = 45_000;
const DEFAULT_REFRESH_MINUTES = 180;
const FIRST_RUN_DELAY_MINUTES = 5;
const GONE_STATUSES = new Set([404, 410]);

interface RefreshReport {
  checked: number;
  updated: number;
  expired: number;
  removed: number;
  failed: number;
  purged: number;
}

type Outcome = "updated" | "expired" | "removed" | "failed" | "skipped";

interface StaleRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  sourceUrl: string;
  source: JobSourceEnum;
  salary: string | null;
  workType: string | null;
  postedAt: Date | null;
  country: string;
  city: string | null;
}

const scheduler = globalThis as typeof globalThis & { searchRefreshTimer?: NodeJS.Timeout; searchRefreshRunning?: boolean };

function countryOf(row: StaleRow): CountryCode {
  return isSupportedCountry(row.country) ? row.country : DEFAULT_COUNTRY;
}

function sourcesByEnum(country: CountryCode): Map<JobSourceEnum, JobSource> {
  return new Map(sourcesFor(country).sources.map((source) => [source.source, source]));
}

function requestFor(row: StaleRow, country: CountryCode): SearchRequest {
  return {
    query: row.title,
    skillLevel: "Any",
    deepSearch: false,
    city: row.city ?? "",
    country,
    intent: resolveIntent(row.title),
    salaryMin: null,
    salaryMax: null,
  };
}

function listingFor(row: StaleRow): Listing {
  return {
    url: row.sourceUrl,
    title: row.title,
    company: row.company,
    location: row.location ?? undefined,
    salary: row.salary ?? undefined,
    workType: row.workType ?? undefined,
    postedAt: row.postedAt ?? undefined,
  };
}

async function stalePostings(): Promise<StaleRow[]> {
  return prisma.jobPosting.findMany({
    where: {
      expiredAt: null,
      scrapedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      firstSeenAt: { gte: new Date(Date.now() - KEEP_POSTINGS_FOR_DAYS * MS_PER_DAY) },
    },
    orderBy: { scrapedAt: "asc" },
    take: POSTINGS_PER_RUN,
    select: { id: true, title: true, company: true, location: true, sourceUrl: true, source: true, salary: true, workType: true, postedAt: true, country: true, city: true },
  });
}

async function retireGonePosting(id: string): Promise<Outcome> {
  const refs = await prisma.jobPosting.findUnique({ where: { id }, select: { _count: { select: { applications: true, favouritedBy: true } } } });
  if (!refs) return "skipped";
  if (refs._count.applications === 0 && refs._count.favouritedBy === 0) {
    await prisma.jobPosting.delete({ where: { id } });
    return "removed";
  }
  await prisma.jobPosting.update({ where: { id }, data: { expiredAt: new Date() } });
  return "expired";
}

async function refreshOne(row: StaleRow, sources: Map<JobSourceEnum, JobSource>): Promise<Outcome> {
  const source = sources.get(row.source);
  if (!source?.detail) return "skipped";
  const country = countryOf(row);
  const ctx: FetchContext = {
    request: requestFor(row, country),
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
    log: (message) => console.log(`[refresh:${source.id}] ${message}`),
  };
  try {
    const raw = await source.detail(listingFor(row), ctx);
    if (!raw) return retireGonePosting(row.id);
    await upsertJob(normalizeJob({ ...raw, url: row.sourceUrl }, country));
    return "updated";
  } catch (err) {
    if (err instanceof HttpError && GONE_STATUSES.has(err.status)) return retireGonePosting(row.id);
    console.warn(`[refresh:${source.id}] ${row.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

async function purgeOldPostings(): Promise<number> {
  const cutoff = new Date(Date.now() - KEEP_POSTINGS_FOR_DAYS * MS_PER_DAY);
  const { count } = await prisma.jobPosting.deleteMany({
    where: { scrapedAt: { lt: cutoff }, applications: { none: {} }, favouritedBy: { none: {} } },
  });
  return count;
}

export async function refreshPostings(): Promise<RefreshReport> {
  const rows = await stalePostings();
  const sources = new Map<CountryCode, Map<JobSourceEnum, JobSource>>();
  const outcomes = await batchProcess(rows, REFRESH_CONCURRENCY, async (row) => {
    const country = countryOf(row);
    if (!sources.has(country)) sources.set(country, sourcesByEnum(country));
    return refreshOne(row, sources.get(country) ?? new Map());
  });
  const count = (outcome: Outcome) => outcomes.filter((candidate) => candidate === outcome).length;
  return {
    checked: rows.length,
    updated: count("updated"),
    expired: count("expired"),
    removed: count("removed"),
    failed: count("failed"),
    purged: await purgeOldPostings(),
  };
}

async function runGuarded(): Promise<void> {
  if (scheduler.searchRefreshRunning) return;
  scheduler.searchRefreshRunning = true;
  try {
    const report = await refreshPostings();
    console.log(`[refresh] ${JSON.stringify(report)}`);
  } catch (err) {
    console.error("[refresh] run failed:", err);
  } finally {
    scheduler.searchRefreshRunning = false;
  }
}

export function scheduleBackgroundRefresh(): void {
  const minutes = Number(process.env.SEARCH_REFRESH_MINUTES ?? DEFAULT_REFRESH_MINUTES);
  if (!Number.isFinite(minutes) || minutes <= 0 || scheduler.searchRefreshTimer) return;
  const interval = minutes * MS_PER_MINUTE;
  scheduler.searchRefreshTimer = setTimeout(() => {
    void runGuarded();
    scheduler.searchRefreshTimer = setInterval(() => void runGuarded(), interval);
    scheduler.searchRefreshTimer.unref();
  }, FIRST_RUN_DELAY_MINUTES * MS_PER_MINUTE);
  scheduler.searchRefreshTimer.unref();
  console.log(`[refresh] background refresh every ${minutes} min, first run in ${FIRST_RUN_DELAY_MINUTES} min`);
}
