import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { JobItem } from "@/types";

/**
 * `source` is a free-form board id now that boards live in the runtime
 * registry, so validate the shape rather than membership of a fixed enum —
 * a filter for a board that has since been removed simply matches nothing.
 */
function sourceFilter(source: string | undefined): string | undefined {
  if (!source || source === "ALL") return undefined;
  return /^[A-Z0-9_]{2,32}$/.test(source) ? source : undefined;
}

export interface FavouriteFilters {
  source?: string;
  position?: string;
  hasSalary?: boolean;
}

export const FAVOURITES_TAG = "favourites";
export const favouriteTag = (userId: string) => `${FAVOURITES_TAG}:${userId}`;

async function _getFavourites(userId: string, filters?: FavouriteFilters): Promise<JobItem[]> {
  const { source, position, hasSalary } = filters ?? {};
  const jobs = await prisma.jobPosting.findMany({
    where: {
      favouritedBy: { some: { userId } },
      ...(sourceFilter(source) ? { source: sourceFilter(source) } : {}),
      ...(hasSalary ? { salary: { not: null } } : {}),
      ...(position?.trim()
        ? {
          OR: [
            { title: { contains: position.trim(), mode: "insensitive" } },
            { company: { contains: position.trim(), mode: "insensitive" } },
          ],
        }
        : {}),
    },
    orderBy: { scrapedAt: "desc" },
    include: {
      coverLetters: {
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, content: true },
      },
    },
  });

  return jobs.map((job) => ({
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location ?? "",
    description: job.description,
    sourceUrl: job.sourceUrl,
    source: job.source as string,
    salary: job.salary ?? undefined,
    favourited: true,
    coverLetter: job.coverLetters[0] ?? null,
  }));
}

async function _getFavouriteSources(userId: string): Promise<string[]> {
  const rows = await prisma.jobPosting.findMany({
    where: { favouritedBy: { some: { userId } } },
    distinct: ["source"],
    select: { source: true },
    orderBy: { source: "asc" },
  });
  return rows.map((r) => r.source as string);
}

export function getFavourites(userId: string, filters?: FavouriteFilters) {
  return unstable_cache(
    () => _getFavourites(userId, filters),
    ["get-favourites", userId, JSON.stringify(filters ?? {})],
    { revalidate: 60, tags: [favouriteTag(userId)] },
  )();
}

export function getFavouriteSources(userId: string) {
  return unstable_cache(
    () => _getFavouriteSources(userId),
    ["get-favourite-sources", userId],
    { revalidate: 60, tags: [favouriteTag(userId)] },
  )();
}

