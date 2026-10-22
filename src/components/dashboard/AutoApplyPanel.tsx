"use client";

import { useEffect, useState } from "react";
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { Application } from "@/types";
import type { ObstacleSummary } from "@/lib/apply/obstacles";
import { loadObstacleSummary } from "@/lib/actions/applicationActions";
import type { AutoApplyRun, ResumeState } from "./useAutoApply";
import { ui, fonts } from "@/theme/tokens";

const SCREENSHOT_MAX_HEIGHT = 220;
const RUN_IN_PROGRESS_NOTE = "A run is in progress. Refresh to see the result.";
const WAITING_PREFIX = "Waiting for you:";
const NEEDS_YOU_TITLE = "Needs you";

interface CalloutView {
  tone: string;
  title: string;
  detail: string | null;
  screenshotUrl: string | null;
  evidenceUrl: string | null;
  canFinishManually: boolean;
  canContinue: boolean;
}

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

export const evidenceUrlFor = (application: Application) =>
  application.evidencePath ? `/api/apply/evidence/${application.id}/` : null;

const withoutWaitingPrefix = (message: string | null) =>
  message?.startsWith(WAITING_PREFIX) ? message.slice(WAITING_PREFIX.length).trim() : message;

function describeLiveRun(run: AutoApplyRun, application: Application): CalloutView | null {
  const shared = {
    screenshotUrl: run.screenshotUrl,
    evidenceUrl: run.outcome?.evidenceUrl ?? evidenceUrlFor(application),
    canFinishManually: false,
    canContinue: false,
  };
  if (run.isRunning && run.waiting) {
    return {
      ...shared,
      tone: ui.orange,
      title: NEEDS_YOU_TITLE,
      detail: run.waiting.message,
      evidenceUrl: null,
      canContinue: true,
    };
  }
  if (run.isRunning) {
    return { ...shared, tone: ui.blue, title: "Applying", detail: run.message, evidenceUrl: null };
  }
  if (run.error) return { ...shared, tone: ui.red, title: "Auto apply failed", detail: run.error };
  if (!run.outcome) return null;

  const detail = run.outcome.message ?? application.errorMessage;
  switch (run.outcome.status) {
    case "APPLIED":
      return { ...shared, tone: ui.green, title: "Application sent", detail: run.outcome.message ?? null };
    case "NEEDS_MANUAL":
      return { ...shared, tone: ui.orange, title: "Needs finishing by hand", detail, canFinishManually: true };
    case "FAILED":
      return { ...shared, tone: ui.red, title: "Auto apply failed", detail };
  }
}

function describeSavedState(application: Application): CalloutView | null {
  const shared = {
    screenshotUrl: null,
    evidenceUrl: evidenceUrlFor(application),
    canFinishManually: false,
    canContinue: false,
  };
  switch (application.status) {
    case "WAITING_FOR_USER":
      return {
        ...shared,
        tone: ui.orange,
        title: NEEDS_YOU_TITLE,
        detail: withoutWaitingPrefix(application.errorMessage),
        evidenceUrl: null,
        canContinue: true,
      };
    case "APPLYING":
      return { ...shared, tone: ui.blue, title: "Applying", detail: RUN_IN_PROGRESS_NOTE, evidenceUrl: null };
    case "NEEDS_MANUAL":
      return {
        ...shared,
        tone: ui.orange,
        title: "Needs finishing by hand",
        detail: application.errorMessage,
        canFinishManually: true,
      };
    case "FAILED":
      return application.errorMessage || shared.evidenceUrl
        ? { ...shared, tone: ui.red, title: "Auto apply failed", detail: application.errorMessage }
        : null;
    default:
      return null;
  }
}

function ScreenshotThumbnail({ url }: { url: string }) {
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

interface ContinueControlProps {
  resumeState: ResumeState;
  onContinue: () => void;
}

function ContinueControl({ resumeState, onContinue }: ContinueControlProps) {
  return (
    <Stack direction="row" alignItems="center" gap={1.5} sx={{ mt: 1 }}>
      <Button size="small" variant="contained" onClick={onContinue} disabled={resumeState.isResuming}>
        {resumeState.isResuming ? "Continuing…" : "Continue"}
      </Button>
      {resumeState.error && (
        <Typography variant="body2" sx={{ color: ui.red }}>
          {resumeState.error}
        </Typography>
      )}
    </Stack>
  );
}

interface AutoApplyPanelProps {
  application: Application;
  run: AutoApplyRun;
  resumeState: ResumeState;
  onContinue: () => void;
  onShowEvidence: (evidenceUrl: string) => void;
}

export function AutoApplyPanel({ application, run, resumeState, onContinue, onShowEvidence }: AutoApplyPanelProps) {
  const view = describeLiveRun(run, application) ?? describeSavedState(application);
  if (!view) return null;
  const { evidenceUrl } = view;
  const isProgressLine = run.isRunning && !run.waiting;

  return (
    <Box sx={calloutSx(view.tone)} role="status" aria-live="polite">
      <Typography variant="body2" sx={{ color: ui.text }}>
        {view.title}
        {view.detail && (
          <Box
            component="span"
            sx={isProgressLine
              ? { ml: 1, fontFamily: fonts.mono, fontSize: "0.78rem", color: ui.textMuted }
              : { color: ui.textMuted }}
          >
            {isProgressLine ? view.detail : ` · ${view.detail}`}
          </Box>
        )}
      </Typography>

      {view.screenshotUrl && <ScreenshotThumbnail url={view.screenshotUrl} />}

      {view.canContinue && <ContinueControl resumeState={resumeState} onContinue={onContinue} />}

      {(view.canFinishManually || evidenceUrl) && (
        <Stack direction="row" spacing={2} sx={{ mt: 0.75 }}>
          {view.canFinishManually && (
            <Box component="a" href={application.job.sourceUrl} target="_blank" rel="noreferrer" sx={panelLinkSx}>
              Finish manually ↗
            </Box>
          )}
          {evidenceUrl && (
            <ButtonBase onClick={() => onShowEvidence(evidenceUrl)} sx={panelLinkSx}>
              Evidence
            </ButtonBase>
          )}
        </Stack>
      )}
    </Box>
  );
}

function describeObstacles({ host, attempts, captchas, logins, blockerHost }: ObstacleSummary): string {
  const applies = `your ${attempts} auto-apply ${attempts === 1 ? "run" : "runs"} so far`;
  const outOfAttempts = (count: number) => Math.min(count, attempts);
  const asks = [
    captchas > 0 ? `a CAPTCHA on ${outOfAttempts(captchas)}` : null,
    logins > 0 ? `a sign-in on ${outOfAttempts(logins)}` : null,
  ].filter((ask): ask is string => ask !== null);
  if (asks.length === 0) return `No CAPTCHA or sign-in on ${host} in ${applies}.`;
  const subject = blockerHost ? `${host} postings apply through ${blockerHost}, which` : host;
  return `${subject} asked for ${asks.join(" and ")} of ${applies}.`;
}

function useObstacleSummary(jobId: string): ObstacleSummary | null {
  const [summary, setSummary] = useState<ObstacleSummary | null>(null);
  useEffect(() => {
    let isCurrent = true;
    loadObstacleSummary(jobId)
      .then((result) => {
        if (isCurrent) setSummary(result);
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [jobId]);
  return summary;
}

function ObstacleNote({ summary }: { summary: ObstacleSummary }) {
  const hasBlockers = summary.captchas > 0 || summary.logins > 0;
  return (
    <Box sx={hasBlockers ? calloutSx(ui.orange) : { mt: 1.5 }}>
      <Typography variant="body2" sx={{ color: hasBlockers ? ui.text : ui.textMuted }}>
        {describeObstacles(summary)}
      </Typography>
    </Box>
  );
}

interface AutoApplyConfirmDialogProps {
  job: Application["job"];
  onCancel: () => void;
  onConfirm: () => void;
}

export function AutoApplyConfirmDialog({ job, onCancel, onConfirm }: AutoApplyConfirmDialogProps) {
  const obstacles = useObstacleSummary(job.id);
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Apply automatically?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: ui.text }}>
          {job.title}
          <Box component="span" sx={{ color: ui.textMuted }}> · {job.company}</Box>
        </Typography>
        <Typography variant="body2" sx={{ mt: 1.5, color: ui.textMuted }}>
          Fills in the application form with your profile and CV, then submits it. A browser
          window opens on this computer while it runs. Forms it can&apos;t fill with confidence stop
          before submitting, so you can finish them yourself.
        </Typography>
        {obstacles && <ObstacleNote summary={obstacles} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
