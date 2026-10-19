"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { CalendarEntry, CalendarEventForm, ScheduleInterviewForm } from "@/types";
import { getCalendarEntriesForMonth, interviewTag } from "@/lib/data/interviews";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";
import {
  hasCalendarSync,
  createGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  buildGCalPayload,
} from "@/lib/googleCalendar";

const INTERVIEW_TIMEZONE = "UTC";
const FALLBACK_INTERVIEW_SUMMARY = "Job Interview";
const MIN_CALENDAR_EVENT_MINUTES = 5;

type GCalPayload = ReturnType<typeof buildGCalPayload>;

interface CalendarEventDetails {
  title: string;
  scheduledAt: Date;
  requestedDurationMinutes: number;
  notes: string | null;
}

function revalidateCalendar(userId: string): void {
  updateTag(interviewTag(userId));
  revalidatePath("/interviews");
}

function revalidateApplications(userId: string): void {
  updateTag(applicationTag(userId));
  revalidatePath("/dashboard");
}

async function createLinkedGCalEvent(
  userId: string,
  payload: GCalPayload,
  saveGCalEventId: (googleCalendarEventId: string) => Promise<unknown>,
): Promise<void> {
  const googleCalendarEventId = await createGCalEvent(userId, payload);
  if (googleCalendarEventId) await saveGCalEventId(googleCalendarEventId);
}

async function findInterviewGCalEventId(applicationId: string): Promise<string | null> {
  const interview = await prisma.interview.findUnique({
    where: { applicationId },
    select: { googleCalendarEventId: true },
  });
  return interview?.googleCalendarEventId ?? null;
}

async function buildInterviewSummary(applicationId: string): Promise<string> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { job: { select: { title: true, company: true } } },
  });
  if (!application) return FALLBACK_INTERVIEW_SUMMARY;
  return `Interview – ${application.job.title} @ ${application.job.company}`;
}

async function syncInterviewWithGoogleCalendar(
  userId: string,
  interviewId: string,
  previousGCalEventId: string | null,
  payload: GCalPayload,
): Promise<void> {
  if (previousGCalEventId) {
    await updateGCalEvent(userId, previousGCalEventId, payload);
    return;
  }
  await createLinkedGCalEvent(userId, payload, (googleCalendarEventId) =>
    prisma.interview.update({ where: { id: interviewId }, data: { googleCalendarEventId } }),
  );
}

function parseCalendarEventForm(form: CalendarEventForm): CalendarEventDetails {
  const title = form.title.trim();
  if (!title) throw new Error("Event title is required.");
  return {
    title,
    scheduledAt: new Date(form.scheduledAt),
    requestedDurationMinutes: form.durationMinutes,
    notes: form.notes.trim() || null,
  };
}

function toCalendarEventRecord(details: CalendarEventDetails) {
  return {
    title: details.title,
    scheduledAt: details.scheduledAt,
    durationMinutes: Math.max(MIN_CALENDAR_EVENT_MINUTES, details.requestedDurationMinutes),
    notes: details.notes,
  };
}

function toCalendarEventGCalPayload(details: CalendarEventDetails): GCalPayload {
  return buildGCalPayload(
    details.title,
    details.scheduledAt,
    details.requestedDurationMinutes,
    details.notes,
  );
}

export async function fetchCalendarEntriesAction(
  month: number,
  year: number,
): Promise<CalendarEntry[]> {
  const userId = await requireUserId();
  return getCalendarEntriesForMonth(userId, month, year);
}

export async function scheduleInterview(
  form: ScheduleInterviewForm,
): Promise<void> {
  const userId = await requireUserId();
  const scheduledAt = new Date(form.scheduledAt);
  const notes = form.notes || null;

  const previousGCalEventId = await findInterviewGCalEventId(form.applicationId);

  const [, interview] = await prisma.$transaction([
    prisma.application.update({
      where: { id: form.applicationId, userId },
      data: { status: "INTERVIEW" },
    }),
    prisma.interview.upsert({
      where: { applicationId: form.applicationId },
      create: {
        applicationId: form.applicationId,
        scheduledAt,
        durationMinutes: form.durationMinutes,
        timezone: INTERVIEW_TIMEZONE,
        notes,
      },
      update: {
        scheduledAt,
        durationMinutes: form.durationMinutes,
        notes,
      },
    }),
  ]);

  if (await hasCalendarSync(userId)) {
    const payload = buildGCalPayload(
      await buildInterviewSummary(form.applicationId),
      scheduledAt,
      form.durationMinutes,
      notes,
      INTERVIEW_TIMEZONE,
    );
    await syncInterviewWithGoogleCalendar(userId, interview.id, previousGCalEventId, payload);
  }

  revalidateCalendar(userId);
  revalidateApplications(userId);
}

export async function createCalendarEvent(form: CalendarEventForm): Promise<void> {
  const userId = await requireUserId();
  const details = parseCalendarEventForm(form);
  const event = await prisma.calendarEvent.create({
    data: { userId, ...toCalendarEventRecord(details) },
  });

  if (await hasCalendarSync(userId)) {
    await createLinkedGCalEvent(userId, toCalendarEventGCalPayload(details), (googleCalendarEventId) =>
      prisma.calendarEvent.update({ where: { id: event.id }, data: { googleCalendarEventId } }),
    );
  }

  revalidateCalendar(userId);
}

export async function updateCalendarEvent(id: string, form: CalendarEventForm): Promise<void> {
  const userId = await requireUserId();
  const details = parseCalendarEventForm(form);
  const event = await prisma.calendarEvent.update({
    where: { id, userId },
    data: toCalendarEventRecord(details),
  });

  if (event.googleCalendarEventId && (await hasCalendarSync(userId))) {
    await updateGCalEvent(userId, event.googleCalendarEventId, toCalendarEventGCalPayload(details));
  }

  revalidateCalendar(userId);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const userId = await requireUserId();
  const event = await prisma.calendarEvent.findUnique({
    where: { id, userId },
    select: { googleCalendarEventId: true },
  });
  await prisma.calendarEvent.delete({ where: { id, userId } });

  if (event?.googleCalendarEventId && (await hasCalendarSync(userId))) {
    await deleteGCalEvent(userId, event.googleCalendarEventId);
  }

  revalidateCalendar(userId);
}
