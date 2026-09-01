"use client";

import { Box, Card, CardContent, Typography, Stack, alpha } from "@mui/material";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import { ios } from "@/theme/theme";

interface Props {
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  weekly: { week: string; count: number }[];
  totalApplications: number;
  interviewRate: number;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: ios.label3,
  APPLIED: ios.blue,
  REJECTED: ios.red,
  INTERVIEW: ios.green,
  OFFER: ios.teal,
  FAILED: ios.orange,
};

const SOURCE_COLORS: Record<string, string> = {
  STARTUPJOBS: ios.green,
  JOBSTACK: ios.orange,
  COCUMA: ios.blue,
};

const CHART_STYLE = {
  background: "transparent",
  fontSize: 12,
  color: ios.label2,
};

const AXIS_STYLE = { fill: ios.label3, fontSize: 11 };
const GRID_STYLE = { stroke: ios.separator };
const TOOLTIP_STYLE = {
  contentStyle: {
    background: ios.surface1,
    border: `1px solid ${ios.separator}`,
    borderRadius: 10,
    fontSize: 12,
  },
  labelStyle: { color: ios.label1 },
  itemStyle: { color: ios.label2 },
};

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <Card sx={{ flex: 1 }}>
      <CardContent sx={{ py: 2.5 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, fontSize: "0.8rem" }}>
          {label}
        </Typography>
        <Typography
          variant="h4"
          sx={{ fontWeight: 600, color: color ?? ios.label1 }}
        >
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function StatsClient({ byStatus, bySource, weekly, totalApplications, interviewRate }: Props) {
  const offersCount = byStatus.find((r) => r.status === "OFFER")?.count ?? 0;

  return (
    <Box>
      {/* ── Header ── */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Statistics
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Overview of your job application activity.
        </Typography>
      </Box>

      {/* ── Stat cards ── */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <StatCard label="Total Applications" value={totalApplications} color={ios.blue} />
        <StatCard label="Interview Rate" value={`${interviewRate}%`} color={ios.green} />
        <StatCard label="Offers" value={offersCount} color={ios.teal} />
      </Stack>

      {/* ── Weekly activity chart ── */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2, fontSize: 14, fontWeight: 600 }}>
            Applications per Week
          </Typography>
          <Box>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={weekly} style={CHART_STYLE}>
                <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} />
                <XAxis dataKey="week" tick={AXIS_STYLE} />
                <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={ios.blue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </Card>

      {/* ── Status + Source charts ── */}
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontSize: 14, fontWeight: 600 }}>
              By Status
            </Typography>
            <Box>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byStatus} layout="vertical" style={CHART_STYLE}>
                  <CartesianGrid strokeDasharray="3 3" {...GRID_STYLE} />
                  <XAxis type="number" tick={AXIS_STYLE} allowDecimals={false} />
                  <YAxis type="category" dataKey="status" tick={AXIS_STYLE} width={80} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {byStatus.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={STATUS_COLORS[entry.status] ?? ios.label2}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2, fontSize: 14, fontWeight: 600 }}>
              By Source
            </Typography>
            <Box>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart style={CHART_STYLE}>
                  <Pie
                    data={bySource}
                    dataKey="count"
                    nameKey="source"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ name, percent }) =>
                      `${name} ${Math.round((percent ?? 0) * 100)}%`
                    }
                    labelLine={false}
                  >
                    {bySource.map((entry) => (
                      <Cell
                        key={entry.source}
                        fill={SOURCE_COLORS[entry.source] ?? ios.indigo}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Pie>
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Legend
                    formatter={(value) => (
                      <span style={{ color: ios.label2, fontSize: 12 }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
