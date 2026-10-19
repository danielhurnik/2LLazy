import { unstable_cache } from "next/cache";
import type { JobPosting, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { JobItem } from "@/types";
import { buildJobPostingWhere, findDistinctJobSources } from "./applications";
import type { JobPostingFilters } from "./applications";

export type FavouriteFilters = JobPostingFilters;

const FAVOURITES_TAG = "favourites";
export const favouriteTag = (userId: string) => `${FAVOURITES_TAG}:${userId}`;

const FAVOURITES_CACHE_SECONDS = 60;

const favouritesCacheOptions = (userId: string) => ({
  revalidate: FAVOURITES_CACHE_SECONDS,
  tags: [favouriteTag(userId)],
});

export async function toggleUserFavourite(userId: string, jobId: string): Promise<boolean> {
  const removed = await prisma.userFavourite.deleteMany({ where: { userId, jobId } });
  if (removed.count > 0) return false;
  await prisma.userFavourite.createMany({ data: [{ userId, jobId }], skipDuplicates: true });
  return true;
}

const favouritedByUser = (userId: string) =>
  ({ favouritedBy: { some: { userId } } }) satisfies Prisma.JobPostingWhereInput;

function toFavouriteJobItem(job: JobPosting): JobItem {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location ?? "",
    description: job.description,
    sourceUrl: job.sourceUrl,
    source: job.source,
    salary: job.salary ?? undefined,
    favourited: true,
  };
}

async function findFavourites(userId: string, filters?: FavouriteFilters): Promise<JobItem[]> {
  const jobs = await prisma.jobPosting.findMany({
    where: { ...favouritedByUser(userId), ...buildJobPostingWhere(filters) },
    orderBy: { scrapedAt: "desc" },
  });
  return jobs.map(toFavouriteJobItem);
}

export function getFavourites(userId: string, filters?: FavouriteFilters) {
  return unstable_cache(
    () => findFavourites(userId, filters),
    ["get-favourites", userId, JSON.stringify(filters ?? {})],
    favouritesCacheOptions(userId),
  )();
}

export function getFavouriteSources(userId: string) {
  return unstable_cache(
    () => findDistinctJobSources(favouritedByUser(userId)),
    ["get-favourite-sources", userId],
    favouritesCacheOptions(userId),
  )();
}
