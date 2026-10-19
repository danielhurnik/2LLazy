import { Box } from "@mui/material";
import { ui } from "@/theme/theme";

type ResponsiveFontSize = number | Partial<Record<"xs" | "sm" | "md", number>>;

interface WordmarkProps {
  size?: ResponsiveFontSize;
}

export function Wordmark({ size = 15 }: WordmarkProps) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: "0.42em",
        py: "0.14em",
        borderRadius: "3px",
        backgroundColor: ui.accent,
        color: ui.accentInk,
        fontSize: size,
        fontWeight: 800,
        letterSpacing: "-0.03em",
        lineHeight: 1.1,
        transform: "rotate(-2deg)",
        whiteSpace: "nowrap",
      }}
    >
      2LLAZY
    </Box>
  );
}
