import { getFavourites, getFavouriteSources } from "@/lib/data/favourites";
import type { FavouriteFilters } from "@/lib/data/favourites";
import { FavouritesClient } from "./_components/FavouritesClient";
import type { JobFilters } from "@/components/jobs/JobFilterBar";
import { requireUserId } from "@/lib/auth/sessionManager";

export const revalidate = 60;

const ALL_OPTION = "ALL";

export default async function FavouritesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const userId = await requireUserId();
  const query = await searchParams;
  const hasSalary = query.hasSalary === "true";
  const dataFilters: FavouriteFilters = {
    source: query.source,
    position: query.position,
    hasSalary,
  };
  const [jobs, sources] = await Promise.all([
    getFavourites(userId, dataFilters),
    getFavouriteSources(userId),
  ]);
  const currentFilters: JobFilters = {
    source: query.source ?? ALL_OPTION,
    position: query.position ?? "",
    hasSalary,
    workType: query.workType ?? ALL_OPTION,
    city: query.city ?? "",
    salaryMin: query.salaryMin ?? "",
    salaryMax: query.salaryMax ?? "",
  };
  return <FavouritesClient jobs={jobs} filters={currentFilters} sources={sources} />;
}
