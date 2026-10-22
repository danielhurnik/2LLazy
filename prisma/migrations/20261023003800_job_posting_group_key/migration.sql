-- AlterTable
ALTER TABLE "JobPosting" ADD COLUMN     "groupKey" TEXT;

-- CreateIndex
CREATE INDEX "JobPosting_groupKey_idx" ON "JobPosting"("groupKey");
