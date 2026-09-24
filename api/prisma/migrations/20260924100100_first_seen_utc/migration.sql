-- The previous migration filled "firstSeenAt" for existing postings with the
-- column default, CURRENT_TIMESTAMP, which Postgres renders in the SERVER's
-- time zone. Prisma stores DateTime as UTC. On a database whose zone is ahead
-- of UTC (found on one at +05:30) every existing posting therefore looked like
-- it arrived hours in the future, and every saved search reported all of its
-- matches as new. Bring any such row back to the migration moment in UTC.
-- A no-op on a UTC database.
UPDATE "Job" SET "firstSeenAt" = (now() AT TIME ZONE 'UTC')
 WHERE "firstSeenAt" > (now() AT TIME ZONE 'UTC');
