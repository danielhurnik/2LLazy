"use client";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
} from "@mui/material";
import type { AppStatus } from "@/types";
import { ALL_STATUSES, MANUAL_STATUSES, STATUS_LABEL } from "@/types";
import { statusTone } from "@/components/ui/StatusChip";

interface StatusChangeDialogProps {
  open: boolean;
  status: AppStatus;
  isSaving?: boolean;
  onStatusChange: (status: AppStatus) => void;
  onClose: () => void;
  onSave: () => void;
}

const findAppStatus = (value: string): AppStatus | undefined =>
  ALL_STATUSES.find((status) => status === value);

const selectableStatuses = (current: AppStatus): AppStatus[] =>
  ALL_STATUSES.filter((status) => status === current || MANUAL_STATUSES.includes(status));

export function StatusChangeDialog({
  open,
  status,
  isSaving,
  onStatusChange,
  onClose,
  onSave,
}: StatusChangeDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Change status</DialogTitle>
      <DialogContent sx={{ pt: "8px !important" }}>
        <FormControl fullWidth size="small">
          <InputLabel>Status</InputLabel>
          <Select
            value={status}
            label="Status"
            onChange={(event) => {
              const selectedStatus = findAppStatus(event.target.value);
              if (selectedStatus) onStatusChange(selectedStatus);
            }}
          >
            {selectableStatuses(status).map((statusOption) => (
              <MenuItem key={statusOption} value={statusOption} sx={{ gap: 1.25 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: statusTone(statusOption), flexShrink: 0 }} />
                {STATUS_LABEL[statusOption]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={isSaving} onClick={onSave}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
