"use client";

import { Box, ButtonBase, Stack } from "@mui/material";
import { ALL_STATUSES, STATUS_LABEL, type AppStatus } from "@/types";
import { statusTone } from "@/components/ui/StatusChip";
import {
  ALL_OPTION,
  HasSalarySwitch,
  PositionFilterField,
  SourceFilterSelect,
} from "@/components/jobs/JobFilterBar";
import { ui, fonts } from "@/theme/tokens";

export interface DashboardFilters {
  status: string;
  source: string;
  position: string;
  hasSalary: boolean;
}

interface DashboardFilterBarProps {
  sources: string[];
  statusCounts: Record<string, number>;
  filters: DashboardFilters;
  onChange: (filters: DashboardFilters) => void;
}

interface StatusTab {
  key: string;
  label: string;
  count: number;
  tone: string | null;
}

export const sumStatusCounts = (statusCounts: Record<string, number>) =>
  Object.values(statusCounts).reduce((total, count) => total + count, 0);

const HIDDEN_WHEN_EMPTY: AppStatus[] = ["APPLYING", "WAITING_FOR_USER", "NEEDS_MANUAL"];

const isTabShown = (status: AppStatus, count: number, activeStatus: string) =>
  count > 0 || status === activeStatus || !HIDDEN_WHEN_EMPTY.includes(status);

function buildStatusTabs(statusCounts: Record<string, number>, activeStatus: string): StatusTab[] {
  const statusTabs = ALL_STATUSES.map((status) => ({
    status,
    key: status,
    label: STATUS_LABEL[status],
    count: statusCounts[status] ?? 0,
    tone: statusTone(status),
  })).filter(({ status, count }) => isTabShown(status, count, activeStatus));

  return [
    { key: ALL_OPTION, label: "All", count: sumStatusCounts(statusCounts), tone: null },
    ...statusTabs,
  ];
}

interface StatusTabButtonProps {
  tab: StatusTab;
  isActive: boolean;
  onSelect: () => void;
}

function StatusTabButton({ tab, isActive, onSelect }: StatusTabButtonProps) {
  return (
    <ButtonBase
      aria-pressed={isActive}
      onClick={onSelect}
      sx={{
        gap: 0.75,
        py: 1.25,
        fontSize: "0.84375rem",
        fontWeight: isActive ? 600 : 500,
        whiteSpace: "nowrap",
        color: isActive ? ui.text : ui.textMuted,
        borderBottom: `2px solid ${isActive ? ui.accent : "transparent"}`,
        "&:hover": { color: ui.text },
      }}
    >
      {tab.tone && (
        <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: tab.tone }} />
      )}
      {tab.label}
      <Box
        component="span"
        sx={{ fontFamily: fonts.mono, fontSize: "0.6875rem", color: tab.count ? ui.textMuted : ui.textFaint }}
      >
        {tab.count}
      </Box>
    </ButtonBase>
  );
}

export function DashboardFilterBar({
  sources,
  statusCounts,
  filters,
  onChange,
}: DashboardFilterBarProps) {
  const updateFilter = <K extends keyof DashboardFilters>(
    key: K,
    value: DashboardFilters[K],
  ) => onChange({ ...filters, [key]: value });

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box
        aria-label="Filter by status"
        sx={{
          display: "flex",
          gap: 2.5,
          mb: 2,
          boxShadow: `inset 0 -1px 0 ${ui.line}`,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {buildStatusTabs(statusCounts, filters.status).map((tab) => (
          <StatusTabButton
            key={tab.key}
            tab={tab}
            isActive={filters.status === tab.key}
            onSelect={() => updateFilter("status", tab.key)}
          />
        ))}
      </Box>

      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        <PositionFilterField
          value={filters.position}
          onCommit={(position) => updateFilter("position", position)}
        />

        <SourceFilterSelect
          sources={sources}
          value={filters.source}
          onChange={(source) => updateFilter("source", source)}
        />

        <HasSalarySwitch
          checked={filters.hasSalary}
          onChange={(hasSalary) => updateFilter("hasSalary", hasSalary)}
        />
      </Stack>
    </Box>
  );
}
