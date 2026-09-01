import { Box, Stack, Typography, Chip } from "@mui/material";
import { ios } from "@/theme/theme";
import dayjs from "dayjs";
import type { CalendarEntry } from "@/types";

interface Props {
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
  onEntryClick: (entry: CalendarEntry) => void;
  onDayDoubleClick: (dayNum: number) => void;
}

export function CalendarDayCell({
  dayNum,
  isCurrentMonth,
  isToday,
  entries,
  onEntryClick,
  onDayDoubleClick,
}: Props) {
  return (
    <Box
      onDoubleClick={() => isCurrentMonth && onDayDoubleClick(dayNum)}
      sx={{
        minHeight: 80,
        p: 0.5,
        borderRight: `1px solid ${ios.separator}`,
        borderBottom: `1px solid ${ios.separator}`,
        cursor: isCurrentMonth ? "pointer" : "default",
        "&:hover": isCurrentMonth ? { bgcolor: "rgba(99,102,241,0.08)" } : {},
      }}
    >
      {isCurrentMonth && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            textAlign: "right",
            fontWeight: isToday ? 700 : 400,
            color: isToday ? "primary.main" : "text.secondary",
            mb: 0.5,
          }}
        >
          {dayNum}
        </Typography>
      )}
      <Stack spacing={0.5}>
        {entries.map((entry) => (
          <Chip
            key={entry.id}
            label={`${dayjs(entry.scheduledAt).format("HH:mm")} ${entry.title}`}
            size="small"
            color={entry.type === "interview" ? "success" : "primary"}
            sx={{ fontSize: 10, height: 20, cursor: "pointer" }}
            onClick={(e) => {
              e.stopPropagation();
              onEntryClick(entry);
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}
