"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { dismissJob, undismissJob, type FeedbackResult } from "@/lib/actions/jobFeedbackActions";
import { errorMessage } from "@/lib/guards";
import type { JobItem } from "@/types";

interface JobDismissalOptions {
  setJobs: Dispatch<SetStateAction<JobItem[]>>;
  setErrors: Dispatch<SetStateAction<string[]>>;
}

async function failureOf(request: Promise<FeedbackResult>): Promise<string | null> {
  try {
    const result = await request;
    return "error" in result ? result.error : null;
  } catch (err) {
    return errorMessage(err);
  }
}

export function useJobDismissal({ setJobs, setErrors }: JobDismissalOptions) {
  const [dismissedThisView, setDismissedThisView] = useState<ReadonlySet<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);

  const markDismissed = (jobId: string, dismissed: boolean) =>
    setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, dismissed } : job)));

  const reportFailure = (action: string, error: string) =>
    setErrors((prev) => [...prev, `Could not ${action}: ${error}`]);

  const dismiss = async (job: JobItem) => {
    markDismissed(job.id, true);
    setDismissedThisView((prev) => new Set(prev).add(job.id));
    const error = await failureOf(dismissJob(job.id));
    if (!error) return;
    markDismissed(job.id, false);
    reportFailure("hide the job", error);
  };

  const undismiss = async (job: JobItem) => {
    markDismissed(job.id, false);
    const error = await failureOf(undismissJob(job.id));
    if (!error) return;
    markDismissed(job.id, true);
    reportFailure("restore the job", error);
  };

  const isListed = (job: JobItem) => !job.dismissed || showHidden || dismissedThisView.has(job.id);

  const countHidden = (jobs: JobItem[]) =>
    jobs.filter((job) => job.dismissed && !dismissedThisView.has(job.id)).length;

  const reset = () => {
    setDismissedThisView(new Set());
    setShowHidden(false);
  };

  return {
    dismiss,
    undismiss,
    isListed,
    countHidden,
    reset,
    showHidden,
    toggleShowHidden: () => setShowHidden((isShown) => !isShown),
  };
}
