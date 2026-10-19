import { describe, it, expect } from "vitest";
import {
  EMPTY_FEATURES,
  blendWithRanker,
  canTrain,
  parseRankerModel,
  predictFit,
  rankerShare,
  trainRanker,
  type FeatureVector,
  type TrainingSample,
} from "@/lib/jobs/ranker";

const features = (overrides: Partial<FeatureVector>): FeatureVector => ({ ...EMPTY_FEATURES, ...overrides });

function likesRemoteSeniorReact(count: number): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (let i = 0; i < count; i++) {
    const noise = (i % 5) / 50;
    samples.push({ features: features({ deterministic: 0.6 + noise, remote: 1, profileSkills: 0.8, seniority: 1, embedding: 0.7 }), label: 1, weight: 1 });
    samples.push({ features: features({ deterministic: 0.6 + noise, remote: 0, profileSkills: 0.1, seniority: 0, otherCity: 1, embedding: 0.2 }), label: 0, weight: 1 });
  }
  return samples;
}

describe("ranker", () => {
  it("refuses to train on too few or one-sided samples", () => {
    expect(canTrain([])).toBe(false);
    expect(trainRanker(likesRemoteSeniorReact(2))).toBeNull();
    const onlyPositives = likesRemoteSeniorReact(10).filter((sample) => sample.label === 1);
    expect(canTrain(onlyPositives)).toBe(false);
  });

  it("learns the user's preference from feedback and scores unseen jobs accordingly", () => {
    const model = trainRanker(likesRemoteSeniorReact(10));
    expect(model).not.toBeNull();
    if (!model) return;
    const liked = predictFit(model, features({ deterministic: 0.62, remote: 1, profileSkills: 0.9, seniority: 1, embedding: 0.65 }));
    const disliked = predictFit(model, features({ deterministic: 0.62, remote: 0, profileSkills: 0.0, seniority: 0, otherCity: 1, embedding: 0.15 }));
    expect(liked).toBeGreaterThan(0.8);
    expect(disliked).toBeLessThan(0.2);
  });

  it("blends gently while there is little feedback and explains the change", () => {
    const model = trainRanker(likesRemoteSeniorReact(10));
    if (!model) throw new Error("model expected");
    expect(rankerShare(model)).toBeCloseTo(0.1, 5);
    const boosted = blendWithRanker(0.5, model, features({ deterministic: 0.5, remote: 1, profileSkills: 0.9, seniority: 1, embedding: 0.7 }));
    expect(boosted.score).toBeGreaterThan(0.5);
    expect(boosted.reason).toMatch(/^Learned from your feedback \(\+\d+ %\)$/);
    const demoted = blendWithRanker(0.5, model, features({ deterministic: 0.5, otherCity: 1, embedding: 0.1 }));
    expect(demoted.score).toBeLessThan(0.5);
  });

  it("survives a JSON round trip and rejects garbage", () => {
    const model = trainRanker(likesRemoteSeniorReact(10));
    const restored = parseRankerModel(JSON.parse(JSON.stringify(model)));
    expect(restored).toEqual(model);
    expect(parseRankerModel({ hello: "world" })).toBeNull();
  });
});
