import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { BoardStatus, UploadedFile, UserProfile } from "@/types";
import { boardStatus } from "@/lib/scrapers/registry";
import { DEFAULT_COUNTRY, getCountry } from "@/lib/geo";

export const SETTINGS_TAG = "settings";
export const settingsTag = (userId: string) => `${SETTINGS_TAG}:${userId}`;

export interface SettingsData {
  profile: UserProfile;
  uploadedFiles: UploadedFile[];
  /** Country the scraper will use, and the boards it covers. */
  country: string;
  countryName: string;
  boards: BoardStatus[];
  /** Playwright unlocks the JavaScript-heavy boards; optional but recommended. */
  playwrightEnabled: boolean;
}

async function _getSettingsData(userId: string): Promise<SettingsData> {
  const [dbProfile, dbFiles] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.cvDocument.findMany({ where: { userId }, orderBy: { uploadedAt: "desc" }, select: { id: true, originalName: true, size: true, uploadedAt: true } }),
  ]);

  const country =
    dbProfile?.country?.toUpperCase() ?? process.env.DEFAULT_COUNTRY?.toUpperCase() ?? DEFAULT_COUNTRY;

  const profile: UserProfile = {
    name: dbProfile?.name ?? "",
    email: dbProfile?.email ?? "",
    phone: dbProfile?.phone ?? "",
    linkedInUrl: dbProfile?.linkedInUrl ?? "",
    githubUrl: dbProfile?.githubUrl ?? "",
    coverLetterLanguage: dbProfile?.coverLetterLanguage ?? "English",
    googleCalendarSync: dbProfile?.googleCalendarSync ?? false,
    country,
    preferredWorkType: dbProfile?.preferredWorkType ?? "",
    remoteOnly: dbProfile?.remoteOnly ?? false,
  };

  const uploadedFiles: UploadedFile[] = dbFiles.map((f) => ({
    id: f.id,
    filename: f.originalName,
    size: f.size,
    uploadedAt: f.uploadedAt.toISOString(),
  }));

  return {
    profile,
    uploadedFiles,
    country,
    countryName: getCountry(country)?.name ?? country,
    boards: boardStatus(country),
    playwrightEnabled: process.env.PLAYWRIGHT_ENABLED === "true",
  };
}

export function getSettingsData(userId: string) {
  return unstable_cache(
    () => _getSettingsData(userId),
    ["get-settings", userId],
    { revalidate: 300, tags: [settingsTag(userId)] },
  )();
}

