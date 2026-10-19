"use server";

import { revalidatePath, updateTag } from "next/cache";
import type { ApplicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { favouriteTag, toggleUserFavourite } from "@/lib/data/favourites";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";

const JOB_SEARCH_PATH = "/";
const STATUSES_THAT_ALLOW_TRACKING_AGAIN: ApplicationStatus[] = ["REJECTED", "FAILED"];

function trackingLockKey(userId: string, jobId: string): string {
  return `track-job:${userId}:${jobId}`;
}

export async function toggleFavourite(jobId: string): Promise<void> {
  const userId = await requireUserId();
  await toggleUserFavourite(userId, jobId);

  updateTag(favouriteTag(userId));
  revalidatePath("/favourites");
  revalidatePath(JOB_SEARCH_PATH);
}

export async function trackJob(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const createdApplication = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${trackingLockKey(userId, jobId)}))`;
    const alreadyTracked = await tx.application.findFirst({
      where: { userId, jobId, status: { notIn: STATUSES_THAT_ALLOW_TRACKING_AGAIN } },
      select: { id: true },
    });
    if (alreadyTracked) return false;
    await tx.application.create({ data: { userId, jobId, status: "PENDING" } });
    return true;
  });
  if (!createdApplication) return;

  updateTag(applicationTag(userId));
  revalidatePath("/dashboard");
  revalidatePath(JOB_SEARCH_PATH);
}
