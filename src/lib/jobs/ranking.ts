import { prisma } from "@/lib/prisma";
import { cosine, embedText, profileText } from "./embeddings";
import { searchProfileSchema, type SearchProfile } from "./profile";
import { blendWithRanker, parseRankerModel, type FeatureVector, type RankerModel } from "./ranker";
import type { ScoredJob } from "./score";

export interface RankingContext {
  profile: SearchProfile | null;
  ranker: RankerModel | null;
  dismissed: Set<string>;
  profileVector: number[] | null;
}

export interface RankedJob {
  score: number;
  reasons: string[];
  features: FeatureVector;
}

export async function rankingContextFor(userId: string): Promise<RankingContext> {
  const [row, dismissedRows] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId }, select: { searchProfile: true, rankerModel: true } }),
    prisma.jobFeedback.findMany({ where: { userId, signal: "DISMISSED" }, select: { jobId: true } }),
  ]);
  const parsedProfile = searchProfileSchema.safeParse(row?.searchProfile);
  const profile = parsedProfile.success ? parsedProfile.data : null;
  const ranker = parseRankerModel(row?.rankerModel);
  const profileVector = profile && ranker ? await embedText(profileText(profile)) : null;
  return { profile, ranker, dismissed: new Set(dismissedRows.map((feedback) => feedback.jobId)), profileVector };
}

export function similarityFeature(context: Pick<RankingContext, "profileVector">, vector: number[] | undefined): number {
  return context.profileVector && vector ? Math.max(0, cosine(context.profileVector, vector)) : 0;
}

export function rankWithFeedback(context: RankingContext, scored: ScoredJob, vector: number[] | undefined): RankedJob {
  const features: FeatureVector = { ...scored.features, embedding: similarityFeature(context, vector) };
  if (!context.ranker || scored.rejectedBy) return { score: scored.score, reasons: scored.reasons, features };
  const blended = blendWithRanker(scored.score, context.ranker, features);
  return { score: blended.score, reasons: blended.reason ? [...scored.reasons, blended.reason] : scored.reasons, features };
}
