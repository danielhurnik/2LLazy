"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  Chip,
  Button,
  IconButton,
  Tooltip,
  alpha,
  TextField,
  Collapse,
  CircularProgress,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import EditIcon from "@mui/icons-material/Edit";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import NotesIcon from "@mui/icons-material/Notes";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import type { Application, AppStatus } from "@/types";
import { STATUS_COLOR, SOURCE_COLOR } from "@/types";
import { CvAdjustDialog } from "@/components/dialogs/CvAdjustDialog";
import { updateApplicationNotes } from "@/lib/actions/applicationActions";
import { ios } from "@/theme/theme";

interface ApplicationCardProps {
  application: Application;
  onStatusClick: (id: string, status: AppStatus) => void;
  onViewCoverLetter: (content: string, coverId: string) => void;
  onGenerateCoverLetter: (jobId: string, jobTitle: string) => void;
}

export function ApplicationCard({
  application: app,
  onStatusClick,
  onViewCoverLetter,
  onGenerateCoverLetter,
}: ApplicationCardProps) {
  const router = useRouter();
  const [cvAdjustOpen, setCvAdjustOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState(app.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [autoApplying, setAutoApplying] = useState(false);
  const [autoApplyError, setAutoApplyError] = useState<string | null>(null);
  const [manualRequired, setManualRequired] = useState(false);

  const handleAutoApply = async () => {
    setAutoApplying(true);
    setAutoApplyError(null);
    setManualRequired(false);
    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: app.id }),
      });
      const data = await res.json() as { error?: string; status?: string };
      if (!res.ok) throw new Error(data.error ?? "Auto-apply failed");
      if (data.status === "MANUAL_REQUIRED") {
        setManualRequired(true);
        window.open(app.job.sourceUrl, "_blank", "noopener,noreferrer");
      } else {
        router.refresh();
      }
    } catch (err) {
      setAutoApplyError(String(err));
    } finally {
      setAutoApplying(false);
    }
  };

  const handleSaveNotes = async () => {
    setSaving(true);
    try {
      await updateApplicationNotes(app.id, notes);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardContent sx={{ pb: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1.5}>
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography
                variant="h6"
                sx={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  lineHeight: 1.35,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {app.job.title}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {app.job.company}
                {app.job.location && (
                  <Box component="span" sx={{ color: ios.label3, mx: 0.5 }}>·</Box>
                )}
                {app.job.location}
              </Typography>
              {app.appliedAt && (
                <Typography variant="caption" sx={{ color: ios.label3, display: "block", mt: 0.5 }}>
                  Applied {new Date(app.appliedAt).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </Typography>
              )}
            </Box>

            <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
              <Chip label={app.status} size="small" color={STATUS_COLOR[app.status]} />
              <Chip label={app.job.source} size="small" color={SOURCE_COLOR[app.job.source] ?? "default"} variant="filled" />
            </Stack>
          </Stack>

          {app.job.description && (
            <Typography
              variant="body2"
              sx={{
                mt: 1.25,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.55,
                fontSize: "0.8125rem",
                color: ios.label2,
              }}
            >
              {app.job.description}
            </Typography>
          )}

          {/* Notes preview when panel is closed */}
          {!notesOpen && notes && (
            <Typography
              variant="caption"
              sx={{
                mt: 1,
                display: "block",
                color: ios.label3,
                fontStyle: "italic",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              📝 {notes}
            </Typography>
          )}

          {/* Notes collapsible panel */}
          <Collapse in={notesOpen}>
            <Box sx={{ mt: 1.5 }}>
              <TextField
                multiline
                minRows={2}
                maxRows={5}
                fullWidth
                size="small"
                placeholder="Add notes about this application…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleSaveNotes}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </Stack>
            </Box>
          </Collapse>

          {app.interview && (
            <Box
              sx={{
                mt: 1.5,
                p: 1.25,
                background: alpha(ios.green, 0.12),
                border: `1px solid ${alpha(ios.green, 0.25)}`,
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <CalendarMonthIcon sx={{ fontSize: 14, color: ios.green, flexShrink: 0 }} />
              <Typography variant="caption" sx={{ color: ios.green, fontWeight: 500, lineHeight: 1.4 }}>
                Interview: {new Date(app.interview.scheduledAt).toLocaleString("en-GB", {
                  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                })} · {app.interview.durationMinutes} min
                {app.interview.notes ? ` — ${app.interview.notes}` : ""}
              </Typography>
            </Box>
          )}
        </CardContent>

        {/* Separator */}
        <Box sx={{ mx: 2, height: "1px", background: ios.separator }} />

        <Stack direction="row" spacing={0.75} sx={{ px: 2, py: 1.25, flexWrap: "wrap" }}>
          {app.status === "PENDING" && (
            <Tooltip title="Automatically fill and submit this application">
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={autoApplying ? <CircularProgress size={13} color="inherit" /> : <RocketLaunchIcon fontSize="small" />}
                onClick={handleAutoApply}
                disabled={autoApplying}
                sx={{ "&.Mui-disabled": { opacity: 0.5 } }}
              >
                {autoApplying ? "Applying…" : "Auto Apply"}
              </Button>
            </Tooltip>
          )}

          <Tooltip title="Change status">
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon fontSize="small" />}
              onClick={() => onStatusClick(app.id, app.status)}
            >
              Status
            </Button>
          </Tooltip>

          <Tooltip title="Tailor your CV for this position">
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<AutoAwesomeIcon fontSize="small" />}
              onClick={() => setCvAdjustOpen(true)}
            >
              Adjust CV
            </Button>
          </Tooltip>

          {app.coverLetter ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => onViewCoverLetter(app.coverLetter!.content, app.coverLetter!.id)}
            >
              Cover Letter
            </Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoAwesomeIcon fontSize="small" />}
              onClick={() => onGenerateCoverLetter(app.job.id, app.job.title)}
            >
              Generate Cover Letter
            </Button>
          )}

          <Tooltip title={notesOpen ? "Close notes" : "Add/view notes"}>
            <Button
              size="small"
              variant={notesOpen ? "contained" : "outlined"}
              startIcon={<NotesIcon fontSize="small" />}
              onClick={() => setNotesOpen((v) => !v)}
              sx={notesOpen ? {
                background: ios.surface2,
                color: ios.label1,
                borderColor: ios.separatorOpaque,
                "&:hover": { background: ios.separator },
              } : undefined}
            >
              Notes
            </Button>
          </Tooltip>

          <Tooltip title="Open job posting">
            <IconButton
              size="small"
              component="a"
              href={app.job.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ ml: "auto", color: ios.label2, "&:hover": { color: ios.label1 } }}
            >
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>

        {manualRequired && (
          <Box
            sx={{
              mx: 2,
              mb: 1.5,
              p: 1.25,
              background: alpha(ios.orange, 0.1),
              border: `1px solid ${alpha(ios.orange, 0.3)}`,
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Typography variant="caption" sx={{ color: ios.orange, lineHeight: 1.4 }}>
              Auto-apply couldn&apos;t complete — the form needs manual input. The job page has been opened for you.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              sx={{ flexShrink: 0, borderColor: ios.orange, color: ios.orange, "&:hover": { background: alpha(ios.orange, 0.1) } }}
              onClick={() => window.open(app.job.sourceUrl, "_blank", "noopener,noreferrer")}
            >
              Open Again
            </Button>
          </Box>
        )}

        {autoApplyError && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Typography variant="caption" sx={{ color: ios.red }}>
              {autoApplyError}
            </Typography>
          </Box>
        )}
      </Card>

      <CvAdjustDialog
        jobId={app.job.id}
        jobTitle={app.job.title}
        open={cvAdjustOpen}
        onClose={() => setCvAdjustOpen(false)}
      />
    </>
  );
}
