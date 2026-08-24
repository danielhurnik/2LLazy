/**
 * Shared UI types used across pages and components.
 * Keep separate from src/lib/scrapers/types.ts (backend scraper types).
 */

export type AppStatus = "PENDING" | "APPLIED" | "REJECTED" | "INTERVIEW" | "OFFER" | "FAILED";

export const ALL_STATUSES: AppStatus[] = [
  "PENDING",
  "APPLIED",
  "REJECTED",
  "INTERVIEW",
  "OFFER",
  "FAILED",
];

export const STATUS_COLOR: Record<
  AppStatus,
  "default" | "info" | "success" | "error" | "warning"
> = {
  PENDING: "default",
  APPLIED: "info",
  REJECTED: "error",
  INTERVIEW: "success",
  OFFER: "success",
  FAILED: "warning",
};

export type SourceChipColor =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "info"
  | "error"
  | "default";

/**
 * Chip colours for known board ids. Boards are free-form strings (a new board
 * never needs a migration), so this map is a hint, not an exhaustive list —
 * use {@link sourceColor} to colour an arbitrary source.
 */
export const SOURCE_COLOR: Record<string, SourceChipColor> = {
  // Czech / Slovak boards
  STARTUPJOBS: "success",
  JOBSTACK: "warning",
  COCUMA: "info",
  SKILLETO: "secondary",
  NOFLUFFJOBS: "primary",
  JOBSCZ: "error",
  JOOBLE: "warning",
  // Worldwide remote boards
  REMOTIVE: "info",
  REMOTEOK: "secondary",
  ARBEITNOW: "primary",
  JOBICY: "success",
  HIMALAYAS: "warning",
  WEWORKREMOTELY: "error",
  // Aggregators
  ADZUNA: "primary",
  INDEED: "info",
};

/** Palette used when a board id is not in {@link SOURCE_COLOR}. */
const FALLBACK_SOURCE_COLORS: SourceChipColor[] = [
  "primary",
  "secondary",
  "success",
  "warning",
  "info",
  "error",
];

/**
 * Chip colour for any board id.
 *
 * Unknown boards get a colour derived from the id itself rather than a flat
 * "default" grey, so a newly added board is still visually distinguishable and
 * keeps the same colour on every render and every device.
 */
export function sourceColor(source: string): SourceChipColor {
  const known = SOURCE_COLOR[source];
  if (known) return known;
  if (!source) return "default";
  // djb2-ish rolling hash — stable across sessions, no dependency on Map order.
  let hash = 5381;
  for (let i = 0; i < source.length; i++) hash = ((hash << 5) + hash + source.charCodeAt(i)) >>> 0;
  return FALLBACK_SOURCE_COLORS[hash % FALLBACK_SOURCE_COLORS.length];
}

/** Unified job item used in search results and favourites. */
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
  /** ISO 3166-1 alpha-2 country the posting belongs to, when known. */
  country?: string;
  /** Lexical relevance of the posting to the query, 0–1. Search results only. */
  score?: number;
  /** Query terms actually found in the posting, e.g. `["react", "typescript"]`. */
  matched?: string[];
  /** Short human-readable explanations of the score, e.g. "title matches react". */
  reasons?: string[];
  /**
   * @deprecated Legacy cosine-similarity score. Kept so cached search sessions
   * and not-yet-migrated callers keep rendering; read {@link JobItem.score}.
   */
  similarity?: number;
  favourited?: boolean;
  /** Latest generated cover letter for this job, if any. */
  coverLetter?: { id: string; content: string } | null;
  /** True if the job was first seen in the DB within the last 24 hours. */
  isNew?: boolean;
  /** True if the job was returned from the DB cache, not freshly scraped in this run. */
  isStale?: boolean;
}

/** Relevance of a job, preferring the lexical score and falling back to the legacy field. */
export function jobScore(job: JobItem): number {
  return job.score ?? job.similarity ?? 0;
}

export interface ApplicationInterview {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
}

export interface Application {
  id: string;
  status: AppStatus;
  appliedAt: string | null;
  errorMessage: string | null;
  notes?: string | null;
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
  coverLetter: { id: string; content: string } | null;
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

export interface ScheduleInterviewForm {
  applicationId: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string;
}

/** Unified display entry for the calendar — covers linked interviews and free-form events. */
export interface CalendarEntry {
  id: string;
  type: "interview" | "event";
  /** For event: user-supplied title. For interview: company name. */
  title: string;
  /** For interview: job title. Undefined for events. */
  subtitle?: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string | null;
}

export interface CalendarEventForm {
  title: string;
  scheduledAt: string;
  durationMinutes: number;
  notes: string;
}

// ─── Settings types ───────────────────────────────────────────────────────────

export interface SiteCredStatus {
  site: string;
  configured: boolean;
  username: string | null;
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
  coverLetterLanguage: string;
  googleCalendarSync: boolean;
  /** ISO 3166-1 alpha-2 country used to pick job boards. */
  country: string;
  /** Preferred way of working; "" means no preference. */
  preferredWorkType: string;
  /** Only search remote-first boards / remote roles. */
  remoteOnly: boolean;
}

// ─── Board / country status ─────────────────────────────────────────────

/** How the searching user's country was determined. */
export type CountryDetection =
  | "explicit"
  | "profile"
  | "geo-header"
  | "accept-language"
  | "default";

/** One job board as reported by `GET /api/boards` and by the settings page. */
export interface BoardStatus {
  id: string;
  name: string;
  homepage: string;
  /** Countries served, or `["*"]` for worldwide boards. */
  countries: string[];
  remoteOnly: boolean;
  requiresBrowser: boolean;
  enabled: boolean;
  /** Why the board is skipped, e.g. "ADZUNA_APP_ID is not set". */
  disabledReason: string | null;
  note?: string;
}

/** Payload of `GET /api/boards?country=XX`. */
export interface BoardsResponse {
  country: string;
  countryName: string;
  detectedVia: CountryDetection;
  boards: BoardStatus[];
}

/** Boards shown as a compact chip row while searching (from the scrape `meta` event). */
export interface SearchBoard {
  id: string;
  name: string;
  homepage: string;
  remoteOnly: boolean;
}
