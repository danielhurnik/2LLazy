"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ApplicationStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";
import { obstacleSummaryFor, type ObstacleSummary } from "@/lib/apply/obstacles";

const MAX_NOTES_LENGTH = 5000;

const ApplicationStatusSchema = z.enum(ApplicationStatus);
const ApplicationNotesSchema = z.string().max(MAX_NOTES_LENGTH);
const JobIdSchema = z.string().min(1).max(64);

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

export async function loadObstacleSummary(jobId: string): Promise<ObstacleSummary | null> {
  const userId = await requireUserId();
  return obstacleSummaryFor(userId, JobIdSchema.parse(jobId));
}
