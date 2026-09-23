-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_googleId_key" ON "Candidate"("googleId");

