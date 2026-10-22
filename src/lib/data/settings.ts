import { unstable_cache } from "next/cache";
import type { Prisma, UserProfile as UserProfileRecord } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COUNTRY, isSupportedCountry } from "@/lib/jobs/sources/types";
import type { UploadedFile, UserProfile } from "@/types";

const SETTINGS_TAG = "settings";
export const settingsTag = (userId: string) => `${SETTINGS_TAG}:${userId}`;

const SETTINGS_CACHE_SECONDS = 300;

const UPLOADED_FILE_SELECT = {
  id: true,
  originalName: true,
  size: true,
  uploadedAt: true,
} satisfies Prisma.CvDocumentSelect;

type UploadedFileRecord = Prisma.CvDocumentGetPayload<{ select: typeof UPLOADED_FILE_SELECT }>;

interface SettingsData {
  profile: UserProfile;
  uploadedFiles: UploadedFile[];
}

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

function toUserProfile(record: UserProfileRecord | null): UserProfile {
  return {
    name: record?.name ?? "",
    email: record?.email ?? "",
    phone: record?.phone ?? "",
    linkedInUrl: record?.linkedInUrl ?? "",
    githubUrl: record?.githubUrl ?? "",
    country: record && isSupportedCountry(record.country) ? record.country : DEFAULT_COUNTRY,
    city: record?.city ?? "",
    availableFrom: record?.availableFrom ? toDateInputValue(record.availableFrom) : "",
    expectedSalaryCzk: record?.expectedSalaryCzk ?? null,
    googleCalendarSync: record?.googleCalendarSync ?? false,
  };
}

function toUploadedFile(file: UploadedFileRecord): UploadedFile {
  return {
    id: file.id,
    filename: file.originalName,
    size: file.size,
    uploadedAt: file.uploadedAt.toISOString(),
  };
}

async function findSettingsData(userId: string): Promise<SettingsData> {
  const [profile, uploadedFiles] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.cvDocument.findMany({
      where: { userId },
      orderBy: { uploadedAt: "desc" },
      select: UPLOADED_FILE_SELECT,
    }),
  ]);

  return {
    profile: toUserProfile(profile),
    uploadedFiles: uploadedFiles.map(toUploadedFile),
  };
}

export function getSettingsData(userId: string) {
  return unstable_cache(
    () => findSettingsData(userId),
    ["get-settings", userId],
    { revalidate: SETTINGS_CACHE_SECONDS, tags: [settingsTag(userId)] },
  )();
}
