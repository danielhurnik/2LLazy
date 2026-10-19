"use client";

import { useState, useTransition, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, Snackbar, Alert } from "@mui/material";
import { PageHeader } from "@/components/ui/PageHeader";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { InterviewDetailDialog } from "@/components/interviews/InterviewDetailDialog";
import { CalendarEventDialog } from "@/components/interviews/CalendarEventDialog";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarEntriesAction,
} from "@/lib/actions/interviewActions";
import { CalendarMonthNav } from "./CalendarMonthNav";
import { CalendarGrid } from "./CalendarGrid";
import type { CalendarEntry, CalendarEventForm } from "@/types";

const DATETIME_LOCAL_FORMAT = "YYYY-MM-DDTHH:mm";
const TOAST_AUTO_HIDE_MS = 5000;

const DEFAULT_FORM: CalendarEventForm = {
  title: "",
  scheduledAt: dayjs().format(DATETIME_LOCAL_FORMAT),
  durationMinutes: 60,
  notes: "",
};

interface EventDialogState {
  open: boolean;
  editId: string | null;
  form: CalendarEventForm;
}

const CLOSED_EVENT_DIALOG: EventDialogState = { open: false, editId: null, form: DEFAULT_FORM };

interface Toast {
  message: string;
  severity: "success" | "error";
}

type MonthStep = 1 | -1;

interface Props {
  initialEntries: CalendarEntry[];
  month: number;
  year: number;
}

const toOneBasedMonth = (date: Dayjs) => date.month() + 1;

const monthCacheKey = (date: Dayjs) => `${toOneBasedMonth(date)}-${date.year()}`;

const interviewsUrlFor = (date: Dayjs) =>
  `/interviews?month=${toOneBasedMonth(date)}&year=${date.year()}`;

const toEventForm = (entry: CalendarEntry): CalendarEventForm => ({
  title: entry.title,
  scheduledAt: dayjs(entry.scheduledAt).format(DATETIME_LOCAL_FORMAT),
  durationMinutes: entry.durationMinutes,
  notes: entry.notes ?? "",
});

function describeMonth(entryCount: number, monthName: string) {
  if (entryCount === 0) {
    return `Nothing scheduled in ${monthName} · double-click a day to add something`;
  }
  return `${entryCount} scheduled in ${monthName}`;
}

export function InterviewsClient({ initialEntries, month, year }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isNavigating, setIsNavigating] = useState(false);

  const [initialMonth] = useState(() => dayjs(new Date(year, month - 1, 1)));
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [entries, setEntries] = useState<CalendarEntry[]>(initialEntries);

  const entriesCache = useRef<Map<string, CalendarEntry[]>>(new Map());

  const fetchMonthEntries = useCallback(async (target: Dayjs) => {
    const monthEntries = await fetchCalendarEntriesAction(toOneBasedMonth(target), target.year());
    entriesCache.current.set(monthCacheKey(target), monthEntries);
    return monthEntries;
  }, []);

  const prefetch = useCallback(
    (target: Dayjs) => {
      if (entriesCache.current.has(monthCacheKey(target))) return;
      fetchMonthEntries(target);
    },
    [fetchMonthEntries],
  );

  useEffect(() => {
    prefetch(initialMonth.subtract(1, "month"));
    prefetch(initialMonth.add(1, "month"));
  }, [initialMonth, prefetch]);

  const showMonth = (target: Dayjs, monthEntries: CalendarEntry[]) => {
    setCurrentMonth(target);
    setEntries(monthEntries);
  };

  const fetchAndShowMonth = async (target: Dayjs) => {
    try {
      showMonth(target, await fetchMonthEntries(target));
    } catch {
      router.push(interviewsUrlFor(target));
    } finally {
      setIsNavigating(false);
    }
  };

  const navigateMonth = async (step: MonthStep) => {
    const target = currentMonth.add(step, "month");
    setIsNavigating(true);

    const cachedEntries = entriesCache.current.get(monthCacheKey(target));
    if (cachedEntries) {
      showMonth(target, cachedEntries);
      setIsNavigating(false);
    } else {
      await fetchAndShowMonth(target);
    }

    window.history.replaceState(null, "", interviewsUrlFor(target));
    prefetch(target.add(step, "month"));
  };

  const refreshCurrentMonth = () => {
    entriesCache.current.delete(monthCacheKey(currentMonth));
    fetchMonthEntries(currentMonth).then(setEntries);
  };

  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);
  const [eventDialog, setEventDialog] = useState<EventDialogState>(CLOSED_EVENT_DIALOG);
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const openCreateDialog = (scheduledAt: string = dayjs().format(DATETIME_LOCAL_FORMAT)) => {
    setEventDialog({ open: true, editId: null, form: { ...DEFAULT_FORM, scheduledAt } });
  };

  const openEditDialog = (entry: CalendarEntry) => {
    setSelectedEntry(null);
    setEventDialog({ open: true, editId: entry.id, form: toEventForm(entry) });
  };

  const closeEventDialog = () => setEventDialog(CLOSED_EVENT_DIALOG);

  const runEventMutation = (mutate: () => Promise<void>, successMessage: string) => {
    setIsSaving(true);
    startTransition(async () => {
      try {
        await mutate();
        setToast({ message: successMessage, severity: "success" });
        closeEventDialog();
        refreshCurrentMonth();
      } catch (err) {
        setToast({ message: String(err), severity: "error" });
      } finally {
        setIsSaving(false);
      }
    });
  };

  const handleSaveEvent = () => {
    const { editId, form } = eventDialog;
    if (editId) {
      runEventMutation(() => updateCalendarEvent(editId, form), "Event updated.");
    } else {
      runEventMutation(() => createCalendarEvent(form), "Event created.");
    }
  };

  const handleDeleteEvent = () => {
    const { editId } = eventDialog;
    if (!editId) return;
    runEventMutation(() => deleteCalendarEvent(editId), "Event deleted.");
  };

  const closeToast = () => setToast(null);

  return (
    <Box>
      <PageHeader
        title="Interviews"
        meta={describeMonth(entries.length, currentMonth.format("MMMM"))}
        actions={
          <>
            <CalendarMonthNav
              currentMonth={currentMonth}
              isPending={isNavigating}
              onPrev={() => navigateMonth(-1)}
              onNext={() => navigateMonth(1)}
            />
            <Button variant="contained" onClick={() => openCreateDialog()} sx={{ ml: 1 }}>
              Add event
            </Button>
          </>
        }
      />

      <CalendarGrid
        currentMonth={currentMonth}
        entries={entries}
        onEntryClick={setSelectedEntry}
        onDayDoubleClick={openCreateDialog}
      />

      <InterviewDetailDialog
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        onEdit={openEditDialog}
      />

      <CalendarEventDialog
        open={eventDialog.open}
        form={eventDialog.form}
        editId={eventDialog.editId}
        isSaving={isSaving}
        onChange={(form) => setEventDialog((prev) => ({ ...prev, form }))}
        onClose={closeEventDialog}
        onSubmit={handleSaveEvent}
        onDelete={eventDialog.editId ? handleDeleteEvent : undefined}
      />

      <Snackbar
        open={!!toast}
        autoHideDuration={TOAST_AUTO_HIDE_MS}
        onClose={closeToast}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert severity={toast?.severity} onClose={closeToast} sx={{ width: "100%" }}>
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
