import {
  getApplications,
  getApplicationSources,
  getApplicationStatusCounts,
} from "@/lib/data/applications";
import type { ApplicationFilters } from "@/lib/data/applications";
import { DashboardClient } from "./_components/DashboardClient";
import type { DashboardFilters } from "@/components/dashboard/DashboardFilterBar";
import { requireUserId } from "@/lib/auth/sessionManager";

export const dynamic = "force-dynamic";

const ALL_OPTION = "ALL";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const userId = await requireUserId();
  const query = await searchParams;
  const hasSalary = query.hasSalary === "true";
  const filtersExceptStatus: Omit<ApplicationFilters, "status"> = {
    source: query.source,
    position: query.position,
    hasSalary,
  };
  const [applications, sources, statusCounts] = await Promise.all([
    getApplications(userId, { status: query.status, ...filtersExceptStatus }),
    getApplicationSources(userId),
    getApplicationStatusCounts(userId, filtersExceptStatus),
  ]);
  const currentFilters: DashboardFilters = {
    status: query.status ?? ALL_OPTION,
    source: query.source ?? ALL_OPTION,
    position: query.position ?? "",
    hasSalary,
  };
  return (
    <DashboardClient
      applications={applications}
      filters={currentFilters}
      sources={sources}
      statusCounts={statusCounts}
    />
  );
}
