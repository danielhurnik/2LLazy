-- scraping v2 / Phase 0: trigram search, structured posting fields, dead cover-letter tables
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_coverLetterId_fkey";

-- DropForeignKey
ALTER TABLE "CoverLetter" DROP CONSTRAINT "CoverLetter_jobId_fkey";

-- DropForeignKey
ALTER TABLE "CoverLetter" DROP CONSTRAINT "CoverLetter_userId_fkey";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "coverLetterId";

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "city" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'CZ',
ADD COLUMN     "remote" BOOLEAN,
ADD COLUMN     "salaryCurrency" TEXT,
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER,
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "UserProfile" DROP COLUMN "coverLetterLanguage",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'CZ',
ADD COLUMN     "searchProfile" JSONB,
ADD COLUMN     "searchProfileUpdatedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "CoverLetter";

-- CreateIndex
CREATE INDEX "JobPosting_country_scrapedAt_idx" ON "JobPosting"("country", "scrapedAt");

