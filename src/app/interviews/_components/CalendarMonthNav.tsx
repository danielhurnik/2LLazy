import { Stack, Typography, IconButton } from "@mui/material";
import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import type { Dayjs } from "dayjs";

interface Props {
  currentMonth: Dayjs;
  isPending: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function CalendarMonthNav({ currentMonth, isPending, onPrev, onNext }: Props) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <IconButton size="small" onClick={onPrev} disabled={isPending} aria-label="Previous month">
        <ChevronLeftRoundedIcon fontSize="small" />
      </IconButton>
      <Typography variant="h6" sx={{ minWidth: 128, textAlign: "center" }}>
        {currentMonth.format("MMMM YYYY")}
      </Typography>
      <IconButton size="small" onClick={onNext} disabled={isPending} aria-label="Next month">
        <ChevronRightRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}
