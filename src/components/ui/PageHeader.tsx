import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ui, fonts } from "@/theme/tokens";

interface PageHeaderProps {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 2,
        mb: 3,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h4">{title}</Typography>
        {meta && (
          <Typography
            component="div"
            sx={{ mt: 0.75, fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textFaint }}
          >
            {meta}
          </Typography>
        )}
      </Box>
      {actions && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>{actions}</Box>
      )}
    </Box>
  );
}
