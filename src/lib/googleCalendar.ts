import { prisma } from "@/lib/prisma";

const GOOGLE_PROVIDER = "google";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PRIMARY_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TOKEN_REFRESH_LEEWAY_SECONDS = 60;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const ALREADY_DELETED_STATUSES = new Set([404, 410]);
const DEFAULT_TIMEZONE = "UTC";

interface CalendarDateTime {
  dateTime: string;
  timeZone: string;
}

interface GCalEventPayload {
  summary: string;
  description?: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
}

interface RefreshedToken {
  access_token: string;
  expires_in: number;
}

interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

const nowInEpochSeconds = () => Math.floor(Date.now() / MS_PER_SECOND);

const eventUrl = (gcalEventId: string) => `${PRIMARY_CALENDAR_EVENTS_URL}/${encodeURIComponent(gcalEventId)}`;

const bearerHeader = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

const jsonRequestHeaders = (accessToken: string) => ({
  ...bearerHeader(accessToken),
  "Content-Type": "application/json",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRefreshedToken(value: unknown): value is RefreshedToken {
  return isRecord(value) && typeof value.access_token === "string" && typeof value.expires_in === "number";
}

function createdEventId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === "string" ? value.id : null;
}

function googleClientCredentials(): GoogleClientCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function logCalendarFailure(action: string, detail: unknown): void {
  console.error(`[GCal] ${action} failed`, detail);
}

async function failedResponseDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  return `HTTP ${res.status} ${body}`.trim();
}

function isExpiringSoon(expiresAtEpochSeconds: number | null): boolean {
  if (!expiresAtEpochSeconds) return false;
  return expiresAtEpochSeconds - TOKEN_REFRESH_LEEWAY_SECONDS < nowInEpochSeconds();
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: GOOGLE_PROVIDER },
    select: { access_token: true, refresh_token: true, expires_at: true },
  });
  if (!account?.access_token) return null;
  if (!isExpiringSoon(account.expires_at)) return account.access_token;
  if (!account.refresh_token) return null;
  return refreshAccessToken(userId, account.refresh_token);
}

async function refreshAccessToken(userId: string, refreshToken: string): Promise<string | null> {
  const credentials = googleClientCredentials();
  if (!credentials) return null;
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      logCalendarFailure("token refresh", await failedResponseDetail(res));
      return null;
    }
    const token: unknown = await res.json();
    if (!isRefreshedToken(token)) return null;
    await prisma.account.updateMany({
      where: { userId, provider: GOOGLE_PROVIDER },
      data: { access_token: token.access_token, expires_at: nowInEpochSeconds() + token.expires_in },
    });
    return token.access_token;
  } catch (err) {
    logCalendarFailure("token refresh", err);
    return null;
  }
}

export async function hasCalendarSync(userId: string): Promise<boolean> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { googleCalendarSync: true },
  });
  return profile?.googleCalendarSync ?? false;
}

export async function createGCalEvent(userId: string, payload: GCalEventPayload): Promise<string | null> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return null;
  try {
    const res = await fetch(PRIMARY_CALENDAR_EVENTS_URL, {
      method: "POST",
      headers: jsonRequestHeaders(accessToken),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      logCalendarFailure("create", await failedResponseDetail(res));
      return null;
    }
    return createdEventId(await res.json());
  } catch (err) {
    logCalendarFailure("create", err);
    return null;
  }
}

export async function updateGCalEvent(userId: string, gcalEventId: string, payload: GCalEventPayload): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;
  try {
    const res = await fetch(eventUrl(gcalEventId), {
      method: "PUT",
      headers: jsonRequestHeaders(accessToken),
      body: JSON.stringify(payload),
    });
    if (!res.ok) logCalendarFailure("update", await failedResponseDetail(res));
  } catch (err) {
    logCalendarFailure("update", err);
  }
}

export async function deleteGCalEvent(userId: string, gcalEventId: string): Promise<void> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) return;
  try {
    const res = await fetch(eventUrl(gcalEventId), {
      method: "DELETE",
      headers: bearerHeader(accessToken),
    });
    if (!res.ok && !ALREADY_DELETED_STATUSES.has(res.status)) {
      logCalendarFailure("delete", await failedResponseDetail(res));
    }
  } catch (err) {
    logCalendarFailure("delete", err);
  }
}

export function buildGCalPayload(
  summary: string,
  scheduledAt: Date,
  durationMinutes: number,
  description?: string | null,
  timezone = DEFAULT_TIMEZONE,
): GCalEventPayload {
  const endsAt = new Date(scheduledAt.getTime() + durationMinutes * MS_PER_MINUTE);
  return {
    summary,
    ...(description ? { description } : {}),
    start: { dateTime: scheduledAt.toISOString(), timeZone: timezone },
    end: { dateTime: endsAt.toISOString(), timeZone: timezone },
  };
}
