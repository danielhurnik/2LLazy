
-- CreateEnum
CREATE TYPE "ApplyObstacleKind" AS ENUM ('CAPTCHA', 'LOGIN');

-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "applyPath" JSONB;

-- CreateTable
CREATE TABLE "ApplyObstacle" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "kind" "ApplyObstacleKind" NOT NULL,
    "applicationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplyObstacle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplyObstacle_host_createdAt_idx" ON "ApplyObstacle"("host", "createdAt");

