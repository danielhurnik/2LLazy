"use client";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  CircularProgress,
} from "@mui/material";
import type { CalendarEventForm } from "@/types";

const MIN_DURATION_MINUTES = 5;

interface Props {
  open: boolean;
  form: CalendarEventForm;
  editId: string | null;
  isSaving: boolean;
  onChange: (form: CalendarEventForm) => void;
  onClose: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
}

export function CalendarEventDialog({
  open,
  form,
  editId,
  isSaving,
  onChange,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const isEditing = Boolean(editId);
  const canDelete = isEditing && onDelete !== undefined;
  const isFormIncomplete = !form.title.trim() || !form.scheduledAt;
  const submitLabel = isEditing ? "Save" : "Create";

  const updateForm = (changes: Partial<CalendarEventForm>) => onChange({ ...form, ...changes });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditing ? "Edit Event" : "New Calendar Event"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Title"
            size="small"
            value={form.title}
            onChange={(e) => updateForm({ title: e.target.value })}
            placeholder="e.g. Interview prep, Networking call, HR screening"
            fullWidth
            autoFocus
          />
          <TextField
            label="Date & Time"
            type="datetime-local"
            size="small"
            value={form.scheduledAt}
            onChange={(e) => updateForm({ scheduledAt: e.target.value })}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Duration (minutes)"
            type="number"
            size="small"
            value={form.durationMinutes}
            onChange={(e) => updateForm({ durationMinutes: Number(e.target.value) })}
            inputProps={{ min: MIN_DURATION_MINUTES }}
            fullWidth
          />
          <TextField
            label="Notes"
            size="small"
            multiline
            rows={3}
            value={form.notes}
            onChange={(e) => updateForm({ notes: e.target.value })}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: canDelete ? "space-between" : "flex-end" }}>
        {canDelete && (
          <Button color="error" onClick={onDelete} disabled={isSaving}>
            {isSaving ? <CircularProgress size={14} /> : "Delete"}
          </Button>
        )}
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={onSubmit} disabled={isFormIncomplete || isSaving}>
            {isSaving ? <CircularProgress size={16} /> : submitLabel}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
