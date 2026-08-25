-- Search indexes for a database created with `prisma db push`.
--
-- Ranking is lexical, and two of the indexes backing it are expression indexes
-- that Prisma's schema language cannot describe. `prisma migrate deploy`
-- creates them (see 20260823010000_remove_ai_add_country), but `prisma db push`
-- only applies what is in schema.prisma — so a database set up that way needs
-- this file run once afterwards:
--
--   psql "$DATABASE_URL" -f prisma/sql/search-indexes.sql
--
-- Safe to run repeatedly, and safe to run on a database that already has them.

-- Full-text index over the fields the search ranks on.
--
-- The 'simple' configuration is deliberate: postings sit in one table in Czech,
-- Polish, German and English, and 'english' stemming mangles the rest. It must
-- match the expression in src/graphql/resolvers.ts and src/app/api/scrape/route.ts
-- exactly, or Postgres will not use the index.
CREATE INDEX IF NOT EXISTS "JobPosting_fulltext_idx"
  ON "JobPosting"
  USING GIN (
    to_tsvector(
      'simple',
      coalesce("title", '') || ' ' || coalesce("company", '') || ' ' || coalesce("description", '')
    )
  );

-- Trigram index for fuzzy title matching. CREATE EXTENSION needs rights a
-- managed database may not grant, so both statements degrade to a notice
-- instead of failing: without them, title matching falls back to sequential
-- scans, which is slower but correct.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping pg_trgm: %. Fuzzy title matching will use sequential scans.', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS "JobPosting_title_trgm_idx"
    ON "JobPosting" USING GIN ("title" gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipping JobPosting_title_trgm_idx: %.', SQLERRM;
END $$;
