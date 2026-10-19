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
import { errorMessage } from "@/lib/guards";

const DATETIME_LOCAL_FORMAT = "YYYY-MM-DDTHH:mm";
const TOAST_AUTO_HIDE_MS = 5000;
const REFRESH_FAILED_MESSAGE = "Saved, but the calendar could not be refreshed. Reload the page.";

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

interface DisplayedMonth {
  month: Dayjs;
  entries: CalendarEntry[];
}

type MonthStep = 1 | -1;

interface Props {
  initialEntries: CalendarEntry[];
  month: number;
  year: number;
  followsLocalToday: boolean;
}

const prefetchIsBestEffort = () => {};

const startOfMonth = (month: number, year: number) => dayjs(new Date(year, month - 1, 1));

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

function withLocalTimeAsInstant(form: CalendarEventForm): CalendarEventForm {
  const localTime = dayjs(form.scheduledAt);
  return localTime.isValid() ? { ...form, scheduledAt: localTime.toISOString() } : form;
}

const entriesWithinMonth = ({ month, entries }: DisplayedMonth) =>
  entries.filter((entry) => dayjs(entry.scheduledAt).isSame(month, "month"));

function describeMonth(entryCount: number, monthName: string) {
  if (entryCount === 0) {
    return `Nothing scheduled in ${monthName} · double-click a day to add something`;
  }
  return `${entryCount} scheduled in ${monthName}`;
}

export function InterviewsClient({ initialEntries, month, year, followsLocalToday }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isNavigating, setIsNavigating] = useState(false);

  const [displayed, setDisplayed] = useState<DisplayedMonth>(() => ({
    month: startOfMonth(month, year),
    entries: initialEntries,
  }));
  const [entriesFromServer, setEntriesFromServer] = useState(initialEntries);
  if (initialEntries !== entriesFromServer) {
    setEntriesFromServer(initialEntries);
    setDisplayed({ month: startOfMonth(month, year), entries: initialEntries });
  }

  const entriesCache = useRef<Map<string, CalendarEntry[]>>(new Map());
  const latestNavigation = useRef(0);

  const fetchMonthEntries = useCallback(async (target: Dayjs) => {
    const monthEntries = await fetchCalendarEntriesAction(toOneBasedMonth(target), target.year());
    entriesCache.current.set(monthCacheKey(target), monthEntries);
    return monthEntries;
  }, []);

  const prefetch = useCallback(
    (target: Dayjs) => {
      if (entriesCache.current.has(monthCacheKey(target))) return;
      fetchMonthEntries(target).catch(prefetchIsBestEffort);
    },
    [fetchMonthEntries],
  );

  const showMonth = useCallback(
    async (target: Dayjs) => {
      const navigation = ++latestNavigation.current;
      const isLatestNavigation = () => navigation === latestNavigation.current;
      const cachedEntries = entriesCache.current.get(monthCacheKey(target));
      if (cachedEntries) {
        setDisplayed({ month: target, entries: cachedEntries });
      } else {
        setIsNavigating(true);
        try {
          const monthEntries = await fetchMonthEntries(target);
          if (isLatestNavigation()) setDisplayed({ month: target, entries: monthEntries });
        } catch {
          router.push(interviewsUrlFor(target));
          return;
        } finally {
          if (isLatestNavigation()) setIsNavigating(false);
        }
      }
      if (isLatestNavigation()) window.history.replaceState(null, "", interviewsUrlFor(target));
    },
    [fetchMonthEntries, router],
  );

  const shownMonth = displayed.month;
  useEffect(() => {
    prefetch(shownMonth.subtract(1, "month"));
    prefetch(shownMonth.add(1, "month"));
  }, [shownMonth, prefetch]);

  useEffect(() => {
    if (!followsLocalToday) return;
    const localMonth = dayjs().startOf("month");
    if (!localMonth.isSame(startOfMonth(month, year), "month")) void showMonth(localMonth);
  }, [followsLocalToday, month, year, showMonth]);

  const navigateMonth = (step: MonthStep) => showMonth(displayed.month.add(step, "month"));

  const refreshAfterChange = async (target: Dayjs) => {
    entriesCache.current.clear();
    const monthEntries = await fetchMonthEntries(target);
    setDisplayed((current) =>
      current.month.isSame(target, "month") ? { month: current.month, entries: monthEntries } : current,
    );
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
    const monthToRefresh = displayed.month;
    setIsSaving(true);
    startTransition(async () => {
      try {
        await mutate();
      } catch (err) {
        setToast({ message: errorMessage(err), severity: "error" });
        setIsSaving(false);
        return;
      }
      setToast({ message: successMessage, severity: "success" });
      closeEventDialog();
      setIsSaving(false);
      await refreshAfterChange(monthToRefresh).catch(() =>
        setToast({ message: REFRESH_FAILED_MESSAGE, severity: "error" }),
      );
    });
  };

  const handleSaveEvent = () => {
    const { editId } = eventDialog;
    const form = withLocalTimeAsInstant(eventDialog.form);
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
  const monthEntries = entriesWithinMonth(displayed);

  return (
    <Box>
      <PageHeader
        title="Interviews"
        meta={describeMonth(monthEntries.length, displayed.month.format("MMMM"))}
        actions={
          <>
            <CalendarMonthNav
              currentMonth={displayed.month}
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
        currentMonth={displayed.month}
        entries={monthEntries}
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
