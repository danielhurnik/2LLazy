-- Scraping v2: embeddings are gone (deterministic scoring), so the pgvector columns are dead.
-- The "vector" extension itself is left installed: it was created by the postgres superuser and
-- app_fatique may not drop it. Nothing references it once these columns are gone.

-- AlterTable
ALTER TABLE "JobPosting" DROP COLUMN "embedding";

-- AlterTable
ALTER TABLE "RoleProfile" DROP COLUMN "antiEmbedding",
DROP COLUMN "embedding";
