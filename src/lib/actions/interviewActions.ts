"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { CalendarEntry, CalendarEventForm } from "@/types";
import { getCalendarEntriesForMonth, interviewTag } from "@/lib/data/interviews";
import { requireUserId } from "@/lib/auth/sessionManager";
import {
  hasCalendarSync,
  createGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  buildGCalPayload,
} from "@/lib/googleCalendar";

const MIN_EVENT_MINUTES = 5;
const MAX_EVENT_MINUTES = 24 * 60;
const FIRST_MONTH = 1;
const LAST_MONTH = 12;

type GCalPayload = ReturnType<typeof buildGCalPayload>;

interface CalendarEventDetails {
  title: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes: string | null;
}

function revalidateCalendar(userId: string): void {
  updateTag(interviewTag(userId));
  revalidatePath("/interviews");
}

function parseScheduledAt(value: string): Date {
  const scheduledAt = new Date(value);
  if (Number.isNaN(scheduledAt.getTime())) throw new Error("Choose a valid date and time.");
  return scheduledAt;
}

function clampDurationMinutes(requested: number): number {
  if (!Number.isFinite(requested)) throw new Error("Duration must be a number of minutes.");
  return Math.min(MAX_EVENT_MINUTES, Math.max(MIN_EVENT_MINUTES, Math.round(requested)));
}

function assertCalendarMonth(month: number, year: number): void {
  const isValidMonth = Number.isInteger(month) && month >= FIRST_MONTH && month <= LAST_MONTH;
  if (!isValidMonth || !Number.isInteger(year)) throw new Error("Invalid calendar month.");
}

function parseCalendarEventForm(form: CalendarEventForm): CalendarEventDetails {
  const title = form.title.trim();
  if (!title) throw new Error("Event title is required.");
  return {
    title,
    scheduledAt: parseScheduledAt(form.scheduledAt),
    durationMinutes: clampDurationMinutes(form.durationMinutes),
    notes: form.notes.trim() || null,
  };
}

function toGCalPayload({ title, scheduledAt, durationMinutes, notes }: CalendarEventDetails): GCalPayload {
  return buildGCalPayload(title, scheduledAt, durationMinutes, notes);
}

export async function fetchCalendarEntriesAction(month: number, year: number): Promise<CalendarEntry[]> {
  const userId = await requireUserId();
  assertCalendarMonth(month, year);
  return getCalendarEntriesForMonth(userId, month, year);
}

export async function createCalendarEvent(form: CalendarEventForm): Promise<void> {
  const userId = await requireUserId();
  const details = parseCalendarEventForm(form);
  const event = await prisma.calendarEvent.create({ data: { userId, ...details } });

  if (await hasCalendarSync(userId)) {
    const googleCalendarEventId = await createGCalEvent(userId, toGCalPayload(details));
    if (googleCalendarEventId) {
      await prisma.calendarEvent.update({ where: { id: event.id }, data: { googleCalendarEventId } });
    }
  }

  revalidateCalendar(userId);
}

export async function updateCalendarEvent(id: string, form: CalendarEventForm): Promise<void> {
  const userId = await requireUserId();
  const details = parseCalendarEventForm(form);
  const event = await prisma.calendarEvent.update({ where: { id, userId }, data: details });

  if (event.googleCalendarEventId && (await hasCalendarSync(userId))) {
    await updateGCalEvent(userId, event.googleCalendarEventId, toGCalPayload(details));
  }

  revalidateCalendar(userId);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const userId = await requireUserId();
  const event = await prisma.calendarEvent.delete({
    where: { id, userId },
    select: { googleCalendarEventId: true },
  });

  if (event.googleCalendarEventId && (await hasCalendarSync(userId))) {
    await deleteGCalEvent(userId, event.googleCalendarEventId);
  }

  revalidateCalendar(userId);
}
