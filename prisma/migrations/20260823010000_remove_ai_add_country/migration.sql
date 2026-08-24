-- ═════════════════════════════════════════════════════════════════════════════
-- remove_ai_add_country
--
-- 2LLazy no longer uses OpenAI for anything. Job ranking is now deterministic
-- and lexical (BM25-style scoring over a skill taxonomy), extraction is done by
-- parsing schema.org JobPosting markup, and cover letters are composed from a
-- template. At the same time the app stops being Czech-only: boards are picked
-- per ISO 3166-1 alpha-2 country code.
--
-- This migration therefore:
--   1. removes every pgvector-backed column and the RoleProfile table;
--   2. turns the "JobSource" enum into a plain TEXT column so that adding a job
--      board is a code change, not a migration;
--   3. adds country awareness to JobPosting and UserProfile;
--   4. adds the indexes lexical search needs (full-text + trigram) in place of
--      the vector similarity search that is going away;
--   5. renames CoverLetter."generatedByAI" to "generatedFromTemplate".
--
-- DATA LOSS: dropping JobPosting."embedding" and the "RoleProfile" table
-- destroys data, and that is intended. Both held nothing but derived cache —
-- embeddings recomputed from the posting text, and role descriptions that live
-- in source control as a static taxonomy. No user-authored data is dropped
-- anywhere in this file: the CoverLetter column is RENAMED, not recreated.
--
-- The `vector` extension itself is deliberately NOT dropped. Other databases or
-- schemas on the same server may depend on it, and leaving an unused extension
-- installed costs nothing.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Drop the pgvector dependency ──────────────────────────────────────────

-- Legacy index from the original JSONB-embedding schema. Dropping the column
-- would take it with it, but be explicit in case an older database still has it.
DROP INDEX IF EXISTS "job_posting_embedding_idx";

ALTER TABLE "JobPosting" DROP COLUMN IF EXISTS "embedding";

-- RoleProfile existed only to hold `embedding` / `antiEmbedding` vectors used by
-- the RAG query classifier. The classifier is now a static taxonomy in code.
DROP TABLE IF EXISTS "RoleProfile";

-- ── 2. "JobSource" enum → TEXT ───────────────────────────────────────────────

-- Existing rows already hold values like 'STARTUPJOBS'; the cast preserves them
-- verbatim, which is exactly what the new registry expects (uppercase board id).
-- The column must lose its dependency on the type before the type can be dropped.
ALTER TABLE "JobPosting" ALTER COLUMN "source" TYPE TEXT USING "source"::text;

DROP TYPE IF EXISTS "JobSource";

-- ── 3. Country awareness ─────────────────────────────────────────────────────

-- ISO 3166-1 alpha-2, uppercase. NULL means unknown or worldwide/remote.
ALTER TABLE "JobPosting" ADD COLUMN IF NOT EXISTS "country" TEXT;

ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "preferredWorkType" TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "remoteOnly" BOOLEAN NOT NULL DEFAULT false;

-- ── 4. CoverLetter."generatedByAI" → "generatedFromTemplate" ─────────────────

-- RENAME, not drop-and-add: this column marks user-visible letters and must keep
-- its values. Guarded so the migration can be re-run against a partially applied
-- database (RENAME COLUMN has no IF EXISTS form).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'CoverLetter'
      AND column_name = 'generatedByAI'
  ) THEN
    ALTER TABLE "CoverLetter" RENAME COLUMN "generatedByAI" TO "generatedFromTemplate";
  END IF;
END $$;

-- ── 5. Indexes for the lexical search path ───────────────────────────────────

-- Plain b-tree indexes Prisma also knows about (names match Prisma's convention
-- so `prisma migrate diff` sees no drift).
CREATE INDEX IF NOT EXISTS "JobPosting_source_idx" ON "JobPosting"("source");
CREATE INDEX IF NOT EXISTS "JobPosting_country_idx" ON "JobPosting"("country");
CREATE INDEX IF NOT EXISTS "JobPosting_country_scrapedAt_idx" ON "JobPosting"("country", "scrapedAt");
CREATE INDEX IF NOT EXISTS "JobPosting_scrapedAt_idx" ON "JobPosting"("scrapedAt");
CREATE INDEX IF NOT EXISTS "JobPosting_firstSeenAt_idx" ON "JobPosting"("firstSeenAt");

-- Foreign-key indexes. Postgres does not create these automatically, and the
-- stale-posting purge deletes JobPosting rows, which forces a check against every
-- referencing table.
CREATE INDEX IF NOT EXISTS "UserFavourite_jobId_idx" ON "UserFavourite"("jobId");
CREATE INDEX IF NOT EXISTS "Application_userId_idx" ON "Application"("userId");
CREATE INDEX IF NOT EXISTS "Application_jobId_idx" ON "Application"("jobId");
CREATE INDEX IF NOT EXISTS "CoverLetter_userId_idx" ON "CoverLetter"("userId");
CREATE INDEX IF NOT EXISTS "CoverLetter_jobId_idx" ON "CoverLetter"("jobId");

-- Full-text index backing relevance ranking. Prisma cannot express an expression
-- index, so it is raw SQL here and only referenced by a comment in schema.prisma.
--
-- The 'simple' text-search configuration is deliberate: postings are multi-
-- language (Czech, Polish, German, English in one table) and 'english' stemming
-- would mangle non-English tokens. 'simple' just lowercases and strips stop-word
-- free tokens, which is the right behaviour for a mixed corpus.
CREATE INDEX IF NOT EXISTS "JobPosting_fulltext_idx"
  ON "JobPosting"
  USING GIN (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' || coalesce("company", '') || ' ' || coalesce("description", '')
    )
  );

-- Trigram index for fuzzy title matching ("dev" ~ "developer", typo tolerance).
--
-- CREATE EXTENSION needs rights a managed database may not grant. Both this and
-- the index that depends on it are wrapped so that a restricted database
-- degrades to sequential ILIKE scans instead of failing the whole migration.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pg_trgm: %. Fuzzy title matching will fall back to sequential scans.', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "JobPosting_title_trgm_idx"
    ON "JobPosting"
    USING GIN ("title" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping JobPosting_title_trgm_idx: %.', SQLERRM;
END $$;
