-- AlterEnum
ALTER TYPE "JobSource" ADD VALUE 'ATS';
ALTER TYPE "JobSource" ADD VALUE 'WEB';

-- DropTable
DROP TABLE "RoleProfile";

-- CreateTable
CREATE TABLE "WebDomain" (
    "host" TEXT NOT NULL,
    "jobPostings" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebDomain_pkey" PRIMARY KEY ("host")
);
