import fs from "fs/promises";
import path from "path";
import { ollamaEmbed } from "@/lib/ollama";
import { isRecord } from "@/lib/guards";

export type VoiceLang = "cs" | "en";

export interface VoiceSample {
  lang: VoiceLang;
  text: string;
}

export interface VoiceConfig {
  owner: string;
  signature: string;
  tone: string[];
  limits: { minWords: number; maxWords: number; paragraphs: number };
  neverSay: string[];
  neverDo: string[];
  samples: VoiceSample[];
  calibration: { approvedSamplesNeeded: number };
}

export interface VoiceVerdict {
  ok: boolean;
  similarity: number | null;
  threshold: number | null;
}

const VOICE_FILE = path.resolve(process.cwd(), "config", "voice.json");
const VOICE_LOCAL_FILE = path.resolve(process.cwd(), "config", "voice.local.json");
const VOICE_CACHE_MS = 10_000;
const SIMILARITY_MARGIN = 0.08;
const SIMILARITY_FLOOR = 0.5;
const MIN_SAMPLES_FOR_GUARD = 2;
const MAX_SAMPLES_IN_PROMPT = 3;

const DEFAULT_VOICE: VoiceConfig = {
  owner: "Daniel",
  signature: "Daniel",
  tone: [],
  limits: { minWords: 40, maxWords: 80, paragraphs: 2 },
  neverSay: [],
  neverDo: [],
  samples: [],
  calibration: { approvedSamplesNeeded: 10 },
};

let cached: { at: number; config: VoiceConfig } | null = null;
const embeddingCache = new Map<string, number[]>();

function sampleOf(value: unknown): VoiceSample | null {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) return null;
  return { lang: value.lang === "en" ? "en" : "cs", text: value.text.trim() };
}

function parseVoice(raw: unknown): VoiceConfig {
  if (!isRecord(raw)) return DEFAULT_VOICE;
  const limits = isRecord(raw.limits) ? raw.limits : {};
  const calibration = isRecord(raw.calibration) ? raw.calibration : {};
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  return {
    owner: typeof raw.owner === "string" ? raw.owner : DEFAULT_VOICE.owner,
    signature: typeof raw.signature === "string" ? raw.signature : DEFAULT_VOICE.signature,
    tone: strings(raw.tone),
    limits: {
      minWords: typeof limits.minWords === "number" ? limits.minWords : DEFAULT_VOICE.limits.minWords,
      maxWords: typeof limits.maxWords === "number" ? limits.maxWords : DEFAULT_VOICE.limits.maxWords,
      paragraphs: typeof limits.paragraphs === "number" ? limits.paragraphs : DEFAULT_VOICE.limits.paragraphs,
    },
    neverSay: strings(raw.neverSay),
    neverDo: strings(raw.neverDo),
    samples: Array.isArray(raw.samples) ? raw.samples.map(sampleOf).filter((s): s is VoiceSample => s !== null) : [],
    calibration: {
      approvedSamplesNeeded:
        typeof calibration.approvedSamplesNeeded === "number" ? calibration.approvedSamplesNeeded : DEFAULT_VOICE.calibration.approvedSamplesNeeded,
    },
  };
}

async function readJsonRecord(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadVoice(): Promise<VoiceConfig> {
  if (cached && Date.now() - cached.at < VOICE_CACHE_MS) return cached.config;
  const shared = parseVoice(await readJsonRecord(VOICE_FILE));
  const personal = parseVoice(await readJsonRecord(VOICE_LOCAL_FILE));
  const config: VoiceConfig = {
    ...shared,
    tone: [...shared.tone, ...personal.tone],
    neverSay: [...new Set([...shared.neverSay, ...personal.neverSay])],
    samples: [...shared.samples, ...personal.samples],
  };
  cached = { at: Date.now(), config };
  return config;
}

export async function addVoiceSample(sample: VoiceSample): Promise<void> {
  const text = sample.text.trim();
  if (!text) return;
  const raw = await readJsonRecord(VOICE_LOCAL_FILE);
  const samples = Array.isArray(raw.samples) ? raw.samples.map(sampleOf).filter((s): s is VoiceSample => s !== null) : [];
  if (samples.some((s) => s.text === text)) return;
  samples.push({ lang: sample.lang, text });
  await fs.writeFile(VOICE_LOCAL_FILE, `${JSON.stringify({ ...raw, samples }, null, 2)}\n`);
  cached = null;
}

export function calibrationActive(config: VoiceConfig): boolean {
  return config.samples.length < config.calibration.approvedSamplesNeeded;
}

export function samplesForPrompt(config: VoiceConfig, lang: VoiceLang): VoiceSample[] {
  const pool = config.samples.filter((s) => s.lang === lang);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, MAX_SAMPLES_IN_PROMPT);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function centroid(vectors: number[][]): number[] {
  const size = vectors[0]?.length ?? 0;
  const sum = new Array<number>(size).fill(0);
  for (const vector of vectors) for (let i = 0; i < size; i += 1) sum[i] += vector[i] ?? 0;
  return sum.map((v) => v / Math.max(1, vectors.length));
}

export function thresholdFromSamples(vectors: number[][]): number {
  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) sims.push(cosine(vectors[i], vectors[j]));
  }
  if (sims.length === 0) return SIMILARITY_FLOOR;
  const mean = sims.reduce((s, v) => s + v, 0) / sims.length;
  return Math.max(SIMILARITY_FLOOR, mean - SIMILARITY_MARGIN);
}

async function embeddingsFor(texts: string[]): Promise<number[][]> {
  const missing = texts.filter((t) => !embeddingCache.has(t));
  if (missing.length > 0) {
    const vectors = await ollamaEmbed(missing);
    missing.forEach((text, i) => {
      if (vectors[i]) embeddingCache.set(text, vectors[i]);
    });
  }
  return texts.map((t) => embeddingCache.get(t) ?? []);
}

export async function voiceGuard(draft: string, lang: VoiceLang, config: VoiceConfig): Promise<VoiceVerdict> {
  const samples = config.samples.filter((s) => s.lang === lang).map((s) => s.text);
  if (samples.length < MIN_SAMPLES_FOR_GUARD) return { ok: true, similarity: null, threshold: null };
  try {
    const [draftVector, ...sampleVectors] = await embeddingsFor([draft, ...samples]);
    if (!draftVector.length || sampleVectors.some((v) => !v.length)) return { ok: true, similarity: null, threshold: null };
    const threshold = thresholdFromSamples(sampleVectors);
    const similarity = cosine(draftVector, centroid(sampleVectors));
    return { ok: similarity >= threshold, similarity: Number(similarity.toFixed(3)), threshold: Number(threshold.toFixed(3)) };
  } catch {
    return { ok: true, similarity: null, threshold: null };
  }
}
