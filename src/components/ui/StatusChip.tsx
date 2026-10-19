import { Box, Chip } from "@mui/material";
import { STATUS_COLOR, STATUS_LABEL, type AppStatus } from "@/types";
import { ui } from "@/theme/tokens";

type StatusChipColor = (typeof STATUS_COLOR)[AppStatus];

const CHIP_COLOR_HEX: Record<StatusChipColor, string> = {
  default: ui.textFaint,
  primary: ui.accent,
  info: ui.blue,
  success: ui.green,
  error: ui.red,
  warning: ui.orange,
};

export const statusTone = (status: AppStatus) => CHIP_COLOR_HEX[STATUS_COLOR[status]];

interface StatusChipProps {
  status: AppStatus;
}

export function StatusChip({ status }: StatusChipProps) {
  return (
    <Chip
      size="small"
      color={STATUS_COLOR[status]}
      label={STATUS_LABEL[status]}
      icon={
        <Box
          component="span"
          sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "currentColor", flexShrink: 0 }}
        />
      }
    />
  );
}
