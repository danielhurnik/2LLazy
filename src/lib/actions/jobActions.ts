"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { favouriteTag, toggleUserFavourite } from "@/lib/data/favourites";
import { applicationTag } from "@/lib/data/applications";
import { requireUserId } from "@/lib/auth/sessionManager";
import { boardLabel, duplicateApplicationMessage } from "@/lib/jobs/crossListing";
import { sourceLabels } from "@/lib/jobs/registry";
import { earlierApplicationInGroup, STATUSES_THAT_ALLOW_APPLYING_AGAIN } from "@/lib/jobs/repo";

const JOB_SEARCH_PATH = "/";

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

export type TrackJobOutcome = { tracked: true } | { tracked: false; reason: string; canOverride: boolean };

export interface TrackJobOptions {
  force?: boolean;
}

const ALREADY_TRACKED_REASON = "Already in your applications.";

export async function trackJob(jobId: string, options: TrackJobOptions = {}): Promise<TrackJobOutcome> {
  const userId = await requireUserId();
  const outcome = await prisma.$transaction(async (tx): Promise<TrackJobOutcome> => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${trackingLockKey(userId, jobId)}))`;
    const alreadyTracked = await tx.application.findFirst({
      where: { userId, jobId, status: { notIn: STATUSES_THAT_ALLOW_APPLYING_AGAIN } },
      select: { id: true },
    });
    if (alreadyTracked) return { tracked: false, reason: ALREADY_TRACKED_REASON, canOverride: false };
    const earlier = options.force ? null : await earlierApplicationInGroup(userId, jobId, tx);
    if (earlier) {
      const board = boardLabel(earlier.source, earlier.sourceUrl, sourceLabels());
      return { tracked: false, reason: duplicateApplicationMessage(earlier.status, board), canOverride: true };
    }
    await tx.application.create({ data: { userId, jobId, status: "PENDING" } });
    return { tracked: true };
  });
  if (!outcome.tracked) return outcome;

  updateTag(applicationTag(userId));
  revalidatePath("/dashboard");
  revalidatePath(JOB_SEARCH_PATH);
  return outcome;
}
