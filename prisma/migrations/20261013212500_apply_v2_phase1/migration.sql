-- AlterEnum
ALTER TYPE "ApplicationStatus" ADD VALUE 'APPLYING';
ALTER TYPE "ApplicationStatus" ADD VALUE 'NEEDS_MANUAL';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "appliedVia" TEXT,
ADD COLUMN     "evidencePath" TEXT;
