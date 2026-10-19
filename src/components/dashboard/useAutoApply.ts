"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplyEvent, ApplyOutcome } from "@/lib/apply/types";
import { readSseStream } from "@/lib/readSseStream";
import { errorMessage, isRecord } from "@/lib/guards";

const APPLY_ENDPOINT = "/api/apply";
const APPLY_OUTCOMES: ApplyOutcome[] = ["APPLIED", "NEEDS_MANUAL", "FAILED"];
const STARTING_MESSAGE = "Starting…";
const NO_RESULT_MESSAGE = "The run ended without a result.";

export type ApplyDoneEvent = Extract<ApplyEvent, { type: "done" }>;

export interface AutoApplyRun {
  isRunning: boolean;
  message: string | null;
  screenshotUrl: string | null;
  outcome: ApplyDoneEvent | null;
  error: string | null;
}

const IDLE_RUN: AutoApplyRun = {
  isRunning: false,
  message: null,
  screenshotUrl: null,
  outcome: null,
  error: null,
};

const isApplyOutcome = (value: unknown): value is ApplyOutcome =>
  APPLY_OUTCOMES.some((outcome) => outcome === value);

function toApplyEvent(data: unknown): ApplyEvent | null {
  if (!isRecord(data)) return null;
  const { type, message, url, status, evidenceUrl } = data;
  if (type === "progress" && typeof message === "string") return { type, message };
  if (type === "error" && typeof message === "string") return { type, message };
  if (type === "screenshot" && typeof url === "string") return { type, url };
  if (type === "done" && isApplyOutcome(status) && typeof evidenceUrl === "string") {
    return { type, status, evidenceUrl, message: typeof message === "string" ? message : undefined };
  }
  return null;
}

function withEvent(run: AutoApplyRun, event: ApplyEvent): AutoApplyRun {
  switch (event.type) {
    case "progress":
      return { ...run, message: event.message };
    case "screenshot":
      return { ...run, screenshotUrl: event.url };
    case "done":
      return { ...run, outcome: event, message: event.message ?? run.message };
    case "error":
      return { ...run, error: event.message };
  }
}

async function describeRejection(response: Response): Promise<string> {
  const fallback = `Auto apply could not start (HTTP ${response.status}).`;
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

export function useAutoApply(applicationId: string) {
  const router = useRouter();
  const [run, setRun] = useState<AutoApplyRun>(IDLE_RUN);

  const start = async () => {
    setRun({ ...IDLE_RUN, isRunning: true, message: STARTING_MESSAGE });
    try {
      const response = await fetch(APPLY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ applicationId }),
      });
      if (!response.ok || !response.body) throw new Error(await describeRejection(response));
      await readSseStream(response.body, (data) => {
        const event = toApplyEvent(data);
        if (event) setRun((current) => withEvent(current, event));
      });
      setRun((current) =>
        current.outcome || current.error ? current : { ...current, error: NO_RESULT_MESSAGE },
      );
    } catch (err) {
      setRun((current) => ({ ...current, error: errorMessage(err) }));
    } finally {
      setRun((current) => ({ ...current, isRunning: false }));
      router.refresh();
    }
  };

  return { run, start };
}
