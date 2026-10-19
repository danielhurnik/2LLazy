import type { CountryCode } from "@/lib/jobs/sources/types";

export type AppStatus =
  | "PENDING"
  | "APPLYING"
  | "NEEDS_MANUAL"
  | "APPLIED"
  | "REJECTED"
  | "INTERVIEW"
  | "OFFER"
  | "FAILED";

export const ALL_STATUSES: AppStatus[] = [
  "PENDING",
  "APPLYING",
  "NEEDS_MANUAL",
  "APPLIED",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "FAILED",
];

export const STATUS_LABEL: Record<AppStatus, string> = {
  PENDING: "To apply",
  APPLYING: "Applying…",
  NEEDS_MANUAL: "Needs manual",
  APPLIED: "Applied",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  FAILED: "Apply failed",
};

export const AUTO_APPLY_STATUSES: AppStatus[] = ["PENDING", "FAILED", "NEEDS_MANUAL"];

export const MANUAL_STATUSES: AppStatus[] = ALL_STATUSES.filter((status) => status !== "APPLYING");

type StatusColor = "default" | "primary" | "info" | "success" | "error" | "warning";

export const STATUS_COLOR: Record<AppStatus, StatusColor> = {
  PENDING: "default",
  APPLYING: "info",
  NEEDS_MANUAL: "warning",
  APPLIED: "info",
  INTERVIEW: "success",
  OFFER: "primary",
  REJECTED: "error",
  FAILED: "warning",
};

const SOURCE_HOST: Record<string, string> = {
  STARTUPJOBS: "startupjobs.cz",
  JOBSTACK: "jobstack.it",
  COCUMA: "cocuma.cz",
  SKILLETO: "skilleto.cz",
  NOFLUFFJOBS: "nofluffjobs.com",
  JOBSCZ: "jobs.cz",
  JOOBLE: "jooble.org",
};

export function sourceLabel(source: string): string {
  return SOURCE_HOST[source] ?? source.toLowerCase();
}

export interface JobItem {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  source: string;
  salary?: string;
  workType?: string;
  similarity?: number;
  matchReasons?: string[];
  favourited?: boolean;
  isNew?: boolean;
  isStale?: boolean;
}

interface ApplicationInterview {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
}

export interface Application {
  id: string;
  status: AppStatus;
  appliedAt: string | null;
  notes?: string | null;
  errorMessage: string | null;
  appliedVia: string | null;
  evidencePath: string | null;
  job: {
    id: string;
    title: string;
    company: string;
    location: string;
    description: string;
    source: string;
    sourceUrl: string;
    salary: string | null;
  };
  interview: ApplicationInterview | null;
}

export interface Interview {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  timezone: string;
  notes: string | null;
  application: {
    id: string;
    job: { title: string; company: string };
  };
}

interface ScheduledNoteFields {
  scheduledAt: string;
  durationMinutes: number;
  notes: string;
}

export interface ScheduleInterviewForm extends ScheduledNoteFields {
  applicationId: string;
}

export interface CalendarEntry {
  id: string;
  type: "interview" | "event";
  title: string;
  subtitle?: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
}

export interface CalendarEventForm extends ScheduledNoteFields {
  title: string;
}

export interface UploadedFile {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  linkedInUrl: string;
  githubUrl: string;
  country: CountryCode;
  city: string;
  googleCalendarSync: boolean;
}
