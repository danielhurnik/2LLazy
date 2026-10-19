"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ApplicationStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";

const MAX_NOTES_LENGTH = 5000;

const ApplicationStatusSchema = z.enum(ApplicationStatus);
const ApplicationNotesSchema = z.string().max(MAX_NOTES_LENGTH);

async function updateOwnedApplication(
  userId: string,
  id: string,
  data: Prisma.ApplicationUpdateInput,
): Promise<void> {
  await prisma.application.update({ where: { id, userId }, data });
  updateTag(applicationTag(userId));
  revalidatePath("/dashboard");
}

export async function updateApplicationStatus(
  id: string,
  status: string,
): Promise<void> {
  const userId = await requireUserId();
  const validatedStatus = ApplicationStatusSchema.parse(status);
  await updateOwnedApplication(userId, id, { status: validatedStatus });
}

export async function updateApplicationNotes(id: string, notes: string): Promise<void> {
  const userId = await requireUserId();
  await updateOwnedApplication(userId, id, { notes: ApplicationNotesSchema.parse(notes) });
}
