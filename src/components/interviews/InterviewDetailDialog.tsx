"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Chip,
} from "@mui/material";
import type { ChipProps } from "@mui/material";
import dayjs from "dayjs";
import type { CalendarEntry } from "@/types";

const SCHEDULED_AT_FORMAT = "dddd, MMMM D YYYY [at] HH:mm";

const ENTRY_TYPE_CHIP: Record<CalendarEntry["type"], { label: string; color: ChipProps["color"] }> = {
  interview: { label: "Interview", color: "success" },
  event: { label: "Event", color: "primary" },
};

interface Props {
  entry: CalendarEntry | null;
  onClose: () => void;
  onEdit?: (entry: CalendarEntry) => void;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Typography variant="body2">
      <strong>{label}</strong> {children}
    </Typography>
  );
}

export function InterviewDetailDialog({ entry, onClose, onEdit }: Props) {
  if (!entry) return null;

  const typeChip = ENTRY_TYPE_CHIP[entry.type];

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        {entry.title}
        <Chip label={typeChip.label} size="small" color={typeChip.color} sx={{ ml: 1 }} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {entry.subtitle && <DetailRow label="Position:">{entry.subtitle}</DetailRow>}
          <DetailRow label="When:">{dayjs(entry.scheduledAt).format(SCHEDULED_AT_FORMAT)}</DetailRow>
          <DetailRow label="Duration:">{entry.durationMinutes} min</DetailRow>
          {entry.notes && <DetailRow label="Notes:">{entry.notes}</DetailRow>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {entry.type === "event" && onEdit && (
          <Button variant="outlined" onClick={() => onEdit(entry)}>
            Edit
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
