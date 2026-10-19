import { errorMessage } from "@/lib/guards";
import { ollamaAvailable, ollamaEmbed } from "@/lib/ollama";
import { prisma } from "@/lib/prisma";
import { MS_PER_MINUTE } from "@/lib/time";
import type { SearchProfile } from "./profile";

const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const MAX_EMBED_CHARS = 1500;
const EMBED_BATCH_SIZE = 16;
const AVAILABILITY_TTL_MS = MS_PER_MINUTE;

export interface EmbeddableJob {
  id: string;
  title: string;
  company: string;
  description: string;
}

const availability = globalThis as typeof globalThis & { ollamaEmbeddingCheck?: { at: number; available: boolean } };

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

export function jobText(job: Pick<EmbeddableJob, "title" | "company" | "description">): string {
  return `${job.title}\n${job.company}\n${job.description}`.slice(0, MAX_EMBED_CHARS);
}

export function profileText(profile: SearchProfile): string {
  return [profile.titles.join(", "), profile.skills.join(", "), profile.summary].filter(Boolean).join("\n").slice(0, MAX_EMBED_CHARS);
}

async function embeddingsAvailable(): Promise<boolean> {
  const cached = availability.ollamaEmbeddingCheck;
  if (cached && Date.now() - cached.at < AVAILABILITY_TTL_MS) return cached.available;
  const available = await ollamaAvailable();
  availability.ollamaEmbeddingCheck = { at: Date.now(), available };
  return available;
}

export async function embedText(text: string): Promise<number[] | null> {
  if (!text.trim() || !(await embeddingsAvailable())) return null;
  try {
    return (await ollamaEmbed(text, EMBED_MODEL))[0] ?? null;
  } catch (err) {
    console.warn("[embeddings] embed failed:", errorMessage(err));
    return null;
  }
}

async function storeBatch(batch: EmbeddableJob[], vectors: number[][], into: Map<string, number[]>): Promise<void> {
  await Promise.all(
    batch.map(async (job, index) => {
      const vector = vectors[index];
      if (!vector) return;
      await prisma.jobEmbedding.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, vector, model: EMBED_MODEL },
        update: { vector, model: EMBED_MODEL },
      });
      into.set(job.id, vector);
    }),
  );
}

export async function embeddingsFor(jobs: EmbeddableJob[]): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  if (jobs.length === 0) return vectors;
  const cached = await prisma.jobEmbedding.findMany({
    where: { jobId: { in: jobs.map((job) => job.id) }, model: EMBED_MODEL },
    select: { jobId: true, vector: true },
  });
  for (const row of cached) vectors.set(row.jobId, row.vector);
  const missing = jobs.filter((job) => !vectors.has(job.id));
  if (missing.length === 0 || !(await embeddingsAvailable())) return vectors;
  for (let start = 0; start < missing.length; start += EMBED_BATCH_SIZE) {
    const batch = missing.slice(start, start + EMBED_BATCH_SIZE);
    try {
      await storeBatch(batch, await ollamaEmbed(batch.map(jobText), EMBED_MODEL), vectors);
    } catch (err) {
      console.warn("[embeddings] batch failed:", errorMessage(err));
      break;
    }
  }
  return vectors;
}
