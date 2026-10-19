import { Box, ButtonBase, Stack, Typography, alpha } from "@mui/material";
import dayjs from "dayjs";
import type { CalendarEntry } from "@/types";
import { ui, fonts } from "@/theme/theme";

const DAYS_PER_WEEK = 7;
const DAY_BADGE_SIZE_PX = 22;
const WEEKEND_BACKGROUND = "rgba(0,0,0,0.14)";
const ENTRY_TIME_FORMAT = "HH:mm";

const ENTRY_TONE: Record<CalendarEntry["type"], string> = {
  interview: ui.green,
  event: ui.blue,
};

interface Props {
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onDayDoubleClick: (dayNum: number) => void;
}

function DayNumberBadge({ dayNum, isToday }: { dayNum: number; isToday: boolean }) {
  return (
    <Typography
      sx={{
        width: DAY_BADGE_SIZE_PX,
        height: DAY_BADGE_SIZE_PX,
        mb: 0.5,
        borderRadius: "50%",
        textAlign: "center",
        lineHeight: `${DAY_BADGE_SIZE_PX}px`,
        fontFamily: fonts.mono,
        fontSize: "0.75rem",
        fontWeight: isToday ? 700 : 400,
        backgroundColor: isToday ? ui.accent : "transparent",
        color: isToday ? ui.accentInk : ui.textMuted,
      }}
    >
      {dayNum}
    </Typography>
  );
}

function CalendarEntryButton({
  entry,
  onClick,
}: {
  entry: CalendarEntry;
  onClick: (entry: CalendarEntry) => void;
}) {
  const tone = ENTRY_TONE[entry.type];
  return (
    <ButtonBase
      onClick={(e) => {
        e.stopPropagation();
        onClick(entry);
      }}
      sx={{
        display: "block",
        width: "100%",
        textAlign: "left",
        px: 0.75,
        py: 0.25,
        fontSize: "0.6875rem",
        lineHeight: 1.5,
        color: ui.text,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        borderLeft: `2px solid ${tone}`,
        borderRadius: "0 3px 3px 0",
        backgroundColor: alpha(tone, 0.1),
        "&:hover": { backgroundColor: alpha(tone, 0.18) },
      }}
    >
      <Box component="span" sx={{ fontFamily: fonts.mono, color: ui.textMuted, mr: 0.5 }}>
        {dayjs(entry.scheduledAt).format(ENTRY_TIME_FORMAT)}
      </Box>
      {entry.title}
    </ButtonBase>
  );
}

export function CalendarDayCell({
  dayNum,
  isCurrentMonth,
  isToday,
  isWeekend,
  entries,
  onEntryClick,
  onDayDoubleClick,
}: Props) {
  return (
    <Box
      onDoubleClick={() => isCurrentMonth && onDayDoubleClick(dayNum)}
      sx={{
        minHeight: 96,
        p: 0.75,
        borderRight: `1px solid ${ui.line}`,
        borderBottom: `1px solid ${ui.line}`,
        [`&:nth-of-type(${DAYS_PER_WEEK}n)`]: { borderRight: "none" },
        backgroundColor: isWeekend ? WEEKEND_BACKGROUND : "transparent",
        cursor: isCurrentMonth ? "pointer" : "default",
        "&:hover": isCurrentMonth ? { backgroundColor: ui.hover } : {},
      }}
    >
      {isCurrentMonth && <DayNumberBadge dayNum={dayNum} isToday={isToday} />}
      <Stack spacing={0.5}>
        {entries.map((entry) => (
          <CalendarEntryButton key={entry.id} entry={entry} onClick={onEntryClick} />
        ))}
      </Stack>
    </Box>
  );
}
