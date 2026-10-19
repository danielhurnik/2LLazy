import { z } from "zod";

export const FEATURE_NAMES = [
  "deterministic",
  "title",
  "keywords",
  "location",
  "seniority",
  "recency",
  "salary",
  "profileSkills",
  "profileTitle",
  "remote",
  "otherCity",
  "salaryListed",
  "descriptionLength",
  "embedding",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureVector = Record<FeatureName, number>;

export interface TrainingSample {
  features: FeatureVector;
  label: number;
  weight: number;
}

export const rankerModelSchema = z.object({
  featureNames: z.array(z.string()),
  mean: z.array(z.number()),
  std: z.array(z.number()),
  hiddenWeights: z.array(z.array(z.number())),
  hiddenBias: z.array(z.number()),
  outputWeights: z.array(z.number()),
  outputBias: z.number(),
  samples: z.number(),
  positives: z.number(),
  trainedAt: z.string(),
});

export type RankerModel = z.infer<typeof rankerModelSchema>;

const HIDDEN_UNITS = 6;
const EPOCHS = 400;
const LEARNING_RATE = 0.05;
const L2 = 0.001;
const MIN_SAMPLES = 8;
const MIN_PER_CLASS = 3;
const POSITIVE_THRESHOLD = 0.5;
const STD_FLOOR = 1e-6;
const MAX_RANKER_SHARE = 0.5;
const SAMPLES_FOR_FULL_SHARE = 200;
const SEED = 7;
const PERCENT = 100;
const MIN_REASON_DELTA_PERCENT = 2;

export const EMPTY_FEATURES: FeatureVector = Object.fromEntries(FEATURE_NAMES.map((name) => [name, 0])) as FeatureVector;

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function featureArray(features: FeatureVector, names: readonly string[] = FEATURE_NAMES): number[] {
  return names.map((name) => (name in features ? features[name as FeatureName] : 0));
}

function standardize(rows: number[][]): { mean: number[]; std: number[] } {
  const width = rows[0]?.length ?? 0;
  const mean = Array.from({ length: width }, (_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
  const std = Array.from({ length: width }, (_, i) =>
    Math.max(STD_FLOOR, Math.sqrt(rows.reduce((sum, row) => sum + (row[i] - mean[i]) ** 2, 0) / rows.length)),
  );
  return { mean, std };
}

function normalizeRow(row: number[], model: Pick<RankerModel, "mean" | "std">): number[] {
  return row.map((value, i) => (value - model.mean[i]) / model.std[i]);
}

function forward(input: number[], model: Pick<RankerModel, "hiddenWeights" | "hiddenBias" | "outputWeights" | "outputBias">) {
  const hidden = model.hiddenWeights.map((weights, h) => Math.tanh(weights.reduce((sum, w, i) => sum + w * input[i], model.hiddenBias[h])));
  const output = sigmoid(hidden.reduce((sum, value, h) => sum + value * model.outputWeights[h], model.outputBias));
  return { hidden, output };
}

export function canTrain(samples: TrainingSample[]): boolean {
  const positives = samples.filter((sample) => sample.label >= POSITIVE_THRESHOLD).length;
  return samples.length >= MIN_SAMPLES && positives >= MIN_PER_CLASS && samples.length - positives >= MIN_PER_CLASS;
}

export function trainRanker(samples: TrainingSample[], now = new Date()): RankerModel | null {
  if (!canTrain(samples)) return null;
  const rows = samples.map((sample) => featureArray(sample.features));
  const { mean, std } = standardize(rows);
  const inputs = rows.map((row) => normalizeRow(row, { mean, std }));
  const random = seededRandom(SEED);
  const width = FEATURE_NAMES.length;
  const hiddenWeights = Array.from({ length: HIDDEN_UNITS }, () => Array.from({ length: width }, () => (random() - 0.5) * 0.5));
  const hiddenBias = Array.from({ length: HIDDEN_UNITS }, () => 0);
  const outputWeights = Array.from({ length: HIDDEN_UNITS }, () => (random() - 0.5) * 0.5);
  let outputBias = 0;
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0);

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    samples.forEach((sample, index) => {
      const input = inputs[index];
      const { hidden, output } = forward(input, { hiddenWeights, hiddenBias, outputWeights, outputBias });
      const gradient = ((output - sample.label) * sample.weight * samples.length) / totalWeight;
      for (let h = 0; h < HIDDEN_UNITS; h++) {
        const hiddenGradient = gradient * outputWeights[h] * (1 - hidden[h] ** 2);
        outputWeights[h] -= LEARNING_RATE * (gradient * hidden[h] + L2 * outputWeights[h]);
        for (let i = 0; i < width; i++) {
          hiddenWeights[h][i] -= LEARNING_RATE * (hiddenGradient * input[i] + L2 * hiddenWeights[h][i]);
        }
        hiddenBias[h] -= LEARNING_RATE * hiddenGradient;
      }
      outputBias -= LEARNING_RATE * gradient;
    });
  }

  return {
    featureNames: [...FEATURE_NAMES],
    mean,
    std,
    hiddenWeights,
    hiddenBias,
    outputWeights,
    outputBias,
    samples: samples.length,
    positives: samples.filter((sample) => sample.label >= POSITIVE_THRESHOLD).length,
    trainedAt: now.toISOString(),
  };
}

export function predictFit(model: RankerModel, features: FeatureVector): number {
  const input = normalizeRow(featureArray(features, model.featureNames), model);
  return forward(input, model).output;
}

export function rankerShare(model: RankerModel): number {
  return Math.min(MAX_RANKER_SHARE, model.samples / SAMPLES_FOR_FULL_SHARE);
}

export function blendWithRanker(score: number, model: RankerModel, features: FeatureVector): { score: number; reason?: string } {
  const share = rankerShare(model);
  const fit = predictFit(model, features);
  const blended = score * (1 - share) + fit * share;
  const deltaPercent = Math.round((blended - score) * PERCENT);
  const reason =
    Math.abs(deltaPercent) >= MIN_REASON_DELTA_PERCENT
      ? `Learned from your feedback (${deltaPercent > 0 ? "+" : ""}${deltaPercent} %)`
      : undefined;
  return { score: Math.round(blended * 1000) / 1000, reason };
}

export function parseRankerModel(raw: unknown): RankerModel | null {
  const parsed = rankerModelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
