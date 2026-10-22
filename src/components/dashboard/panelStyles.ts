import { alpha } from "@mui/material";
import { ui } from "@/theme/tokens";

export const calloutSx = (tone: string) => ({
  mt: 1.5,
  py: 0.75,
  px: 1.5,
  borderLeft: `2px solid ${tone}`,
  backgroundColor: alpha(tone, 0.06),
  borderRadius: "0 4px 4px 0",
});

export const panelLinkSx = {
  font: "inherit",
  fontSize: "0.8125rem",
  color: ui.text,
  textDecoration: "underline",
  textDecorationColor: ui.lineStrong,
  textUnderlineOffset: 3,
  "&:hover": { textDecorationColor: ui.accent },
} as const;
