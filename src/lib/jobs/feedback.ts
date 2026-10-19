import type { ApplicationStatus } from "@prisma/client";
import { z } from "zod";
import { errorMessage } from "@/lib/guards";
import { ollamaAvailable, ollamaChatJson, type OllamaMessage } from "@/lib/ollama";
import { prisma } from "@/lib/prisma";
import { embedText, embeddingsFor, profileText } from "./embeddings";
import { resolveIntent } from "./intent";
import { storedToNormalized } from "./pipeline";
import { searchProfileFor, updateUserProfile, type SearchProfile } from "./profile";
import { trainRanker, type TrainingSample } from "./ranker";
import { rankingContextFor, similarityFeature } from "./ranking";
import type { StoredJob } from "./repo";
import { scoreJob, type ScoreRequest } from "./score";
import { DEFAULT_COUNTRY, isSupportedCountry } from "./sources/types";

const DISMISSED_WEIGHT = 1.5;
const FAVOURITE_WEIGHT = 1;
const MODEL_JUDGED_WEIGHT = 0.5;
const APPLICATION_WEIGHTS: Partial<Record<ApplicationStatus, number>> = {
  APPLIED: 1.5,
  INTERVIEW: 2,
  OFFER: 2,
  REJECTED: 1,
  PENDING: 0.7,
  APPLYING: 0.7,
  NEEDS_MANUAL: 0.7,
  FAILED: 0.5,
};
const MAX_JUDGED_PER_SEARCH = 10;
const JUDGE_DESCRIPTION_CHARS = 1500;
const JUDGE_TIMEOUT_MS = 60_000;
const FIT_SCALE = 10;
const JUDGE_INSTRUCTIONS =
  "You rate how well a job posting fits a candidate. Consider role, seniority, skills, location and language. " +
  "Answer with JSON only: fit is an integer from 0 (no fit) to 10 (ideal), reason is one short sentence.";

const judgeResultSchema = z.object({ fit: z.number().min(0).max(FIT_SCALE), reason: z.string() });

const judging = globalThis as typeof globalThis & { rankerJudgingUsers?: Set<string> };

export interface RankerStatus {
  trainedAt: string | null;
  samples: number;
  positives: number;
}

export interface RetrainResult {
  trained: boolean;
  samples: number;
  positives: number;
}

export async function dismissedIdsFor(userId: string): Promise<Set<string>> {
  const rows = await prisma.jobFeedback.findMany({ where: { userId, signal: "DISMISSED" }, select: { jobId: true } });
  return new Set(rows.map((row) => row.jobId));
}

export async function recordDismissal(userId: string, jobId: string): Promise<void> {
  await prisma.jobFeedback.upsert({
    where: { userId_jobId_signal: { userId, jobId, signal: "DISMISSED" } },
    create: { userId, jobId, signal: "DISMISSED" },
    update: { createdAt: new Date() },
  });
}

export async function removeDismissal(userId: string, jobId: string): Promise<void> {
  await prisma.jobFeedback.deleteMany({ where: { userId, jobId, signal: "DISMISSED" } });
}

function profileRequest(profile: SearchProfile | null): ScoreRequest {
  const query = profile?.titles[0] ?? "";
  return {
    query,
    skillLevel: "Any",
    city: profile?.cities[0] ?? "",
    intent: resolveIntent(query),
    salaryMin: null,
    salaryMax: null,
    profile,
  };
}

interface LabelledJob {
  job: StoredJob;
  label: number;
  weight: number;
}

async function labelledJobsFor(userId: string): Promise<LabelledJob[]> {
  const [favourites, applications, feedback] = await Promise.all([
    prisma.userFavourite.findMany({ where: { userId }, select: { job: true } }),
    prisma.application.findMany({ where: { userId }, select: { status: true, job: true } }),
    prisma.jobFeedback.findMany({ where: { userId }, select: { signal: true, score: true, job: true } }),
  ]);
  const byJob = new Map<string, LabelledJob>();
  const add = (job: StoredJob, label: number, weight: number) => {
    const existing = byJob.get(job.id);
    if (!existing || weight > existing.weight) byJob.set(job.id, { job, label, weight });
  };
  for (const { job } of favourites) add(job, 1, FAVOURITE_WEIGHT);
  for (const { job, status } of applications) add(job, 1, APPLICATION_WEIGHTS[status] ?? FAVOURITE_WEIGHT);
  for (const { job, signal, score } of feedback) {
    if (signal === "DISMISSED") add(job, 0, DISMISSED_WEIGHT);
    else if (score !== null) add(job, score, MODEL_JUDGED_WEIGHT);
  }
  return Array.from(byJob.values());
}

export async function trainingSamplesFor(userId: string): Promise<TrainingSample[]> {
  const labelled = await labelledJobsFor(userId);
  if (labelled.length === 0) return [];
  const context = await rankingContextFor(userId);
  const request = profileRequest(context.profile);
  const vectors = await embeddingsFor(labelled.map(({ job }) => job));
  const profileVector = context.profile ? await embedText(profileText(context.profile)) : null;
  return labelled.map(({ job, label, weight }) => {
    const normalized = storedToNormalized(job, isSupportedCountry(job.country) ? job.country : DEFAULT_COUNTRY);
    const scored = scoreJob(request, normalized, job.firstSeenAt);
    const embedding = similarityFeature({ profileVector }, vectors.get(job.id));
    return { features: { ...scored.features, embedding }, label, weight };
  });
}

export async function retrainRanker(userId: string): Promise<RetrainResult> {
  const samples = await trainingSamplesFor(userId);
  const model = trainRanker(samples);
  if (!model) return { trained: false, samples: samples.length, positives: samples.filter((sample) => sample.label >= 0.5).length };
  await updateUserProfile(userId, { rankerModel: model, rankerTrainedAt: new Date() });
  return { trained: true, samples: model.samples, positives: model.positives };
}

export async function rankerStatusFor(userId: string): Promise<RankerStatus | null> {
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: { rankerModel: true, rankerTrainedAt: true } });
  const model = row?.rankerModel;
  if (!model || typeof model !== "object" || Array.isArray(model)) return null;
  const samples = typeof model.samples === "number" ? model.samples : 0;
  const positives = typeof model.positives === "number" ? model.positives : 0;
  return { trainedAt: row?.rankerTrainedAt?.toISOString() ?? null, samples, positives };
}

async function judgeOne(profile: SearchProfile, job: StoredJob): Promise<number | null> {
  const messages: OllamaMessage[] = [
    { role: "system", content: JUDGE_INSTRUCTIONS },
    {
      role: "user",
      content: `Candidate:\n${profileText(profile)}\n\nJob: ${job.title} at ${job.company}${job.location ? `, ${job.location}` : ""}\n${job.description.slice(0, JUDGE_DESCRIPTION_CHARS)}`,
    },
  ];
  try {
    const result = await ollamaChatJson(messages, judgeResultSchema, { signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS) });
    return result.fit / FIT_SCALE;
  } catch (err) {
    console.warn(`[ranker] judging ${job.id} failed: ${errorMessage(err)}`);
    return null;
  }
}

async function unjudged(userId: string, jobs: StoredJob[]): Promise<StoredJob[]> {
  const judged = await prisma.jobFeedback.findMany({
    where: { userId, signal: "MODEL_JUDGED", jobId: { in: jobs.map((job) => job.id) } },
    select: { jobId: true },
  });
  const done = new Set(judged.map((row) => row.jobId));
  return jobs.filter((job) => !done.has(job.id)).slice(0, MAX_JUDGED_PER_SEARCH);
}

export async function judgeAndLearn(userId: string, topJobs: StoredJob[]): Promise<void> {
  const inFlight = (judging.rankerJudgingUsers ??= new Set<string>());
  if (inFlight.has(userId) || topJobs.length === 0 || !(await ollamaAvailable())) return;
  inFlight.add(userId);
  try {
    const profile = await searchProfileFor(userId);
    if (!profile) return;
    for (const job of await unjudged(userId, topJobs)) {
      const score = await judgeOne(profile, job);
      if (score === null) continue;
      await prisma.jobFeedback.upsert({
        where: { userId_jobId_signal: { userId, jobId: job.id, signal: "MODEL_JUDGED" } },
        create: { userId, jobId: job.id, signal: "MODEL_JUDGED", score },
        update: { score, createdAt: new Date() },
      });
    }
    const result = await retrainRanker(userId);
    console.log(`[ranker] ${result.trained ? "retrained" : "not enough feedback yet"}: ${result.samples} samples, ${result.positives} positive`);
  } catch (err) {
    console.warn("[ranker] judge-and-learn failed:", errorMessage(err));
  } finally {
    inFlight.delete(userId);
  }
}
