"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Box, Button, Card, CardContent, Typography } from "@mui/material";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { statusTone } from "@/components/ui/StatusChip";
import type { AppStatus } from "@/types";
import { ALL_STATUSES, STATUS_LABEL, sourceLabel } from "@/types";
import { ui, fonts } from "@/theme/tokens";

interface Props {
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  weekly: { week: string; count: number }[];
  totalApplications: number;
  interviewRate: number;
}

interface CategoryRow {
  label: string;
  count: number;
}

interface StatusRow extends CategoryRow {
  tone: string;
}

const CHART_HEIGHT = 220;
const STATUS_LABEL_WIDTH = 88;
const SOURCE_LABEL_WIDTH = 112;
const WEEKLY_CHART_MARGIN = { top: 4, right: 4, bottom: 0, left: -20 };
const CATEGORY_CHART_MARGIN = { top: 0, right: 8, bottom: 0, left: 0 };
const WEEKLY_BAR_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
const CATEGORY_BAR_RADIUS: [number, number, number, number] = [0, 3, 3, 0];
const SERIES_NAME = "Applications";

const AXIS_TICK = { fill: ui.textFaint, fontSize: 11 };
const AXIS_STYLE = { tick: AXIS_TICK, axisLine: false, tickLine: false };
const TOOLTIP_PROPS = {
  cursor: { fill: "rgba(255,255,245,0.03)" },
  contentStyle: {
    backgroundColor: ui.raised,
    border: `1px solid ${ui.lineStrong}`,
    borderRadius: 6,
    fontSize: 12,
    padding: "6px 10px",
  },
  labelStyle: { color: ui.text, marginBottom: 2 },
  itemStyle: { color: ui.textMuted, padding: 0 },
};

const pluralSuffix = (count: number) => (count === 1 ? "" : "s");

const isAppStatus = (status: string): status is AppStatus =>
  ALL_STATUSES.some((knownStatus) => knownStatus === status);

function toStatusRow({ status, count }: { status: string; count: number }): StatusRow {
  if (!isAppStatus(status)) return { label: status, count, tone: ui.textFaint };
  return { label: STATUS_LABEL[status], count, tone: statusTone(status) };
}

function Figure({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return (
    <Box
      sx={{
        px: 2.25,
        py: 2,
        "& + &": {
          borderTop: { xs: `1px solid ${ui.line}`, sm: "none" },
          borderLeft: { sm: `1px solid ${ui.line}` },
        },
      }}
    >
      <Typography variant="overline" component="div" sx={{ color: ui.textFaint }}>
        {label}
      </Typography>
      <Typography
        sx={{ mt: 0.25, fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1 }}
      >
        {value}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.25, color: ui.textFaint }}>
        {note}
      </Typography>
    </Box>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {title}
        </Typography>
        <Box sx={{ "& .recharts-cartesian-axis-tick text": { fontFamily: fonts.mono } }}>
          {children}
        </Box>
      </CardContent>
    </Card>
  );
}

function WeeklyChart({ weekly }: { weekly: Props["weekly"] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={weekly} margin={WEEKLY_CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={ui.line} />
        <XAxis dataKey="week" {...AXIS_STYLE} />
        <YAxis {...AXIS_STYLE} allowDecimals={false} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Bar dataKey="count" name={SERIES_NAME} fill={ui.accent} radius={WEEKLY_BAR_RADIUS} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CategoryChart({
  rows,
  labelWidth,
  barColor,
  children,
}: {
  rows: CategoryRow[];
  labelWidth: number;
  barColor?: string;
  children?: ReactNode;
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={rows} layout="vertical" margin={CATEGORY_CHART_MARGIN}>
        <CartesianGrid horizontal={false} stroke={ui.line} />
        <XAxis type="number" {...AXIS_STYLE} allowDecimals={false} />
        <YAxis type="category" dataKey="label" {...AXIS_STYLE} width={labelWidth} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Bar dataKey="count" name={SERIES_NAME} fill={barColor} radius={CATEGORY_BAR_RADIUS} barSize={14}>
          {children}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function StatsCharts({
  weekly,
  statusRows,
  sourceRows,
}: {
  weekly: Props["weekly"];
  statusRows: StatusRow[];
  sourceRows: CategoryRow[];
}) {
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <ChartCard title="Applications per week">
        <WeeklyChart weekly={weekly} />
      </ChartCard>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <ChartCard title="By status">
          <CategoryChart rows={statusRows} labelWidth={STATUS_LABEL_WIDTH}>
            {statusRows.map((row) => (
              <Cell key={row.label} fill={row.tone} />
            ))}
          </CategoryChart>
        </ChartCard>

        <ChartCard title="By board">
          <CategoryChart rows={sourceRows} labelWidth={SOURCE_LABEL_WIDTH} barColor={ui.textFaint} />
        </ChartCard>
      </Box>
    </Box>
  );
}

function NoStatsYet() {
  return (
    <EmptyState
      title="No numbers yet"
      action={
        <Button component={Link} href="/" variant="outlined" size="small">
          Search jobs
        </Button>
      }
    >
      Charts fill in once you track your first application.
    </EmptyState>
  );
}

export function StatsClient({ byStatus, bySource, weekly, totalApplications, interviewRate }: Props) {
  const offersCount = byStatus.find((r) => r.status === "OFFER")?.count ?? 0;
  const hasData = totalApplications > 0;

  const statusRows = byStatus.map(toStatusRow);
  const sourceRows = bySource.map((r) => ({ label: sourceLabel(r.source), count: r.count }));

  return (
    <Box>
      <PageHeader
        title="Stats"
        meta={
          hasData
            ? `Based on ${totalApplications} tracked application${pluralSuffix(totalApplications)}`
            : undefined
        }
      />

      <Card sx={{ mb: 2 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(3, 1fr)" } }}>
          <Figure label="Tracked" value={totalApplications} note="applications on the dashboard" />
          <Figure label="Interview rate" value={`${interviewRate}%`} note="of them reached an interview" />
          <Figure label="Offers" value={offersCount} note={`offer${pluralSuffix(offersCount)} so far`} />
        </Box>
      </Card>

      {hasData ? (
        <StatsCharts weekly={weekly} statusRows={statusRows} sourceRows={sourceRows} />
      ) : (
        <NoStatsYet />
      )}
    </Box>
  );
}
