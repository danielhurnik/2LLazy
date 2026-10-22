import {
  getApplications,
  getApplicationSources,
  getApplicationStatusCounts,
  isApplicationStatus,
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
  const status = isApplicationStatus(query.status) ? query.status : ALL_OPTION;
  const hasSalary = query.hasSalary === "true";
  const filtersExceptStatus: Omit<ApplicationFilters, "status"> = {
    source: query.source,
    position: query.position,
    hasSalary,
  };
  const hasJobFilters = Boolean(query.source || query.position || hasSalary);
  const [applications, sources, statusCounts, unfilteredCounts] = await Promise.all([
    getApplications(userId, { status, ...filtersExceptStatus }),
    getApplicationSources(userId),
    getApplicationStatusCounts(userId, filtersExceptStatus),
    hasJobFilters ? getApplicationStatusCounts(userId) : null,
  ]);
  const waitingCount = (unfilteredCounts ?? statusCounts).WAITING_FOR_USER ?? 0;
  const currentFilters: DashboardFilters = {
    status,
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
      waitingCount={waitingCount}
    />
  );
}
