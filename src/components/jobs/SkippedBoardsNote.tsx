"use client";

import { useState } from "react";
import { Box, ButtonBase, Collapse, IconButton, Stack, Typography } from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { ui, fonts } from "@/theme/tokens";

interface SkippedBoardsNoteProps {
  reasons: string[];
  onDismiss: () => void;
}

const captionSx = { fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textMuted } as const;

const toggleLinkSx = {
  ...captionSx,
  textDecoration: "underline",
  textDecorationColor: ui.lineStrong,
  textUnderlineOffset: 3,
  "&:hover": { color: ui.text, textDecorationColor: ui.accent },
} as const;

const boardCount = (count: number) => `${count} ${count === 1 ? "board" : "boards"}`;

export function SkippedBoardsNote({ reasons, onDismiss }: SkippedBoardsNoteProps) {
  const [showReasons, setShowReasons] = useState(false);

  return (
    <Box sx={{ mb: 2, pl: 1.5, pr: 0.5, py: 0.5, border: `1px solid ${ui.line}`, borderRadius: 1 }}>
      <Stack direction="row" alignItems="center" gap={1.5}>
        <Typography sx={captionSx}>{boardCount(reasons.length)} skipped</Typography>
        <ButtonBase
          aria-expanded={showReasons}
          onClick={() => setShowReasons((isShown) => !isShown)}
          sx={toggleLinkSx}
        >
          {showReasons ? "hide reasons" : "why?"}
        </ButtonBase>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton size="small" aria-label="Dismiss skipped boards note" onClick={onDismiss}>
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
      <Collapse in={showReasons}>
        <Box component="ul" sx={{ m: 0, mb: 1, pl: 2.25, color: ui.textMuted }}>
          {reasons.map((reason) => (
            <Typography key={reason} component="li" variant="body2" sx={{ color: ui.textMuted, py: 0.25 }}>
              {reason}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}
