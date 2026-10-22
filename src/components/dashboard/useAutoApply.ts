"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplyEvent, ApplyOutcome } from "@/lib/apply/types";
import { readSseStream } from "@/lib/readSseStream";
import { errorMessage, isRecord } from "@/lib/guards";

const APPLY_ENDPOINT = "/api/apply";
const CONTINUE_ENDPOINT = "/api/apply/continue";
const APPLY_OUTCOMES: ApplyOutcome[] = ["APPLIED", "NEEDS_MANUAL", "FAILED"];
const STARTING_MESSAGE = "Starting…";
const NO_RESULT_MESSAGE = "The run ended without a result.";

export type ApplyDoneEvent = Extract<ApplyEvent, { type: "done" }>;

type WaitReason = Extract<ApplyEvent, { type: "waiting" }>["reason"];

const WAIT_REASONS: WaitReason[] = ["captcha", "login"];

export interface AutoApplyRun {
  isRunning: boolean;
  message: string | null;
  screenshotUrl: string | null;
  waiting: { reason: WaitReason; message: string } | null;
  outcome: ApplyDoneEvent | null;
  error: string | null;
}

export interface ResumeState {
  isResuming: boolean;
  error: string | null;
}

const IDLE_RUN: AutoApplyRun = {
  isRunning: false,
  message: null,
  screenshotUrl: null,
  waiting: null,
  outcome: null,
  error: null,
};

const IDLE_RESUME: ResumeState = { isResuming: false, error: null };

const isApplyOutcome = (value: unknown): value is ApplyOutcome =>
  APPLY_OUTCOMES.some((outcome) => outcome === value);

const isWaitReason = (value: unknown): value is WaitReason =>
  WAIT_REASONS.some((reason) => reason === value);

function toApplyEvent(data: unknown): ApplyEvent | null {
  if (!isRecord(data)) return null;
  const { type, message, url, status, evidenceUrl, reason } = data;
  if (type === "progress" && typeof message === "string") return { type, message };
  if (type === "resumed" && typeof message === "string") return { type, message };
  if (type === "waiting" && isWaitReason(reason) && typeof message === "string") {
    return { type, reason, message, url: typeof url === "string" ? url : "" };
  }
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
    case "waiting":
      return {
        ...run,
        waiting: { reason: event.reason, message: event.message },
        screenshotUrl: event.url || run.screenshotUrl,
      };
    case "resumed":
      return { ...run, waiting: null, message: event.message };
    case "done":
      return { ...run, waiting: null, outcome: event, message: event.message ?? run.message };
    case "error":
      return { ...run, waiting: null, error: event.message };
  }
}

export async function describeRejection(response: Response, action: string): Promise<string> {
  const fallback = `${action} (HTTP ${response.status}).`;
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

async function postContinue(payload: { applicationId: string } | { all: true }, action: string): Promise<unknown> {
  const response = await fetch(CONTINUE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await describeRejection(response, action));
  return response.json();
}

export interface ContinueAllResult {
  resumed: number;
  swept: number;
}

const countField = (body: unknown, field: keyof ContinueAllResult) =>
  isRecord(body) && typeof body[field] === "number" ? body[field] : 0;

export async function continueAllWaiting(): Promise<ContinueAllResult> {
  const body = await postContinue({ all: true }, "Could not continue the runs");
  return { resumed: countField(body, "resumed"), swept: countField(body, "swept") };
}

export function useAutoApply(applicationId: string) {
  const router = useRouter();
  const [run, setRun] = useState<AutoApplyRun>(IDLE_RUN);
  const [resumeState, setResumeState] = useState<ResumeState>(IDLE_RESUME);

  const start = async () => {
    setRun({ ...IDLE_RUN, isRunning: true, message: STARTING_MESSAGE });
    try {
      const response = await fetch(APPLY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ applicationId }),
      });
      if (!response.ok || !response.body) {
        throw new Error(await describeRejection(response, "Auto apply could not start"));
      }
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

  const resume = async () => {
    setResumeState({ isResuming: true, error: null });
    try {
      await postContinue({ applicationId }, "Could not continue the run");
      setResumeState(IDLE_RESUME);
    } catch (err) {
      setResumeState({ isResuming: false, error: errorMessage(err) });
    }
    if (!run.isRunning) router.refresh();
  };

  return { run, start, resume, resumeState };
}
