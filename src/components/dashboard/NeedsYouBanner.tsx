"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, ButtonBase, Stack, Typography } from "@mui/material";
import { errorMessage } from "@/lib/guards";
import { MS_PER_SECOND } from "@/lib/time";
import { ui } from "@/theme/tokens";
import { calloutSx, panelLinkSx } from "./AutoApplyPanel";
import { continueAllWaiting, type ContinueAllResult } from "./useAutoApply";

const RESUME_PICKUP_MS = 3 * MS_PER_SECOND;
const NOTHING_RESUMED = "None of these runs is still waiting, so nothing was resumed.";

interface BannerNote {
  text: string;
  isError: boolean;
}

interface NeedsYouBannerProps {
  waitingCount: number;
  onShowWaiting?: () => void;
}

const describeCount = (count: number) =>
  count === 1 ? "1 application needs you" : `${count} applications need you`;

const runs = (count: number) => (count === 1 ? "1 run" : `${count} runs`);

function describeOutcome({ resumed, swept }: ContinueAllResult): string {
  const stopped = swept > 0 ? `${runs(swept)} had stopped when the server restarted and moved to Needs manual.` : "";
  if (resumed === 0) return stopped || NOTHING_RESUMED;
  return [`Continuing ${runs(resumed)}…`, stopped].filter(Boolean).join(" ");
}

export function NeedsYouBanner({ waitingCount, onShowWaiting }: NeedsYouBannerProps) {
  const router = useRouter();
  const [isContinuing, setIsContinuing] = useState(false);
  const [note, setNote] = useState<BannerNote | null>(null);

  if (waitingCount === 0) return null;

  const continueAll = async () => {
    setIsContinuing(true);
    setNote(null);
    try {
      const result = await continueAllWaiting();
      setNote({ text: describeOutcome(result), isError: false });
      if (result.resumed === 0) {
        router.refresh();
        return;
      }
      setTimeout(() => {
        setNote(null);
        router.refresh();
      }, RESUME_PICKUP_MS);
    } catch (err) {
      setNote({ text: errorMessage(err), isError: true });
    } finally {
      setIsContinuing(false);
    }
  };

  return (
    <Box sx={{ ...calloutSx(ui.orange), mt: 0, mb: 2 }} role="status" aria-live="polite">
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1.5} sx={{ flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ color: ui.text }}>
          {describeCount(waitingCount)}
          <Box component="span" sx={{ color: ui.textMuted }}>
            {" "}· a CAPTCHA or sign-in is open in the apply window
          </Box>
          {onShowWaiting && (
            <>
              {" "}
              <ButtonBase onClick={onShowWaiting} sx={{ ...panelLinkSx, verticalAlign: "baseline" }}>
                show {waitingCount === 1 ? "it" : "them"}
              </ButtonBase>
            </>
          )}
        </Typography>
        <Button size="small" variant="contained" onClick={continueAll} disabled={isContinuing}>
          {isContinuing ? "Continuing…" : waitingCount === 1 ? "Continue" : "Continue all"}
        </Button>
      </Stack>
      {note && (
        <Typography variant="body2" sx={{ mt: 0.5, color: note.isError ? ui.red : ui.textMuted }}>
          {note.text}
        </Typography>
      )}
    </Box>
  );
}
