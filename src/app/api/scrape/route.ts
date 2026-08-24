import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { detectCountry } from "@/lib/geo";
import { classifyQueryIntent, scoreJob, buildCorpusStats, RELEVANCE_THRESHOLD } from "@/lib/matching";
import { boardsForCountry } from "@/lib/scrapers/registry";
import { dedupeRepeatedText } from "@/lib/scrapers/parse/html";
import type { ScrapedJob, ScrapeQuery, Seniority } from "@/lib/scrapers/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// Simple in-memory rate limiter (per-IP, resets on server restart)
const rateMap = new Map<string, number>();
const RATE_LIMIT_MS = 10_000; // 10 seconds between requests per IP

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
/** How many cached postings the post-scrape pass may surface. */
const CACHE_RESULT_LIMIT = 80;
/** How many rows the cache query considers before ranking. */
const CACHE_CANDIDATE_LIMIT = 300;

interface JobPayload {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  source: string;
  salary?: string;
  workType?: string;
  postedAt?: Date;
  country?: string | null;
  favourited: boolean;
  /** 0–1 lexical relevance. Replaces the old cosine similarity. */
  score: number;
  /** Query terms found in the posting — shown to the user as "why this matched". */
  matched: string[];
  reasons: string[];
  isNew: boolean;
  isStale?: boolean;
}

type SSEEvent =
  | {
      type: "meta";
      country: string;
      countryName: string;
      detectedVia: string;
      boards: Array<{ id: string; name: string; homepage: string; remoteOnly: boolean }>;
    }
  | { type: "progress"; site: string; message: string }
  | { type: "job"; data: JobPayload }
  | { type: "scraperDone"; site: string; doneCount: number; total: number }
  | { type: "scrapersDone"; total: number }
  | { type: "complete"; total: number }
  | { type: "error"; site: string; message: string };

function sseChunk(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const SENIORITY_VALUES: Seniority[] = ["Junior", "Mid", "Senior", "Lead"];

function parseSeniority(input: unknown): Seniority | null {
  if (typeof input !== "string") return null;
  const found = SENIORITY_VALUES.find((s) => s.toLowerCase() === input.trim().toLowerCase());
  return found ?? null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.cause ? `${err.message} (cause: ${err.cause})` : err.message;
  }
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const userId = session.user.id;

  // Rate limiting
  // NOTE: x-forwarded-for is set by Netlify's CDN and trusted in this deployment.
  // On other infrastructure this header is spoofable — use a proxy-trusted IP extraction instead.
  const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
  const last = rateMap.get(ip) ?? 0;
  if (Date.now() - last < RATE_LIMIT_MS) {
    return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 });
  }
  rateMap.set(ip, Date.now());

  const body = await req.json().catch(() => ({}));
  const query: string = typeof body.query === "string" ? body.query.trim() : "";
  const skillLevel: string = typeof body.skillLevel === "string" ? body.skillLevel : "";
  const city: string = typeof body.city === "string" ? body.city.trim() : "";
  const deepSearch: boolean = body.deepSearch === true;
  const remoteOnly: boolean = body.remoteOnly === true;
  const salaryMin: number | null = typeof body.salaryMin === "number" ? body.salaryMin : null;
  const salaryMax: number | null = typeof body.salaryMax === "number" ? body.salaryMax : null;

  // A query with no alphanumeric content cannot match anything; rejecting it
  // here avoids running every board for a guaranteed-empty result.
  if (!query || !/[\p{L}\p{N}]/u.test(query)) {
    return new Response("Missing or unsearchable query", { status: 400 });
  }

  // Which country's job market are we searching? An explicit choice wins, then
  // the user's saved profile, then request geo headers, then Accept-Language.
  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { country: true, remoteOnly: true } })
    .catch(() => null);

  const detected = detectCountry({
    explicit: typeof body.country === "string" ? body.country : null,
    profile: profile?.country ?? null,
    headers: req.headers,
  });

  const intent = classifyQueryIntent(query, skillLevel);
  const seniority = parseSeniority(skillLevel) ?? intent.seniority;

  const boards = boardsForCountry(detected.country, { remoteOnly });

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const send = async (event: SSEEvent) => {
    await writer.write(encoder.encode(sseChunk(event)));
  };

  (async () => {
    try {
      await send({
        type: "meta",
        country: detected.country,
        countryName: detected.countryName,
        detectedVia: detected.via,
        boards: boards.map((b) => ({
          id: b.id,
          name: b.name,
          homepage: b.homepage,
          remoteOnly: b.remoteOnly,
        })),
      });

      if (boards.length === 0) {
        await send({
          type: "error",
          site: "Search",
          message: `No job boards are configured for ${detected.countryName}.`,
        });
        await send({ type: "complete", total: 0 });
        return;
      }

      const scrapeQuery: Omit<ScrapeQuery, "signal"> = {
        query,
        seniority,
        city,
        country: detected.country,
        deepSearch,
        remoteOnly,
        intent,
      };

      // Pre-load the user's favourites once; every emitted job needs the flag.
      const userFavouriteIds = new Set(
        (
          await prisma.userFavourite.findMany({ where: { userId }, select: { jobId: true } })
        ).map((f) => f.jobId),
      );

      // Dedupe across boards: two boards often syndicate the same posting.
      const emittedSourceUrls = new Set<string>();
      const emittedIds = new Set<string>();
      let doneCount = 0;

      const scoreContext = {
        city,
        country: detected.country,
        remoteOnly,
        salaryMin,
        salaryMax,
      };

      await Promise.allSettled(
        boards.map(async (board) => {
          await send({ type: "progress", site: board.name, message: `Searching ${board.name}…` });
          try {
            const jobs = await board.scrape({ ...scrapeQuery, signal: req.signal });
            if (jobs.length === 0) return;

            // IDF over this board's own result set: a term that appears in every
            // posting on the board tells us nothing, one that appears in three
            // tells us a lot.
            const stats = buildCorpusStats(jobs.map((j) => `${j.title} ${j.description}`));

            await send({
              type: "progress",
              site: board.name,
              message: `Ranking ${jobs.length} results from ${board.name}…`,
            });

            for (let i = 0; i < jobs.length; i += 8) {
              await Promise.allSettled(
                jobs.slice(i, i + 8).map(async (job) => {
                  if (emittedSourceUrls.has(job.sourceUrl)) return;

                  const cleaned = cleanJob(job);
                  const result = scoreJob(cleaned, intent, { ...scoreContext, ...stats });
                  if (result.score < RELEVANCE_THRESHOLD) return;

                  try {
                    const saved = await persistJob(cleaned, detected.country);
                    if (emittedSourceUrls.has(job.sourceUrl)) return;
                    emittedSourceUrls.add(job.sourceUrl);
                    emittedIds.add(saved.id);

                    await send({
                      type: "job",
                      data: {
                        id: saved.id,
                        title: saved.title,
                        company: saved.company,
                        location: saved.location ?? "",
                        description: saved.description,
                        sourceUrl: saved.sourceUrl,
                        source: saved.source,
                        salary: saved.salary ?? undefined,
                        workType: saved.workType ?? undefined,
                        postedAt: saved.postedAt ?? undefined,
                        country: saved.country,
                        favourited: userFavouriteIds.has(saved.id),
                        score: result.score,
                        matched: result.matched,
                        reasons: result.reasons,
                        isNew: saved.firstSeenAt.getTime() > Date.now() - TWENTY_FOUR_HOURS,
                      },
                    });
                  } catch (err) {
                    console.error(`[scrape] Failed to save job ${job.sourceUrl}:`, err);
                  }
                }),
              );
            }
          } catch (err) {
            console.error(`[scrape] ${board.name} error:`, err);
            await send({ type: "error", site: board.name, message: errorMessage(err) });
          } finally {
            doneCount++;
            await send({
              type: "scraperDone",
              site: board.name,
              doneCount,
              total: boards.length,
            });
          }
        }),
      );

      await send({ type: "scrapersDone", total: emittedIds.size });

      // ── Surface cached postings the live pass did not re-scrape ────────────
      // Postgres full-text narrows hundreds of thousands of rows to a few
      // hundred candidates; the same lexical ranker then scores them, so a
      // cached hit and a fresh hit are ranked on identical terms.
      try {
        await send({ type: "progress", site: "Cache", message: "Checking previously found jobs…" });
        const cached = await loadCachedCandidates(query, intent.scrapingKeyword, detected.country);

        const fresh = cached.filter(
          (row) => !emittedIds.has(row.id) && !emittedSourceUrls.has(row.sourceUrl),
        );
        const stats = buildCorpusStats(fresh.map((r) => `${r.title} ${r.description}`));

        const ranked = fresh
          .map((row) => ({ row, result: scoreJob(row, intent, { ...scoreContext, ...stats }) }))
          .filter(({ result }) => result.score >= RELEVANCE_THRESHOLD)
          .sort((a, b) => b.result.score - a.result.score)
          .slice(0, CACHE_RESULT_LIMIT);

        for (const { row, result } of ranked) {
          emittedSourceUrls.add(row.sourceUrl);
          emittedIds.add(row.id);
          await send({
            type: "job",
            data: {
              id: row.id,
              title: row.title,
              company: row.company,
              location: row.location ?? "",
              description: row.description,
              sourceUrl: row.sourceUrl,
              source: row.source,
              salary: row.salary ?? undefined,
              workType: row.workType ?? undefined,
              postedAt: row.postedAt ?? undefined,
              country: row.country,
              favourited: userFavouriteIds.has(row.id),
              score: result.score,
              matched: result.matched,
              reasons: result.reasons,
              isNew: false,
              isStale: true,
            },
          });
        }
      } catch (err) {
        console.error("[scrape] Cache surfacing failed:", err);
      }

      await send({ type: "complete", total: emittedIds.size });
    } catch (err) {
      await send({ type: "error", site: "Search", message: errorMessage(err) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Board output arrives with scraping artefacts; normalise before it is stored. */
function cleanJob(job: ScrapedJob): ScrapedJob {
  return {
    ...job,
    title: dedupeRepeatedText(job.title).trim(),
    company: dedupeRepeatedText(job.company).trim(),
    location: dedupeRepeatedText(job.location ?? "").trim(),
  };
}

/**
 * Upsert by `sourceUrl`. `firstSeenAt` is deliberately never updated so the
 * "new" badge keeps meaning "first appeared in the last 24 hours".
 */
async function persistJob(job: ScrapedJob, searchCountry: string) {
  const data = {
    title: job.title,
    company: job.company || "Unknown",
    location: job.location || null,
    country: job.country ?? searchCountry,
    description: job.description,
    source: job.source,
    salary: job.salary ?? null,
    workType: job.workType || null,
    postedAt: job.postedAt ?? null,
    scrapedAt: new Date(),
  };

  return prisma.jobPosting.upsert({
    where: { sourceUrl: job.sourceUrl },
    create: { ...data, sourceUrl: job.sourceUrl },
    update: data,
  });
}

interface CachedRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string;
  sourceUrl: string;
  source: string;
  salary: string | null;
  workType: string | null;
  postedAt: Date | null;
  country: string | null;
  firstSeenAt: Date;
}

/**
 * Candidate cached postings for this search.
 *
 * Uses the `'simple'` text-search configuration (not `'english'`) because the
 * cache holds postings in Czech, Polish, German and English side by side and
 * English stemming mangles the rest. Postings for the searched country come
 * first, but worldwide-remote rows are kept too.
 */
async function loadCachedCandidates(
  query: string,
  keyword: string,
  country: string,
): Promise<CachedRow[]> {
  const searchText = `${query} ${keyword}`.trim();
  return prisma.$queryRaw<CachedRow[]>`
    SELECT id, title, company, location, description, "sourceUrl", source,
           salary, "workType", "postedAt", country, "firstSeenAt"
    FROM "JobPosting"
    WHERE to_tsvector('simple',
            coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(description, '')
          ) @@ plainto_tsquery('simple', ${searchText})
    ORDER BY (country = ${country}) DESC, "scrapedAt" DESC
    LIMIT ${CACHE_CANDIDATE_LIMIT}
  `;
}
