import { backfillForms } from '../ingest/backfill.js';
import { prisma } from '../lib/db.js';

/**
 * Read the forms ingest never asked for.
 *
 *   pnpm forms                  # 100 postings, newest first
 *   pnpm forms -- --limit=400   # more
 *   pnpm forms -- addepar1      # one board
 *
 * Safe to run repeatedly: it only visits postings nobody has asked about, so a
 * finished index makes this a no-op.
 */

const args = process.argv.slice(2);
const board = args.find((a) => !a.startsWith('-'));
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 100;

if (!Number.isFinite(limit) || limit <= 0) {
  console.error('--limit must be a positive number');
  process.exit(1);
}

const before = await prisma.job.count({ where: { formFetchedAt: null } });
console.log(`${before} posting${before === 1 ? '' : 's'} have never been asked for a form.`);
if (board) console.log(`Limiting to board "${board}".`);

const r = await backfillForms({ limit, ...(board ? { boardToken: board } : {}) });

console.log('');
console.log(`asked        ${r.attempted}`);
console.log(`  readable   ${r.readable}  (${r.questionsWritten} questions stored)`);
console.log(`  publishes none ${r.unpublished}`);
// Not folded into a failure count: these are still 'unknown', and the next run
// will ask again. Reporting them as "publishes none" is the bug this whole
// pass exists to avoid.
console.log(`  unreachable ${r.unreachable}  (left as unknown, will retry)`);
console.log(`still unasked ${r.remaining}`);

await prisma.$disconnect();
