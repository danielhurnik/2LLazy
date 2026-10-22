"use client";

import { useEffect, useState } from "react";
import {
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
import { calloutSx, panelLinkSx } from "./panelStyles";
import { PostingSignInHint } from "./BoardSignIn";
import { ReviewCard, ScreenshotThumbnail } from "./ReviewCard";
import { useReviewActions, useSavedReview, type ReviewDetails } from "./useReview";

const RUN_IN_PROGRESS_NOTE = "A run is in progress. Refresh to see the result.";
const WAITING_PREFIX = "Waiting for you:";
const NEEDS_YOU_TITLE = "Needs you";
const FILLING_TITLE = "Filling in";
const FILL_FAILED_TITLE = "Could not fill it in";

interface CalloutView {
  tone: string;
  title: string;
  detail: string | null;
  screenshotUrl: string | null;
  evidenceUrl: string | null;
  canFinishManually: boolean;
  canContinue: boolean;
}

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
    return { ...shared, tone: ui.blue, title: FILLING_TITLE, detail: run.message, evidenceUrl: null };
  }
  if (run.error) return { ...shared, tone: ui.red, title: FILL_FAILED_TITLE, detail: run.error };
  if (!run.outcome) return null;

  const detail = run.outcome.message ?? application.errorMessage;
  switch (run.outcome.status) {
    case "APPLIED":
      return { ...shared, tone: ui.green, title: "Application sent", detail: run.outcome.message ?? null };
    case "NEEDS_MANUAL":
      return { ...shared, tone: ui.orange, title: "Needs finishing by hand", detail, canFinishManually: true };
    case "FAILED":
      return { ...shared, tone: ui.red, title: FILL_FAILED_TITLE, detail };
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
      return { ...shared, tone: ui.blue, title: FILLING_TITLE, detail: RUN_IN_PROGRESS_NOTE, evidenceUrl: null };
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
        ? { ...shared, tone: ui.red, title: FILL_FAILED_TITLE, detail: application.errorMessage }
        : null;
    default:
      return null;
  }
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
  const liveReview = run.isRunning && run.waiting?.reason === "review" ? run.waiting : null;
  const savedReview = useSavedReview(application.id, !run.isRunning && application.status === "WAITING_FOR_USER");
  const { reviewState, openWindow, markSent, discard } = useReviewActions(application.id, run.isRunning);
  const review: ReviewDetails | null = liveReview
    ? { draft: liveReview.draft, screenshotUrl: run.screenshotUrl }
    : savedReview;

  if (review) {
    return (
      <ReviewCard
        detail={liveReview?.message ?? withoutWaitingPrefix(application.errorMessage)}
        review={review}
        reviewState={reviewState}
        onOpenWindow={openWindow}
        onMarkSent={markSent}
        onDiscard={discard}
      />
    );
  }

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
      <DialogTitle>Fill in this application?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: ui.text }}>
          {job.title}
          <Box component="span" sx={{ color: ui.textMuted }}> · {job.company}</Box>
        </Typography>
        <Typography variant="body2" sx={{ mt: 1.5, color: ui.textMuted }}>
          Opens the application form in a browser window on this computer and fills it in with
          your profile, CV and message. Nothing is sent: you check the form, change anything you
          like and send it yourself.
        </Typography>
        {obstacles && <ObstacleNote summary={obstacles} />}
        <PostingSignInHint sourceUrl={job.sourceUrl} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm}>
          Fill it in
        </Button>
      </DialogActions>
    </Dialog>
  );
}
