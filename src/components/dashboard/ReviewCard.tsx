"use client";

import { Box, Button, Stack, Typography } from "@mui/material";
import { ui, fonts } from "@/theme/tokens";
import { calloutSx } from "./panelStyles";
import type { ReviewActionsState, ReviewDetails } from "./useReview";

const SCREENSHOT_MAX_HEIGHT = 220;
const MESSAGE_MAX_HEIGHT = 240;
const READY_TITLE = "Ready for you to send";

export function ScreenshotThumbnail({ url }: { url: string }) {
  return (
    <Box component="a" href={url} target="_blank" rel="noreferrer" sx={{ display: "inline-block", mt: 1 }}>
      <Box
        component="img"
        src={url}
        alt="Latest step of the auto apply run"
        sx={{
          display: "block",
          maxWidth: "100%",
          maxHeight: SCREENSHOT_MAX_HEIGHT,
          border: `1px solid ${ui.line}`,
          borderRadius: 1,
        }}
      />
    </Box>
  );
}

function YourMessage({ text }: { text: string }) {
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography sx={{ fontFamily: fonts.mono, fontSize: "0.72rem", color: ui.textFaint }}>your message</Typography>
      <Box
        sx={{
          mt: 0.5,
          p: 1.25,
          border: `1px solid ${ui.line}`,
          borderRadius: 1,
          backgroundColor: ui.surface,
          color: ui.text,
          fontSize: "0.8125rem",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
          maxHeight: MESSAGE_MAX_HEIGHT,
          overflowY: "auto",
        }}
      >
        {text}
      </Box>
      <Typography variant="body2" sx={{ mt: 0.5, color: ui.textMuted }}>
        Change it in the apply window if you want to, then send it there.
      </Typography>
    </Box>
  );
}

interface ReviewCardProps {
  detail: string | null;
  review: ReviewDetails;
  reviewState: ReviewActionsState;
  onOpenWindow: () => void;
  onMarkSent: () => void;
  onDiscard: () => void;
}

export function ReviewCard({ detail, review, reviewState, onOpenWindow, onMarkSent, onDiscard }: ReviewCardProps) {
  const { pending, error } = reviewState;
  const isBusy = pending !== null;

  return (
    <Box sx={calloutSx(ui.orange)} role="status" aria-live="polite">
      <Typography variant="body2" sx={{ color: ui.text }}>
        {READY_TITLE}
        {detail && <Box component="span" sx={{ color: ui.textMuted }}> · {detail}</Box>}
      </Typography>

      {review.screenshotUrl && <ScreenshotThumbnail url={review.screenshotUrl} />}
      {review.draft && <YourMessage text={review.draft} />}

      <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1.25, flexWrap: "wrap" }}>
        <Button size="small" variant="contained" onClick={onOpenWindow} disabled={isBusy}>
          {pending === "focus" ? "Opening…" : "Open the window"}
        </Button>
        <Button size="small" variant="outlined" onClick={onMarkSent} disabled={isBusy}>
          {pending === "SENT" ? "Marking…" : "Mark as sent"}
        </Button>
        <Button size="small" variant="text" onClick={onDiscard} disabled={isBusy} sx={{ color: ui.textFaint }}>
          {pending === "DISCARDED" ? "Discarding…" : "Discard"}
        </Button>
      </Stack>

      {error && (
        <Typography variant="body2" role="alert" sx={{ mt: 0.75, color: ui.red }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
