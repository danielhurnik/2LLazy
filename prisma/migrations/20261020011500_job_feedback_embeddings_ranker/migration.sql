
-- CreateEnum
CREATE TYPE "JobFeedbackSignal" AS ENUM ('DISMISSED', 'MODEL_JUDGED');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "rankerModel" JSONB,
ADD COLUMN     "rankerTrainedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "JobFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "signal" "JobFeedbackSignal" NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEmbedding" (
    "jobId" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEmbedding_pkey" PRIMARY KEY ("jobId")
);

-- CreateIndex
CREATE UNIQUE INDEX "JobFeedback_userId_jobId_signal_key" ON "JobFeedback"("userId", "jobId", "signal");

-- AddForeignKey
ALTER TABLE "JobFeedback" ADD CONSTRAINT "JobFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobFeedback" ADD CONSTRAINT "JobFeedback_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEmbedding" ADD CONSTRAINT "JobEmbedding_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobPosting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

