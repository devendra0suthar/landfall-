-- Counting a question type across every form was a sequential scan of the
-- whole table (~86k rows, ~24 ms per answer saved).
CREATE INDEX "Question_labelKey_idx" ON "Question"("labelKey");
