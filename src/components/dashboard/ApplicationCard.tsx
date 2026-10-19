"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  Button,
  TextField,
  Collapse,
  ButtonBase,
} from "@mui/material";
import { AUTO_APPLY_STATUSES, type Application, type AppStatus } from "@/types";
import { StatusChip } from "@/components/ui/StatusChip";
import { JobHeading, SourceLinkChip, lineClampSx } from "@/components/jobs/JobCard";
import { updateApplicationNotes } from "@/lib/actions/applicationActions";
import { ui, fonts } from "@/theme/tokens";
import { useAutoApply } from "./useAutoApply";
import { EvidenceDialog } from "./EvidenceDialog";
import {
  AutoApplyConfirmDialog,
  AutoApplyPanel,
  calloutSx,
  evidenceUrlFor,
  panelLinkSx,
} from "./AutoApplyPanel";

interface ApplicationCardProps {
  application: Application;
  onStatusClick: (id: string, status: AppStatus) => void;
}

type ScheduledInterview = NonNullable<Application["interview"]>;

const DATE_LOCALE = "en-GB";
const NOTES_SAVE_FAILED_MESSAGE = "Could not save the note. Try again.";
const COLLAPSED_DESCRIPTION_LINES = 2;

const formatAppliedDate = (iso: string) =>
  new Date(iso).toLocaleDateString(DATE_LOCALE, { day: "numeric", month: "short", year: "numeric" });

const formatInterviewTime = (iso: string) =>
  new Date(iso).toLocaleString(DATE_LOCALE, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

interface SalaryAndAppliedLineProps {
  salary: string | null;
  appliedAt: string | null;
  wasAutoApplied: boolean;
  onShowEvidence?: () => void;
}

function SalaryAndAppliedLine({ salary, appliedAt, wasAutoApplied, onShowEvidence }: SalaryAndAppliedLineProps) {
  if (!appliedAt && !salary) return null;

  return (
    <Typography sx={{ mt: 1, fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textFaint }}>
      {salary && <Box component="span" sx={{ color: ui.text }}>{salary}</Box>}
      {salary && appliedAt && <Box component="span" sx={{ mx: 1 }}>·</Box>}
      {appliedAt && `${wasAutoApplied ? "auto-applied" : "applied"} ${formatAppliedDate(appliedAt)}`}
      {appliedAt && onShowEvidence && (
        <>
          <Box component="span" sx={{ mx: 1 }}>·</Box>
          <ButtonBase onClick={onShowEvidence} sx={{ ...panelLinkSx, fontSize: "inherit", color: ui.textMuted }}>
            evidence
          </ButtonBase>
        </>
      )}
    </Typography>
  );
}

function NotePreview({ note }: { note: string }) {
  return (
    <Typography variant="body2" noWrap sx={{ mt: 1, color: ui.textMuted }}>
      <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: "0.72rem", color: ui.textFaint, mr: 1 }}>
        note
      </Box>
      {note}
    </Typography>
  );
}

interface NotesEditorProps {
  notes: string;
  isSaving: boolean;
  saveError: string | null;
  onNotesChange: (notes: string) => void;
  onSave: () => void;
}

function NotesEditor({ notes, isSaving, saveError, onNotesChange, onSave }: NotesEditorProps) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <TextField
        multiline
        minRows={2}
        maxRows={5}
        fullWidth
        size="small"
        placeholder="Recruiter name, salary you asked for, what to follow up on…"
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
      />
      <Stack direction="row" justifyContent="flex-end" alignItems="center" gap={1.5} sx={{ mt: 1 }}>
        {saveError && (
          <Typography variant="body2" role="alert" sx={{ color: ui.red }}>
            {saveError}
          </Typography>
        )}
        <Button size="small" variant="contained" onClick={onSave} disabled={isSaving}>
          {isSaving ? "Saving…" : "Save note"}
        </Button>
      </Stack>
    </Box>
  );
}

function InterviewBanner({ interview }: { interview: ScheduledInterview }) {
  return (
    <Box sx={calloutSx(ui.green)}>
      <Typography variant="body2" sx={{ color: ui.text }}>
        Interview{" "}
        <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: "0.78rem", color: ui.textMuted, ml: 0.5 }}>
          {formatInterviewTime(interview.scheduledAt)}{" "}
          · {interview.durationMinutes} min
        </Box>
        {interview.notes && (
          <Box component="span" sx={{ color: ui.textMuted }}> · {interview.notes}</Box>
        )}
      </Typography>
    </Box>
  );
}

export function ApplicationCard({ application, onStatusClick }: ApplicationCardProps) {
  const { job, interview } = application;
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const savedNotes = application.notes ?? "";
  const [notes, setNotes] = useState(savedNotes);
  const [lastSeenSavedNotes, setLastSeenSavedNotes] = useState(savedNotes);
  if (savedNotes !== lastSeenSavedNotes) {
    setLastSeenSavedNotes(savedNotes);
    const hasUnsavedEdits = notes !== lastSeenSavedNotes;
    if (!hasUnsavedEdits) setNotes(savedNotes);
  }
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const [isConfirmingAutoApply, setIsConfirmingAutoApply] = useState(false);
  const [shownEvidenceUrl, setShownEvidenceUrl] = useState<string | null>(null);
  const { run, start: startAutoApply } = useAutoApply(application.id);

  const canAutoApply = run.isRunning || AUTO_APPLY_STATUSES.includes(application.status);
  const savedEvidenceUrl = evidenceUrlFor(application);
  const showAppliedEvidence =
    application.status === "APPLIED" && savedEvidenceUrl
      ? () => setShownEvidenceUrl(savedEvidenceUrl)
      : undefined;

  const confirmAutoApply = () => {
    setIsConfirmingAutoApply(false);
    void startAutoApply();
  };

  const saveNotes = async () => {
    setIsSavingNotes(true);
    setNotesSaveError(null);
    try {
      await updateApplicationNotes(application.id, notes);
      setLastSeenSavedNotes(notes);
    } catch {
      setNotesSaveError(NOTES_SAVE_FAILED_MESSAGE);
    } finally {
      setIsSavingNotes(false);
    }
  };

  return (
    <Card>
      <CardContent sx={{ pb: "14px !important" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <JobHeading title={job.title} company={job.company} location={job.location} />
          <Box sx={{ flexShrink: 0, pt: "1px" }}>
            <StatusChip status={run.isRunning ? "APPLYING" : application.status} />
          </Box>
        </Stack>

        <SalaryAndAppliedLine
          salary={job.salary}
          appliedAt={application.appliedAt}
          wasAutoApplied={Boolean(application.appliedVia)}
          onShowEvidence={showAppliedEvidence}
        />

        {job.description && (
          <Typography
            variant="body2"
            sx={{ mt: 1.25, color: ui.textMuted, ...lineClampSx(COLLAPSED_DESCRIPTION_LINES) }}
          >
            {job.description}
          </Typography>
        )}

        {!isNotesOpen && notes && <NotePreview note={notes} />}

        <Collapse in={isNotesOpen}>
          <NotesEditor
            notes={notes}
            isSaving={isSavingNotes}
            saveError={notesSaveError}
            onNotesChange={setNotes}
            onSave={saveNotes}
          />
        </Collapse>

        {interview && <InterviewBanner interview={interview} />}

        <AutoApplyPanel application={application} run={run} onShowEvidence={setShownEvidenceUrl} />

        <Stack
          direction="row"
          alignItems="center"
          sx={{ mt: 1.75, pt: 1.5, borderTop: `1px solid ${ui.line}`, flexWrap: "wrap", gap: 1 }}
        >
          <Button size="small" variant="outlined" onClick={() => onStatusClick(application.id, application.status)}>
            Status
          </Button>

          <Button
            size="small"
            variant="text"
            onClick={() => setIsNotesOpen((isOpen) => !isOpen)}
            sx={isNotesOpen ? { color: ui.text, backgroundColor: ui.hover } : undefined}
          >
            {isNotesOpen ? "Close notes" : "Notes"}
          </Button>

          {canAutoApply && (
            <Button
              size="small"
              variant="outlined"
              disabled={run.isRunning}
              onClick={() => setIsConfirmingAutoApply(true)}
            >
              {run.isRunning ? "Applying…" : "Auto apply"}
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <SourceLinkChip source={job.source} sourceUrl={job.sourceUrl} />
        </Stack>
      </CardContent>

      {isConfirmingAutoApply && (
        <AutoApplyConfirmDialog
          job={job}
          onCancel={() => setIsConfirmingAutoApply(false)}
          onConfirm={confirmAutoApply}
        />
      )}

      {shownEvidenceUrl && (
        <EvidenceDialog
          evidenceUrl={shownEvidenceUrl}
          title={`${job.title} · ${job.company}`}
          onClose={() => setShownEvidenceUrl(null)}
        />
      )}
    </Card>
  );
}
