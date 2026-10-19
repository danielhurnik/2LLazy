"use server";

import { errorMessage } from "@/lib/guards";
import { requireUserId } from "@/lib/auth/sessionManager";
import { rankerStatusFor, recordDismissal, removeDismissal, retrainRanker, type RankerStatus, type RetrainResult } from "@/lib/jobs/feedback";

export type FeedbackResult = { ok: true } | { error: string };

async function attempt(work: (userId: string) => Promise<void>): Promise<FeedbackResult> {
  const userId = await requireUserId();
  try {
    await work(userId);
    return { ok: true };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function dismissJob(jobId: string): Promise<FeedbackResult> {
  return attempt((userId) => recordDismissal(userId, jobId));
}

export async function undismissJob(jobId: string): Promise<FeedbackResult> {
  return attempt((userId) => removeDismissal(userId, jobId));
}

export async function retrainRankerAction(): Promise<RetrainResult | { error: string }> {
  const userId = await requireUserId();
  try {
    return await retrainRanker(userId);
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function loadRankerStatus(): Promise<RankerStatus | null> {
  const userId = await requireUserId();
  return rankerStatusFor(userId);
}
