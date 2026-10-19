"use server";

import { revalidatePath, updateTag } from "next/cache";
import type { ApplicationStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { favouriteTag } from "@/lib/data/favourites";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";

const JOB_SEARCH_PATH = "/";
const ALREADY_TRACKED_STATUSES: ApplicationStatus[] = ["APPLIED", "PENDING"];

export async function toggleFavourite(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const favouriteKey = {
    userId_jobId: { userId, jobId },
  } satisfies Prisma.UserFavouriteWhereUniqueInput;

  const existing = await prisma.userFavourite.findUnique({ where: favouriteKey });
  if (existing) {
    await prisma.userFavourite.delete({ where: favouriteKey });
  } else {
    await prisma.userFavourite.create({ data: { userId, jobId } });
  }

  updateTag(favouriteTag(userId));
  revalidatePath("/favourites");
  revalidatePath(JOB_SEARCH_PATH);
}

export async function trackJob(jobId: string): Promise<void> {
  const userId = await requireUserId();
  const alreadyTracked = await prisma.application.findFirst({
    where: { userId, jobId, status: { in: ALREADY_TRACKED_STATUSES } },
  });
  if (alreadyTracked) return;

  await prisma.application.create({
    data: { userId, jobId, status: "PENDING" },
  });

  updateTag(applicationTag(userId));
  revalidatePath("/dashboard");
  revalidatePath(JOB_SEARCH_PATH);
}
