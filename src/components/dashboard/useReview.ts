"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage, isRecord } from "@/lib/guards";
import { MS_PER_SECOND } from "@/lib/time";
import { postContinue, type ReviewOutcome } from "./useAutoApply";

const OUTCOME_REFRESH_DELAYS_MS = [3 * MS_PER_SECOND, 6 * MS_PER_SECOND];
const NO_LONGER_WAITING = "This run is no longer waiting. Refresh to see how it ended.";
const EVIDENCE_FILE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

type ReviewAction = "focus" | ReviewOutcome;

export interface ReviewDetails {
  draft: string | null;
  screenshotUrl: string | null;
}

export interface ReviewActionsState {
  pending: ReviewAction | null;
  error: string | null;
}

const IDLE_REVIEW: ReviewActionsState = { pending: null, error: null };

const evidenceFileUrl = (applicationId: string, file: string) => `/api/apply/evidence/${applicationId}/${file}`;

function toReviewDetails(applicationId: string, body: unknown): ReviewDetails | null {
  if (!isRecord(body)) return null;
  const { draft, screenshot } = body;
  return {
    draft: typeof draft === "string" && draft.trim() ? draft : null,
    screenshotUrl:
      typeof screenshot === "string" && EVIDENCE_FILE.test(screenshot) ? evidenceFileUrl(applicationId, screenshot) : null,
  };
}

export function useSavedReview(applicationId: string, shouldLoad: boolean): ReviewDetails | null {
  const [review, setReview] = useState<ReviewDetails | null>(null);

  useEffect(() => {
    if (!shouldLoad) return;
    let isCurrent = true;
    fetch(evidenceFileUrl(applicationId, "review.json"), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (isCurrent) setReview(toReviewDetails(applicationId, body));
      })
      .catch(() => undefined);
    return () => {
      isCurrent = false;
    };
  }, [applicationId, shouldLoad]);

  return shouldLoad ? review : null;
}

const isStillWaiting = (body: unknown) => isRecord(body) && (body.focused === true || body.waiting === true);

export function useReviewActions(applicationId: string, isLiveRun: boolean) {
  const router = useRouter();
  const [reviewState, setReviewState] = useState<ReviewActionsState>(IDLE_REVIEW);
  const pendingRefreshes = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = pendingRefreshes.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const request = async (action: ReviewAction, failure: string): Promise<boolean> => {
    setReviewState({ pending: action, error: null });
    try {
      const payload = action === "focus" ? { applicationId, focus: true as const } : { applicationId, outcome: action };
      if (isStillWaiting(await postContinue(payload, failure))) return true;
      setReviewState({ pending: null, error: NO_LONGER_WAITING });
    } catch (err) {
      setReviewState({ pending: null, error: errorMessage(err) });
    }
    return false;
  };

  const openWindow = async () => {
    if (await request("focus", "Could not bring the apply window forward")) setReviewState(IDLE_REVIEW);
  };

  const finish = async (outcome: ReviewOutcome) => {
    const failure = outcome === "SENT" ? "Could not mark it as sent" : "Could not discard it";
    const isAccepted = await request(outcome, failure);
    if (!isAccepted || isLiveRun) return;
    OUTCOME_REFRESH_DELAYS_MS.forEach((delay) => {
      pendingRefreshes.current.push(setTimeout(() => router.refresh(), delay));
    });
  };

  return {
    reviewState,
    openWindow,
    markSent: () => finish("SENT"),
    discard: () => finish("DISCARDED"),
  };
}
