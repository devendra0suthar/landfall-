-- "New since you last looked" needs a date that refreshes never rewrite.
-- Existing postings get the migration time, which is before any saved search.
ALTER TABLE "Job" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedSearch_candidateId_idx" ON "SavedSearch"("candidateId");
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
