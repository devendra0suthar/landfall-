-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'browser',
ADD COLUMN     "label" TEXT,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3);
