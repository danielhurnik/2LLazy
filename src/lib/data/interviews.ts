import { unstable_cache } from "next/cache";
import type { CalendarEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CalendarEntry } from "@/types";
import { MS_PER_DAY } from "@/lib/time";

const INTERVIEWS_TAG = "interviews";
export const interviewTag = (userId: string) => `${INTERVIEWS_TAG}:${userId}`;

const CALENDAR_CACHE_SECONDS = 60;
const PADDING_COVERING_EVERY_UTC_OFFSET_MS = MS_PER_DAY;

const INTERVIEW_INCLUDE = {
  application: { include: { job: true } },
} satisfies Prisma.InterviewInclude;

type InterviewWithJob = Prisma.InterviewGetPayload<{ include: typeof INTERVIEW_INCLUDE }>;

function monthWindowInEveryTimezone(month: number, year: number) {
  const monthStartUtc = Date.UTC(year, month - 1, 1);
  const nextMonthStartUtc = Date.UTC(year, month, 1);
  return {
    gte: new Date(monthStartUtc - PADDING_COVERING_EVERY_UTC_OFFSET_MS),
    lt: new Date(nextMonthStartUtc + PADDING_COVERING_EVERY_UTC_OFFSET_MS),
  } satisfies Prisma.DateTimeFilter;
}

function toInterviewEntry(interview: InterviewWithJob): CalendarEntry {
  return {
    id: interview.id,
    type: "interview",
    title: interview.application.job.company,
    subtitle: interview.application.job.title,
    scheduledAt: interview.scheduledAt.toISOString(),
    durationMinutes: interview.durationMinutes,
    notes: interview.notes,
  };
}

function toEventEntry(event: CalendarEvent): CalendarEntry {
  return {
    id: event.id,
    type: "event",
    title: event.title,
    scheduledAt: event.scheduledAt.toISOString(),
    durationMinutes: event.durationMinutes,
    notes: event.notes,
  };
}

const byScheduledAt = (a: CalendarEntry, b: CalendarEntry) =>
  new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();

async function findCalendarEntriesForMonth(
  userId: string,
  month: number,
  year: number,
): Promise<CalendarEntry[]> {
  const scheduledAt = monthWindowInEveryTimezone(month, year);

  const [interviews, events] = await Promise.all([
    prisma.interview.findMany({
      where: { scheduledAt, application: { userId } },
      include: INTERVIEW_INCLUDE,
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.calendarEvent.findMany({
      where: { userId, scheduledAt },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);

  return [...interviews.map(toInterviewEntry), ...events.map(toEventEntry)].sort(byScheduledAt);
}

export function getCalendarEntriesForMonth(userId: string, month: number, year: number) {
  return unstable_cache(
    () => findCalendarEntriesForMonth(userId, month, year),
    ["get-calendar-entries", userId, String(month), String(year)],
    { revalidate: CALENDAR_CACHE_SECONDS, tags: [interviewTag(userId)] },
  )();
}
