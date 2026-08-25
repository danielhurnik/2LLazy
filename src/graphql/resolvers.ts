import { prisma } from "@/lib/prisma";
import { readCvText } from "@/lib/cv";
import { composeCoverLetter } from "@/lib/coverLetter";
import { ApplicationStatus } from "@prisma/client";
import { revalidateTag, revalidatePath } from "next/cache";
import { favouriteTag } from "@/lib/data/favourites";
import { interviewTag } from "@/lib/data/interviews";
import { applicationTag } from "@/lib/data/applications";

export interface GqlContext {
  userId: string;
}

export const resolvers = {
  Query: {
    searchJobs: async (
      _: unknown,
      { query, skillLevel = "", limit = 20 }: { query: string; skillLevel?: string; limit?: number },
      { userId }: GqlContext
    ) => {
      // Postgres full-text over the cached postings. The `'simple'` dictionary
      // is deliberate: the cache holds Czech, Polish, German and English side
      // by side, and English stemming mangles the rest. Ranking happens in SQL
      // so this resolver stays a thin read path — the richer lexical scorer in
      // src/lib/matching runs on the live scrape route instead.
      const text = `${query} ${skillLevel}`.trim();
      const take = Math.min(Math.max(limit ?? 20, 1), 100);

      const rows = await prisma.$queryRaw<Array<{
        id: string; title: string; company: string; location: string | null;
        sourceUrl: string; source: string; salary: string | null;
        postedAt: Date | null; scrapedAt: Date; description: string;
        country: string | null; rank: number;
      }>>`
        SELECT id, title, company, location, "sourceUrl", source, salary,
               "postedAt", "scrapedAt", description, country,
               ts_rank(
                 to_tsvector('simple',
                   coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(description, '')),
                 plainto_tsquery('simple', ${text})
               ) AS rank
        FROM "JobPosting"
        WHERE to_tsvector('simple',
                coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(description, '')
              ) @@ plainto_tsquery('simple', ${text})
        ORDER BY rank DESC, "scrapedAt" DESC
        LIMIT ${take}
      `;

      const favouritedIds = new Set(
        (await prisma.userFavourite.findMany({ where: { userId }, select: { jobId: true } }))
          .map((f) => f.jobId)
      );

      // ts_rank is unbounded in principle but rarely exceeds ~1 in practice;
      // normalise against the top hit so the UI's 0–1 contract holds.
      const topRank = rows.length > 0 ? Math.max(...rows.map((r) => Number(r.rank))) : 0;

      return rows.map((row) => {
        const score = topRank > 0 ? Number(row.rank) / topRank : 0;
        return {
          ...row,
          postedAt: row.postedAt?.toISOString() ?? null,
          scrapedAt: row.scrapedAt.toISOString(),
          favourited: favouritedIds.has(row.id),
          score,
          similarity: score,
        };
      });
    },

    getFavourites: async (
      _: unknown,
      __: unknown,
      { userId }: GqlContext
    ) => {
      const jobs = await prisma.jobPosting.findMany({
        where: { favouritedBy: { some: { userId } } },
        orderBy: { scrapedAt: "desc" },
      });
      return jobs.map((job) => ({
        ...job,
        favourited: true,
        postedAt: job.postedAt?.toISOString() ?? null,
        scrapedAt: job.scrapedAt.toISOString(),
      }));
    },

    getApplications: async (
      _: unknown,
      { status }: { status?: ApplicationStatus },
      { userId }: GqlContext
    ) => {
      return prisma.application.findMany({
        where: { userId, ...(status ? { status } : {}) },
        include: { job: true, coverLetter: true, interview: true },
        orderBy: { createdAt: "desc" },
      });
    },

    getApplication: async (
      _: unknown,
      { id }: { id: string },
      { userId }: GqlContext
    ) => {
      return prisma.application.findFirst({
        where: { id, userId },
        include: { job: true, coverLetter: true, interview: true },
      });
    },

    getInterviews: async (
      _: unknown,
      { month, year }: { month: number; year: number },
      { userId }: GqlContext
    ) => {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      return prisma.interview.findMany({
        where: {
          scheduledAt: { gte: start, lt: end },
          application: { userId },
        },
        include: { application: { include: { job: true } } },
        orderBy: { scheduledAt: "asc" },
      });
    },

    getCoverLetter: async (
      _: unknown,
      { id }: { id: string },
      { userId }: GqlContext
    ) => {
      return prisma.coverLetter.findFirst({ where: { id, userId } });
    },

    getUserProfile: async (
      _: unknown,
      __: unknown,
      { userId }: GqlContext
    ) => {
      return prisma.userProfile.findUnique({ where: { userId } });
    },

    /**
     * Scraping needs no credentials, so `ok` is always true. What is worth
     * reporting is which optional integrations are configured — the app works
     * without every one of them, just with fewer sources.
     */
    scraperHealth: async () => {
      const optionalIntegrations: string[] = [];
      if (process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()) {
        optionalIntegrations.push("Adzuna");
      }
      return {
        ok: true,
        playwrightEnabled: process.env.PLAYWRIGHT_ENABLED === "true",
        optionalIntegrations,
      };
    },
  },

  Mutation: {
    toggleFavourite: async (
      _: unknown,
      { jobId }: { jobId: string },
      { userId }: GqlContext
    ) => {
      const existing = await prisma.userFavourite.findUnique({
        where: { userId_jobId: { userId, jobId } },
      });
      if (existing) {
        await prisma.userFavourite.delete({ where: { userId_jobId: { userId, jobId } } });
      } else {
        await prisma.userFavourite.create({ data: { userId, jobId } });
      }
      const job = await prisma.jobPosting.findUniqueOrThrow({ where: { id: jobId } });
      revalidateTag(favouriteTag(userId), "default");
      revalidatePath("/favourites");
      return {
        ...job,
        favourited: !existing,
        postedAt: job.postedAt?.toISOString() ?? null,
        scrapedAt: job.scrapedAt.toISOString(),
      };
    },

    updateApplicationStatus: async (
      _: unknown,
      { id, status }: { id: string; status: ApplicationStatus },
      { userId }: GqlContext
    ) => {
      return prisma.application.update({
        where: { id, userId },
        data: { status },
        include: { job: true, coverLetter: true, interview: true },
      });
    },

    scheduleInterview: async (
      _: unknown,
      {
        applicationId,
        scheduledAt,
        durationMinutes = 60,
        timezone = "UTC",
        notes,
      }: {
        applicationId: string;
        scheduledAt: string;
        durationMinutes?: number;
        timezone?: string;
        notes?: string;
      },
      { userId }: GqlContext
    ) => {
      const [, interview] = await prisma.$transaction([
        prisma.application.update({
          where: { id: applicationId, userId },
          data: { status: "INTERVIEW" },
        }),
        prisma.interview.upsert({
          where: { applicationId },
          create: {
            applicationId,
            scheduledAt: new Date(scheduledAt),
            durationMinutes,
            timezone,
            notes,
          },
          update: {
            scheduledAt: new Date(scheduledAt),
            durationMinutes,
            timezone,
            notes,
          },
        }),
      ]);
      revalidateTag(interviewTag(userId), "default");
      revalidateTag(applicationTag(userId), "default");
      revalidatePath("/interviews");
      revalidatePath("/dashboard");
      return interview;
    },

    updateInterview: async (
      _: unknown,
      {
        id,
        scheduledAt,
        durationMinutes,
        notes,
      }: {
        id: string;
        scheduledAt?: string;
        durationMinutes?: number;
        notes?: string;
      },
      { userId }: GqlContext
    ) => {
      // Verify the interview belongs to the user
      const interview = await prisma.interview.findFirst({
        where: { id, application: { userId } },
      });
      if (!interview) throw new Error("Not found");
      const updated = await prisma.interview.update({
        where: { id },
        data: {
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt) } : {}),
          ...(durationMinutes !== undefined ? { durationMinutes } : {}),
          ...(notes !== undefined ? { notes } : {}),
        },
      });
      revalidateTag(interviewTag(userId), "default");
      revalidatePath("/interviews");
      return updated;
    },

    generateCoverLetter: async (
      _: unknown,
      { jobId, useSavedCV = true }: { jobId: string; useSavedCV?: boolean },
      { userId }: GqlContext
    ) => {
      const job = await prisma.jobPosting.findUniqueOrThrow({ where: { id: jobId } });

      let cvText = "";
      if (useSavedCV) {
        cvText = await readCvText(userId).catch(() => "");
      }

      const userProfile = await prisma.userProfile.findUnique({
        where: { userId },
        select: { coverLetterLanguage: true },
      });
      const language = userProfile?.coverLetterLanguage ?? "English";

      const { content } = composeCoverLetter({
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        cvText,
        language,
      });

      const [coverLetter] = await prisma.$transaction([
        prisma.coverLetter.create({
          data: { userId, jobId, content, generatedFromTemplate: true },
        }),
        prisma.userFavourite.upsert({
          where: { userId_jobId: { userId, jobId } },
          create: { userId, jobId },
          update: {},
        }),
      ]);
      revalidateTag(favouriteTag(userId), "default");
      revalidatePath("/favourites");
      return coverLetter;
    },

    deleteCoverLetter: async (
      _: unknown,
      { id }: { id: string },
      { userId }: GqlContext
    ) => {
      const cl = await prisma.coverLetter.findUnique({ where: { id } });
      // If it doesn't exist at all, treat as already deleted (idempotent)
      if (!cl) {
        revalidateTag(applicationTag(userId), "default");
        return true;
      }
      // Ownership check
      if (cl.userId !== userId) throw new Error("Not found");
      await prisma.application.updateMany({
        where: { coverLetterId: id, userId },
        data: { coverLetterId: null },
      });
      await prisma.coverLetter.delete({ where: { id } });
      revalidateTag(applicationTag(userId), "default");
      return true;
    },

    saveUserProfile: async (
      _: unknown,
      args: {
        name: string;
        email: string;
        phone?: string;
        linkedInUrl?: string;
        githubUrl?: string;
      },
      { userId }: GqlContext
    ) => {
      return prisma.userProfile.upsert({
        where: { userId },
        update: args,
        create: { userId, ...args },
      });
    },
  },
};
