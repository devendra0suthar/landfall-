-- A posting the employer has taken down. Set by a refresh that reached the
-- board and did not find it; never deleted, because applications point at it.
ALTER TABLE "Job" ADD COLUMN "closedAt" TIMESTAMP(3);
CREATE INDEX "Job_closedAt_idx" ON "Job"("closedAt");
