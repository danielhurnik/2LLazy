import type { CountryCode } from "@/lib/jobs/sources/types";

export type AppStatus =
  | "PENDING"
  | "APPLYING"
  | "WAITING_FOR_USER"
  | "NEEDS_MANUAL"
  | "APPLIED"
  | "REJECTED"
  | "INTERVIEW"
  | "OFFER"
  | "FAILED";

export const ALL_STATUSES: AppStatus[] = [
  "PENDING",
  "APPLYING",
  "WAITING_FOR_USER",
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
  WAITING_FOR_USER: "Needs you",
  NEEDS_MANUAL: "Needs manual",
  APPLIED: "Applied",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  FAILED: "Apply failed",
};

export const AUTO_APPLY_STATUSES: AppStatus[] = ["PENDING", "FAILED", "NEEDS_MANUAL"];

const AUTOMATION_ONLY_STATUSES: AppStatus[] = ["APPLYING", "WAITING_FOR_USER"];

export const MANUAL_STATUSES: AppStatus[] = ALL_STATUSES.filter((status) => !AUTOMATION_ONLY_STATUSES.includes(status));

type StatusColor = "default" | "primary" | "info" | "success" | "error" | "warning";

export const STATUS_COLOR: Record<AppStatus, StatusColor> = {
  PENDING: "default",
  APPLYING: "info",
  WAITING_FOR_USER: "warning",
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
  ATS: "company careers",
  WEB: "web",
};

export function sourceLabel(source: string): string {
  return SOURCE_HOST[source] ?? source.toLowerCase();
}

export interface CrossListing {
  source: string;
  label: string;
  url: string;
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
  dismissed?: boolean;
  isNew?: boolean;
  isStale?: boolean;
  alsoOn?: CrossListing[];
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
  availableFrom: string;
  expectedSalaryCzk: number | null;
  googleCalendarSync: boolean;
}
