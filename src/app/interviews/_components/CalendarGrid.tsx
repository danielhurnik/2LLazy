import { Box, Card, CardContent, Typography } from "@mui/material";
import { ios } from "@/theme/theme";
import dayjs from "dayjs";
import { CalendarDayCell } from "./CalendarDayCell";
import type { CalendarEntry } from "@/types";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  currentMonth: ReturnType<typeof dayjs>;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onDayDoubleClick: (date: string) => void;
}

export function CalendarGrid({ currentMonth, entries, onEntryClick, onDayDoubleClick }: Props) {
  const daysInMonth = currentMonth.daysInMonth();
  const firstDayOfWeek = currentMonth.startOf("month").day();
  const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;
  const today = dayjs();

  const entriesByDay = entries.reduce<Record<number, CalendarEntry[]>>((acc, entry) => {
    const d = dayjs(entry.scheduledAt).date();
    acc[d] = [...(acc[d] ?? []), entry];
    return acc;
  }, {});

  return (
    <Card>
      <CardContent sx={{ p: 0 }}>
        {/* Day-of-week headers */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(7, 1fr)",
            borderBottom: `1px solid ${ios.separator}`,
          }}
        >
          {DAYS_OF_WEEK.map((d) => (
            <Box key={d} sx={{ py: 1, textAlign: "center" }}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                {d}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Day cells */}
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {Array.from({ length: totalCells }).map((_, idx) => {
            const dayNum = idx - firstDayOfWeek + 1;
            const isCurrentMonth = dayNum > 0 && dayNum <= daysInMonth;
            const isToday = isCurrentMonth && currentMonth.date(dayNum).isSame(today, "day");
            const dayEntries = isCurrentMonth ? (entriesByDay[dayNum] ?? []) : [];

            return (
              <CalendarDayCell
                key={idx}
                dayNum={dayNum}
                isCurrentMonth={isCurrentMonth}
                isToday={isToday}
                entries={dayEntries}
                onEntryClick={onEntryClick}
                onDayDoubleClick={(d) =>
                  onDayDoubleClick(currentMonth.date(d).format("YYYY-MM-DDTHH:mm"))
                }
              />
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}
