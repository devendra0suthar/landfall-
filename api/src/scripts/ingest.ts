import { ingestBoard } from '../ingest/ingest.js';

/**
 * Pull one or more Greenhouse boards into the index.
 *
 *   pnpm ingest -- addepar1 figma
 *
 * Reading is unrestricted; submitting is not. This script only reads.
 */

const boards = process.argv.slice(2).filter((a) => !a.startsWith('-'));

if (boards.length === 0) {
  console.error('usage: pnpm ingest -- <board-token> [more…]');
  process.exit(1);
}

for (const board of boards) {
  const t0 = Date.now();
  const r = await ingestBoard(board);
  const ms = Date.now() - t0;
  if (!r.ok) {
    console.log(`${board.padEnd(20)} unreachable (HTTP ${r.status})`);
    continue;
  }
  console.log(
    `${board.padEnd(20)} ${String(r.jobsWritten).padStart(4)} jobs · `
    + `${String(r.formsRead).padStart(3)} forms · `
    + `${String(r.questionsWritten).padStart(4)} questions · ${ms}ms`,
  );
}

process.exit(0);
