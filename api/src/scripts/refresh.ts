import { refreshIndex } from '../ingest/refresh.js';
import { prisma } from '../lib/db.js';

/**
 * Bring the whole index up to date, once.
 *
 *   pnpm refresh
 *
 * Re-reads every enabled board, closes postings the employer took down, and
 * reads forms for new postings. Safe to run as often as you like. The server
 * does the same on its own when INDEX_REFRESH_HOURS is set.
 */

const s = await refreshIndex((line) => console.log(line));
console.log(
  `\n${s.boards} boards in ${Math.round(s.ms / 1000)}s · ${s.jobsSeen} listed · `
  + `${s.jobsClosed} closed · ${s.formsRead} new forms read`
  + (s.failed.length ? ` · failed: ${s.failed.join(', ')}` : ''),
);
await prisma.$disconnect();
process.exit(s.failed.length === s.boards && s.boards > 0 ? 1 : 0);
