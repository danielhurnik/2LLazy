"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import path from "path";
import { settingsTag } from "@/lib/data/settings";
import { requireUserId } from "@/lib/auth/sessionManager";
import { isSupportedCountry, type CountryCode } from "@/lib/jobs/sources/types";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const DOCX_ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const DOC_OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

const TAB = 0x09;
const LINE_FEED = 0x0a;
const FORM_FEED = 0x0c;
const CARRIAGE_RETURN = 0x0d;
const FIRST_NON_CONTROL_CODE = 0x20;
const DELETE_CODE = 0x7f;
const TEXT_LAYOUT_CONTROL_CODES = new Set([TAB, LINE_FEED, FORM_FEED, CARRIAGE_RETURN]);

const UNSAFE_FILENAME_CHARACTERS = /[^\p{L}\p{N}._ -]/gu;

const GOOGLE_PROVIDER = "google";
const CALENDAR_SCOPE_FRAGMENT = "calendar";
const REQUIRED_PROFILE_PLACEHOLDERS = { name: "", email: "" };
const MAX_CITY_LENGTH = 80;
const MAX_EXPECTED_SALARY_CZK = 10_000_000;
const DATE_INPUT_VALUE = /^\d{4}-\d{2}-\d{2}$/;

type UploadCvResult = { error?: string; filename?: string };

interface UserProfileInput {
  name: string;
  email: string;
  phone?: string;
  linkedInUrl?: string;
  githubUrl?: string;
  country?: string;
  city?: string;
  availableFrom?: string;
  expectedSalaryCzk?: number | null;
}

interface EditableProfileFields extends Omit<UserProfileInput, "country" | "city" | "availableFrom"> {
  country?: CountryCode;
  city?: string | null;
  availableFrom?: Date | null;
}

function startsWithSignature(content: Buffer, signature: number[]): boolean {
  return signature.every((byte, index) => content[index] === byte);
}

function isBinaryOrDeleteControlCode(code: number): boolean {
  return (code < FIRST_NON_CONTROL_CODE && !TEXT_LAYOUT_CONTROL_CODES.has(code)) || code === DELETE_CODE;
}

function isUtf8Text(content: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return false;
  }
  for (let index = 0; index < text.length; index++) {
    if (isBinaryOrDeleteControlCode(text.charCodeAt(index))) return false;
  }
  return true;
}

const CONTENT_CHECK_BY_EXTENSION: Record<string, (content: Buffer) => boolean> = {
  ".pdf": (content) => startsWithSignature(content, PDF_SIGNATURE),
  ".docx": (content) => startsWithSignature(content, DOCX_ZIP_SIGNATURE),
  ".doc": (content) => startsWithSignature(content, DOC_OLE2_SIGNATURE),
  ".txt": isUtf8Text,
};

function contentCheckFor(extension: string): ((content: Buffer) => boolean) | undefined {
  return Object.hasOwn(CONTENT_CHECK_BY_EXTENSION, extension) ? CONTENT_CHECK_BY_EXTENSION[extension] : undefined;
}

function toStoredFileName(originalName: string): string {
  return path.basename(originalName).replace(UNSAFE_FILENAME_CHARACTERS, "_");
}

function revalidateSettings(userId: string): void {
  updateTag(settingsTag(userId));
  revalidatePath("/settings");
}

export async function uploadCvAction(
  _prevState: UploadCvResult | null,
  formData: FormData,
): Promise<UploadCvResult> {
  const userId = await requireUserId();
  const file = formData.get("file");
  if (!file || typeof file === "string" || !file.name) return { error: "No file provided" };
  if (file.size > MAX_FILE_SIZE_BYTES) return { error: `File too large (max ${MAX_FILE_SIZE_MB} MB)` };

  const matchesDeclaredType = contentCheckFor(path.extname(file.name).toLowerCase());
  if (!matchesDeclaredType) return { error: "Only PDF, DOCX, DOC, and TXT files are allowed" };

  const content = Buffer.from(await file.arrayBuffer());
  if (!matchesDeclaredType(content)) return { error: "File content does not match its declared type" };

  const storedFileName = toStoredFileName(file.name);
  await prisma.cvDocument.create({
    data: { userId, originalName: storedFileName, data: content, size: content.length },
  });

  revalidateSettings(userId);
  return { filename: storedFileName };
}

export async function deleteUploadedFileAction(id: string): Promise<{ error?: string }> {
  const userId = await requireUserId();
  try {
    await prisma.cvDocument.delete({ where: { id, userId } });
  } catch {
    return { error: "File not found or could not be deleted." };
  }
  revalidateSettings(userId);
  return {};
}

function validCountry(country: string | undefined): CountryCode | undefined {
  if (country === undefined) return undefined;
  if (!isSupportedCountry(country)) throw new Error(`Unsupported country: ${country}`);
  return country;
}

function normalisedCity(city: string | undefined): string | null | undefined {
  if (city === undefined) return undefined;
  return city.trim().slice(0, MAX_CITY_LENGTH) || null;
}

function validStartDate(value: string | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === "") return null;
  if (!DATE_INPUT_VALUE.test(value)) throw new Error(`Invalid start date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid start date: ${value}`);
  return date;
}

function validExpectedSalary(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (!Number.isInteger(value)) throw new Error("Expected salary must be a whole number of CZK per month");
  if (value <= 0) throw new Error("Expected salary must be above 0");
  if (value > MAX_EXPECTED_SALARY_CZK) throw new Error("Expected salary must be at most 10 000 000 CZK per month");
  return value;
}

function pickEditableProfileFields({
  name,
  email,
  phone,
  linkedInUrl,
  githubUrl,
  country,
  city,
  availableFrom,
  expectedSalaryCzk,
}: UserProfileInput): EditableProfileFields {
  return {
    name,
    email,
    phone,
    linkedInUrl,
    githubUrl,
    country: validCountry(country),
    city: normalisedCity(city),
    availableFrom: validStartDate(availableFrom),
    expectedSalaryCzk: validExpectedSalary(expectedSalaryCzk),
  };
}

export async function saveUserProfile(profile: UserProfileInput): Promise<void> {
  const userId = await requireUserId();
  const editableFields = pickEditableProfileFields(profile);
  await prisma.userProfile.upsert({
    where: { userId },
    update: editableFields,
    create: { ...editableFields, userId },
  });
  revalidateSettings(userId);
}

export async function toggleGoogleCalendarSync(enabled: boolean): Promise<void> {
  const userId = await requireUserId();
  await prisma.userProfile.upsert({
    where: { userId },
    update: { googleCalendarSync: enabled },
    create: { userId, ...REQUIRED_PROFILE_PLACEHOLDERS, googleCalendarSync: enabled },
  });
  revalidateSettings(userId);
}

export async function checkCalendarAccess(): Promise<boolean> {
  const userId = await requireUserId();
  const googleAccount = await prisma.account.findFirst({
    where: { userId, provider: GOOGLE_PROVIDER },
    select: { scope: true },
  });
  return (googleAccount?.scope ?? "").includes(CALENDAR_SCOPE_FRAGMENT);
}
