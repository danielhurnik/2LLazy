import { Box, Card, Typography } from "@mui/material";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { CalendarDayCell } from "./CalendarDayCell";
import type { CalendarEntry } from "@/types";
import { ui } from "@/theme/tokens";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_PER_WEEK = WEEKDAY_LABELS.length;
const FIRST_WEEKEND_COLUMN = WEEKDAY_LABELS.indexOf("Sat");
const WEEK_GRID_COLUMNS = `repeat(${DAYS_PER_WEEK}, 1fr)`;
const DATETIME_LOCAL_FORMAT = "YYYY-MM-DDTHH:mm";

interface Props {
  currentMonth: Dayjs;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onDayDoubleClick: (date: string) => void;
}

const toMondayFirstWeekday = (sundayFirstWeekday: number) =>
  (sundayFirstWeekday + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;

const roundUpToWholeWeeks = (days: number) => Math.ceil(days / DAYS_PER_WEEK) * DAYS_PER_WEEK;

const isWeekendColumn = (cellIndex: number) => cellIndex % DAYS_PER_WEEK >= FIRST_WEEKEND_COLUMN;

function groupEntriesByDayOfMonth(entries: CalendarEntry[]) {
  return entries.reduce<Record<number, CalendarEntry[]>>((byDay, entry) => {
    const dayOfMonth = dayjs(entry.scheduledAt).date();
    byDay[dayOfMonth] = [...(byDay[dayOfMonth] ?? []), entry];
    return byDay;
  }, {});
}

function WeekdayHeader() {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: WEEK_GRID_COLUMNS,
        borderBottom: `1px solid ${ui.line}`,
      }}
    >
      {WEEKDAY_LABELS.map((label) => (
        <Box key={label} sx={{ px: 1, py: 1 }}>
          <Typography variant="overline" sx={{ color: ui.textFaint }}>
            {label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function CalendarGrid({ currentMonth, entries, onEntryClick, onDayDoubleClick }: Props) {
  const daysInMonth = currentMonth.daysInMonth();
  const leadingBlankCells = toMondayFirstWeekday(currentMonth.startOf("month").day());
  const totalCells = roundUpToWholeWeeks(leadingBlankCells + daysInMonth);
  const today = dayjs();
  const entriesByDay = groupEntriesByDayOfMonth(entries);

  const handleDayDoubleClick = (dayNum: number) =>
    onDayDoubleClick(currentMonth.date(dayNum).format(DATETIME_LOCAL_FORMAT));

  return (
    <Card>
      <WeekdayHeader />

      <Box sx={{ display: "grid", gridTemplateColumns: WEEK_GRID_COLUMNS }}>
        {Array.from({ length: totalCells }).map((_, cellIndex) => {
          const dayNum = cellIndex - leadingBlankCells + 1;
          const isCurrentMonth = dayNum > 0 && dayNum <= daysInMonth;
          const isToday = isCurrentMonth && currentMonth.date(dayNum).isSame(today, "day");
          const dayEntries = isCurrentMonth ? (entriesByDay[dayNum] ?? []) : [];

          return (
            <CalendarDayCell
              key={cellIndex}
              dayNum={dayNum}
              isCurrentMonth={isCurrentMonth}
              isToday={isToday}
              isWeekend={isWeekendColumn(cellIndex)}
              entries={dayEntries}
              onEntryClick={onEntryClick}
              onDayDoubleClick={handleDayDoubleClick}
            />
          );
        })}
      </Box>
    </Card>
  );
}
