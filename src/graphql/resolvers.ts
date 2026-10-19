import { prisma } from "@/lib/prisma";
import { resolveIntent } from "@/lib/jobs/intent";
import { storedToNormalized } from "@/lib/jobs/pipeline";
import { favouriteIdsFor, searchRecent } from "@/lib/jobs/repo";
import { SCORE_THRESHOLD, scoreJob, type ScoreRequest } from "@/lib/jobs/score";
import { DEFAULT_COUNTRY } from "@/lib/jobs/sources/types";
import type { ApplicationStatus } from "@prisma/client";
import { GraphQLError } from "graphql";
import { revalidatePath, revalidateTag } from "next/cache";
import { favouriteTag, toggleUserFavourite } from "@/lib/data/favourites";
import { interviewTag } from "@/lib/data/interviews";
import { applicationTag } from "@/lib/data/applications";

export interface GqlContext {
  userId: string;
}

interface SerializableJob {
  postedAt: Date | null;
  scrapedAt: Date;
}

interface SearchJobsArgs {
  query: string;
  skillLevel?: string;
  limit?: number;
}

interface ScheduleInterviewArgs {
  applicationId: string;
  scheduledAt: string;
  durationMinutes?: number;
  timezone?: string;
  notes?: string;
}

interface UpdateInterviewArgs {
  id: string;
  scheduledAt?: string | null;
  durationMinutes?: number;
  notes?: string;
}

interface UserProfileArgs {
  name: string;
  email: string;
  phone?: string;
  linkedInUrl?: string;
  githubUrl?: string;
}

const DEFAULT_SEARCH_LIMIT = 20;
const SEARCH_WINDOW_DAYS = 60;
const SEARCH_CANDIDATE_POOL = 300;
const DEFAULT_INTERVIEW_MINUTES = 60;
const DEFAULT_TIMEZONE = "UTC";
const EXPIRE_IMMEDIATELY = { expire: 0 };
const APPLICATION_WITH_JOB_AND_INTERVIEW = { job: true, interview: true } as const;

function expireTags(...tags: string[]): void {
  for (const tag of tags) revalidateTag(tag, EXPIRE_IMMEDIATELY);
}

function serializeJob<T extends SerializableJob>(job: T, favourited: boolean) {
  return {
    ...job,
    favourited,
    postedAt: job.postedAt?.toISOString() ?? null,
    scrapedAt: job.scrapedAt.toISOString(),
  };
}

function parseDateTime(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new GraphQLError(`${field} is not a valid date`);
  return date;
}

function monthRange(year: number, month: number): { gte: Date; lt: Date } {
  return { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
}

async function findOwnedInterview(id: string, userId: string) {
  const interview = await prisma.interview.findFirst({ where: { id, application: { userId } } });
  if (!interview) throw new GraphQLError("Not found");
  return interview;
}

export const resolvers = {
  Query: {
    searchJobs: async (
      _: unknown,
      { query, skillLevel = "", limit = DEFAULT_SEARCH_LIMIT }: SearchJobsArgs,
      { userId }: GqlContext,
    ) => {
      const intent = resolveIntent(query);
      const [rows, favouriteIds] = await Promise.all([
        searchRecent({
          titleTerms: [query, intent.scrapingKeyword, ...intent.includedTitles],
          query,
          days: SEARCH_WINDOW_DAYS,
          limit: SEARCH_CANDIDATE_POOL,
        }),
        favouriteIdsFor(userId),
      ]);
      const scoreRequest: ScoreRequest = { query, skillLevel, city: "", intent, salaryMin: null, salaryMax: null };

      return rows
        .map((row) => {
          const scored = scoreJob(scoreRequest, storedToNormalized(row, DEFAULT_COUNTRY), row.firstSeenAt);
          return {
            ...serializeJob(row, favouriteIds.has(row.id)),
            similarity: scored.score,
            matchReasons: scored.reasons,
          };
        })
        .filter((job) => job.similarity >= SCORE_THRESHOLD)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    },

    getFavourites: async (_: unknown, __: unknown, { userId }: GqlContext) => {
      const jobs = await prisma.jobPosting.findMany({
        where: { favouritedBy: { some: { userId } } },
        orderBy: { scrapedAt: "desc" },
      });
      return jobs.map((job) => serializeJob(job, true));
    },

    getApplications: async (
      _: unknown,
      { status }: { status?: ApplicationStatus | null },
      { userId }: GqlContext,
    ) =>
      prisma.application.findMany({
        where: { userId, status: status ?? undefined },
        include: APPLICATION_WITH_JOB_AND_INTERVIEW,
        orderBy: { createdAt: "desc" },
      }),

    getApplication: async (_: unknown, { id }: { id: string }, { userId }: GqlContext) =>
      prisma.application.findFirst({
        where: { id, userId },
        include: APPLICATION_WITH_JOB_AND_INTERVIEW,
      }),

    getInterviews: async (
      _: unknown,
      { month, year }: { month: number; year: number },
      { userId }: GqlContext,
    ) =>
      prisma.interview.findMany({
        where: { scheduledAt: monthRange(year, month), application: { userId } },
        include: { application: { include: { job: true } } },
        orderBy: { scheduledAt: "asc" },
      }),

    getUserProfile: async (_: unknown, __: unknown, { userId }: GqlContext) =>
      prisma.userProfile.findUnique({ where: { userId } }),
  },

  Mutation: {
    toggleFavourite: async (_: unknown, { jobId }: { jobId: string }, { userId }: GqlContext) => {
      const job = await prisma.jobPosting.findUniqueOrThrow({ where: { id: jobId } });
      const isFavourited = await toggleUserFavourite(userId, jobId);
      expireTags(favouriteTag(userId));
      revalidatePath("/favourites");
      return serializeJob(job, isFavourited);
    },

    updateApplicationStatus: async (
      _: unknown,
      { id, status }: { id: string; status: ApplicationStatus },
      { userId }: GqlContext,
    ) =>
      prisma.application.update({
        where: { id, userId },
        data: { status },
        include: APPLICATION_WITH_JOB_AND_INTERVIEW,
      }),

    scheduleInterview: async (
      _: unknown,
      {
        applicationId,
        scheduledAt,
        durationMinutes = DEFAULT_INTERVIEW_MINUTES,
        timezone = DEFAULT_TIMEZONE,
        notes,
      }: ScheduleInterviewArgs,
      { userId }: GqlContext,
    ) => {
      const schedule = {
        scheduledAt: parseDateTime(scheduledAt, "scheduledAt"),
        durationMinutes,
        timezone,
        notes,
      };
      const [, interview] = await prisma.$transaction([
        prisma.application.update({
          where: { id: applicationId, userId },
          data: { status: "INTERVIEW" },
        }),
        prisma.interview.upsert({
          where: { applicationId },
          create: { applicationId, ...schedule },
          update: schedule,
        }),
      ]);
      expireTags(interviewTag(userId), applicationTag(userId));
      revalidatePath("/interviews");
      revalidatePath("/dashboard");
      return interview;
    },

    updateInterview: async (
      _: unknown,
      { id, scheduledAt, durationMinutes, notes }: UpdateInterviewArgs,
      { userId }: GqlContext,
    ) => {
      await findOwnedInterview(id, userId);
      const updated = await prisma.interview.update({
        where: { id },
        data: {
          scheduledAt: scheduledAt ? parseDateTime(scheduledAt, "scheduledAt") : undefined,
          durationMinutes,
          notes,
        },
      });
      expireTags(interviewTag(userId));
      revalidatePath("/interviews");
      return updated;
    },

    saveUserProfile: async (_: unknown, profile: UserProfileArgs, { userId }: GqlContext) =>
      prisma.userProfile.upsert({
        where: { userId },
        update: profile,
        create: { userId, ...profile },
      }),
  },
};
