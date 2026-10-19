"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import path from "path";
import { randomUUID } from "crypto";
import { settingsTag } from "@/lib/data/settings";
import { requireUserId } from "@/lib/auth/sessionManager";
import { isSupportedCountry, type CountryCode } from "@/lib/jobs/sources/types";

const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".txt"]);
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * BYTES_PER_MEGABYTE;

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46];
const DOCX_ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const DOC_OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];
const BINARY_DOCUMENT_SIGNATURES = [PDF_SIGNATURE, DOCX_ZIP_SIGNATURE, DOC_OLE2_SIGNATURE];

const PLAIN_TEXT_SNIFF_LENGTH = 512;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FIRST_PRINTABLE_ASCII = 0x20;
const LAST_PRINTABLE_ASCII = 0x7e;
const TEXT_WHITESPACE_BYTES = new Set([TAB, LINE_FEED, CARRIAGE_RETURN]);

const UNSAFE_FILENAME_CHARACTERS = /[^a-zA-Z0-9._-]/g;

const GOOGLE_PROVIDER = "google";
const CALENDAR_SCOPE_FRAGMENT = "calendar";
const REQUIRED_PROFILE_PLACEHOLDERS = { name: "", email: "" };
const MAX_CITY_LENGTH = 80;

type UploadCvResult = { error?: string; filename?: string };

interface UserProfileInput {
  name: string;
  email: string;
  phone?: string;
  linkedInUrl?: string;
  githubUrl?: string;
  country?: string;
  city?: string;
}

interface EditableProfileFields extends Omit<UserProfileInput, "country" | "city"> {
  country?: CountryCode;
  city?: string | null;
}

function isPlainTextByte(byte: number): boolean {
  return (
    TEXT_WHITESPACE_BYTES.has(byte) ||
    (byte >= FIRST_PRINTABLE_ASCII && byte <= LAST_PRINTABLE_ASCII)
  );
}

function looksLikePlainText(content: Buffer): boolean {
  return content.subarray(0, PLAIN_TEXT_SNIFF_LENGTH).every(isPlainTextByte);
}

function startsWithSignature(content: Buffer, signature: number[]): boolean {
  return signature.every((byte, index) => content[index] === byte);
}

function hasRecognisedDocumentContent(content: Buffer): boolean {
  return (
    looksLikePlainText(content) ||
    BINARY_DOCUMENT_SIGNATURES.some((signature) => startsWithSignature(content, signature))
  );
}

function toStoredFileName(originalName: string): string {
  const sanitisedBaseName = path.basename(originalName).replace(UNSAFE_FILENAME_CHARACTERS, "_");
  return `${randomUUID()}-${sanitisedBaseName}`;
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

  const extension = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension))
    return { error: "Only PDF, DOCX, DOC, and TXT files are allowed" };

  const content = Buffer.from(await file.arrayBuffer());
  if (!hasRecognisedDocumentContent(content))
    return { error: "File content does not match its declared type" };

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

function pickEditableProfileFields({
  name,
  email,
  phone,
  linkedInUrl,
  githubUrl,
  country,
  city,
}: UserProfileInput): EditableProfileFields {
  return {
    name,
    email,
    phone,
    linkedInUrl,
    githubUrl,
    country: validCountry(country),
    city: normalisedCity(city),
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
