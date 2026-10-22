"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Box, Alert } from "@mui/material";
import {
  DashboardFilterBar,
  sumStatusCounts,
  type DashboardFilters,
} from "@/components/dashboard/DashboardFilterBar";
import { ALL_OPTION } from "@/components/jobs/JobFilterBar";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusChangeDialog } from "@/components/dialogs/StatusChangeDialog";
import { NeedsYouBanner } from "@/components/dashboard/NeedsYouBanner";
import { BoardSignInStrip } from "@/components/dashboard/BoardSignIn";
import { updateApplicationStatus } from "@/lib/actions/applicationActions";
import { ApplicationList } from "./ApplicationList";
import type { Application, AppStatus } from "@/types";

interface Props {
  applications: Application[];
  filters: DashboardFilters;
  sources: string[];
  statusCounts: Record<string, number>;
  waitingCount: number;
}

interface StatusChangeDraft {
  applicationId: string;
  status: AppStatus;
}

const DASHBOARD_PATH = "/dashboard";
const AWAITING_REPLY_STATUSES: AppStatus[] = ["APPLIED", "INTERVIEW"];
const WAITING_ONLY_FILTERS: DashboardFilters = {
  status: "WAITING_FOR_USER",
  source: ALL_OPTION,
  position: "",
  hasSalary: false,
};

function toSearchParams({ status, source, position, hasSalary }: DashboardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (status !== ALL_OPTION) params.set("status", status);
  if (source !== ALL_OPTION) params.set("source", source);
  if (position) params.set("position", position);
  if (hasSalary) params.set("hasSalary", "true");
  return params;
}

function dashboardHref(filters: DashboardFilters): string {
  const params = toSearchParams(filters);
  return params.size > 0 ? `${DASHBOARD_PATH}?${params.toString()}` : DASHBOARD_PATH;
}

function describeTracking(trackedCount: number, awaitingReplyCount: number): string {
  if (trackedCount === 0) return "Nothing tracked yet";
  return `${trackedCount} tracked · ${awaitingReplyCount} waiting on a reply or interview`;
}

export function DashboardClient({ applications, filters, sources, statusCounts, waitingCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [statusChange, setStatusChange] = useState<StatusChangeDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trackedCount = sumStatusCounts(statusCounts);
  const awaitingReplyCount = AWAITING_REPLY_STATUSES.reduce(
    (total, status) => total + (statusCounts[status] ?? 0),
    0,
  );
  const hasActiveFilters = toSearchParams(filters).size > 0;

  const applyFilters = (nextFilters: DashboardFilters) => router.replace(dashboardHref(nextFilters));
  const clearFilters = () => router.replace(DASHBOARD_PATH);
  const isShowingOnlyWaiting =
    filters.status === WAITING_ONLY_FILTERS.status &&
    filters.source === ALL_OPTION &&
    !filters.position &&
    !filters.hasSalary;

  const saveStatusChange = ({ applicationId, status }: StatusChangeDraft) => {
    startTransition(async () => {
      try {
        await updateApplicationStatus(applicationId, status);
        router.refresh();
        setStatusChange(null);
      } catch (err) {
        setErrorMessage(`Failed to update status: ${String(err)}`);
      }
    });
  };

  return (
    <Box>
      <PageHeader title="Applications" meta={describeTracking(trackedCount, awaitingReplyCount)} />

      {errorMessage && (
        <Alert severity="error" onClose={() => setErrorMessage(null)} sx={{ mb: 2 }}>
          {errorMessage}
        </Alert>
      )}

      <NeedsYouBanner
        waitingCount={waitingCount}
        onShowWaiting={isShowingOnlyWaiting ? undefined : () => applyFilters(WAITING_ONLY_FILTERS)}
      />

      <BoardSignInStrip />

      <DashboardFilterBar
        sources={sources}
        statusCounts={statusCounts}
        filters={filters}
        onChange={applyFilters}
      />

      <ApplicationList
        applications={applications}
        isSaving={isPending}
        onStatusClick={(applicationId, status) => setStatusChange({ applicationId, status })}
        onClearFilters={hasActiveFilters ? clearFilters : undefined}
      />

      {statusChange && (
        <StatusChangeDialog
          open
          status={statusChange.status}
          isSaving={isPending}
          onStatusChange={(status) => setStatusChange({ ...statusChange, status })}
          onClose={() => setStatusChange(null)}
          onSave={() => saveStatusChange(statusChange)}
        />
      )}
    </Box>
  );
}
