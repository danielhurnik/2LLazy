"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";

const StatusSchema = z.enum(["PENDING", "APPLIED", "REJECTED", "INTERVIEW", "OFFER", "FAILED"]);

export async function updateApplicationStatus(
  id: string,
  status: string,
): Promise<void> {
  const userId = await requireUserId();
  const validated = StatusSchema.parse(status);
  await prisma.application.update({
    where: { id, userId },
    data: { status: validated },
  });
  revalidateTag(applicationTag(userId), "default");
  revalidatePath("/dashboard");
}

export async function getCoverLettersForJob(jobId: string) {
  const userId = await requireUserId();
  return prisma.coverLetter.findMany({
    where: { jobId, userId },
    select: { id: true, content: true, generatedFromTemplate: true },
    orderBy: { id: "desc" },
  });
}

export async function updateApplicationNotes(id: string, notes: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.application.update({ where: { id, userId }, data: { notes } });
  revalidateTag(applicationTag(userId), "default");
  revalidatePath("/dashboard");
}

