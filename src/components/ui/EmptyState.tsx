import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ui } from "@/theme/theme";

interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <Box
      sx={{
        border: `1px dashed ${ui.lineStrong}`,
        borderRadius: 2,
        px: 3,
        py: 3.5,
      }}
    >
      <Typography variant="h6" component="p">
        {title}
      </Typography>
      {children && (
        <Typography variant="body2" sx={{ mt: 0.5, color: ui.textMuted, maxWidth: 520 }}>
          {children}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}
