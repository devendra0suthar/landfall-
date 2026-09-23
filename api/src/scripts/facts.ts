import { prisma } from '../lib/db.js';
import { extractFacts } from '../jobs/extract.js';

/**
 * Backfill the derived job facts that ingest now stores.
 *
 * `level`, `workplace` and `yearsRequired` come out of the same `extractFacts`
 * pass that already filled `skills` and `requiredSkills` — they were simply not
 * kept. Ranking the index therefore had to re-derive them from every
 * description on every request, which measured at 1,153ms of a 1,180ms ranking
 * and made the first page of a signed-in list take thirteen seconds on a small
 * instance.
 *
 * This is pure computation over rows we already hold: no network, no vendor,
 * nothing to rate limit. It is safe to re-run and safe to interrupt — it only
 * looks at rows where all three are still null, so a second run resumes rather
 * than repeating.
 *
 *     pnpm facts
 *     pnpm facts -- --limit=1000
 */

const arg = process.argv.find((a) => a.startsWith('--limit='));
const limit = arg ? Number(arg.split('=')[1]) : Infinity;

let seen = 0;
let written = 0;
const started = Date.now();

for (;;) {
  const batch = await prisma.job.findMany({
    // Only rows that have never been given these. A posting that genuinely
    // states no level and no years keeps nulls forever, so `workplace` — which
    // extractFacts always answers — is what marks a row as done.
    where: { workplace: null },
    select: { id: true, title: true, description: true },
    take: 500,
  });
  if (batch.length === 0) break;

  for (const job of batch) {
    if (seen >= limit) break;
    seen += 1;
    const facts = extractFacts(`${job.title}\n${job.description ?? ''}`, '');
    await prisma.job.update({
      where: { id: job.id },
      data: {
        level: facts.level,
        // Always a value, which is what makes it the marker for "done".
        workplace: facts.workplace ?? 'onsite',
        yearsRequired: facts.years,
      },
    });
    written += 1;
  }

  if (seen >= limit) break;
  process.stdout.write(`  ${written} rows\r`);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\nderived facts stored for ${written} postings in ${secs}s`);

const left = await prisma.job.count({ where: { workplace: null } });
console.log(left === 0 ? 'every posting has them' : `${left} still to do — run again`);

await prisma.$disconnect();
