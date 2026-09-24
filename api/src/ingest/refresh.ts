import { prisma } from '../lib/db.js';
import { ingestBoard } from './ingest.js';
import { backfillForms } from './backfill.js';
import { forgetQuestionStats } from '../plan/gaps.js';

/**
 * Bring the whole index up to date: every enabled board re-read, postings the
 * employer took down closed, new postings' forms read.
 *
 * Before this existed the index was frozen at the day each board was first
 * ingested. New roles never appeared, closed ones never left — a candidate
 * could be sent to prepare an application for a job that no longer existed —
 * and nothing re-read anything unless a person ran a script by hand.
 *
 * Reading only (CLAUDE.md: reading is unrestricted, submitting is not), through
 * the same throttled, bounded-retry fetch as every other read, one board at a
 * time. A board that fails is reported and skipped; it never stops the rest,
 * and it never closes anything (see `postingsToClose`).
 */

export interface RefreshSummary {
  boards: number;
  failed: string[];
  jobsSeen: number;
  jobsClosed: number;
  formsRead: number;
  ms: number;
}

/** Forms for new postings, read after the listings. Bounded so one pass stays short. */
const FORM_LIMIT = 400;

export async function refreshIndex(
  log: (line: string) => void = () => {},
): Promise<RefreshSummary> {
  const t0 = Date.now();
  const boards = await prisma.board.findMany({ where: { disabled: false }, select: { slug: true } });
  const summary: RefreshSummary = { boards: boards.length, failed: [], jobsSeen: 0, jobsClosed: 0, formsRead: 0, ms: 0 };

  for (const { slug } of boards) {
    try {
      // forms: 0 — listings first for every board, forms afterwards for only
      // the postings that are new, rather than re-asking for 25 per board.
      const r = await ingestBoard(slug, { forms: 0 });
      if (!r.ok) { summary.failed.push(slug); log(`${slug}: unreachable (HTTP ${r.status})`); continue; }
      summary.jobsSeen += r.jobsSeen;
      summary.jobsClosed += r.jobsClosed;
      log(`${slug}: ${r.jobsSeen} listed, ${r.jobsClosed} closed${r.skipped.length ? ` (${r.skipped.join('; ')})` : ''}`);
    } catch (err) {
      // A dropped database connection mid-board (Render's free tier does this
      // on long runs) loses that board for this pass, not the whole pass.
      summary.failed.push(slug);
      log(`${slug}: failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    const forms = await backfillForms({ limit: FORM_LIMIT });
    summary.formsRead = forms.readable;
    log(`forms: ${forms.readable} read, ${forms.remaining} still to read`);
  } catch (err) {
    log(`forms: failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  // The gap report counts questions across the index; it just changed.
  forgetQuestionStats();
  summary.ms = Date.now() - t0;
  return summary;
}

/**
 * Keep the index fresh from inside the server, when `INDEX_REFRESH_HOURS` is set.
 *
 * Checked on boot and then hourly, rather than on a fixed timer, because a
 * free Render instance sleeps after 15 idle minutes — a 24-hour setInterval
 * would almost never fire. Waking up is what triggers the check, so a site
 * nobody has visited for three days refreshes when the first person arrives.
 * Runs in the background; nobody's request waits for it.
 */
let running = false;

export function scheduleIndexRefresh(log: (line: string) => void): void {
  const hours = refreshHours(process.env);
  if (hours === null) return;

  const check = async (): Promise<void> => {
    if (running) return;
    const stale = await isStale(hours);
    if (!stale) return;
    running = true;
    log(`index older than ${hours}h — refreshing`);
    try {
      const s = await refreshIndex(log);
      log(`refresh done in ${Math.round(s.ms / 1000)}s: ${s.jobsSeen} listed, ${s.jobsClosed} closed, `
        + `${s.formsRead} forms read, ${s.failed.length} boards failed`);
    } catch (err) {
      log(`refresh failed — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  // A minute after boot, so start-up (and migrations) finish first.
  setTimeout(() => { void check(); }, 60_000).unref();
  setInterval(() => { void check(); }, 60 * 60_000).unref();
}

/**
 * How often to refresh, or null for never.
 *
 * On by default in production (24 h), off by default everywhere else. It was
 * opt-in only, set in render.yaml — and the blueprint never applied it to the
 * running service, so production sat on the day-one index: 5,402 jobs, none
 * ever closed, while a local refresh had already found 168 taken down and 157
 * new. A setting that has to be remembered in a dashboard is one that is not
 * set. `INDEX_REFRESH_HOURS=0` still turns it off; a laptop never crawls on
 * its own because NODE_ENV is not production there.
 */
export function refreshHours(env: NodeJS.ProcessEnv): number | null {
  const raw = env.INDEX_REFRESH_HOURS;
  if (raw === undefined || raw.trim() === '') return env.NODE_ENV === 'production' ? 24 : null;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** Stale when the least recently read enabled board is older than `hours`. */
export async function isStale(hours: number): Promise<boolean> {
  const boards = await prisma.board.findMany({ where: { disabled: false }, select: { lastFetchedAt: true } });
  return staleFrom(boards.map((b) => b.lastFetchedAt), hours, Date.now());
}

/**
 * Stale when no board has been read successfully for `hours` — measured from
 * the MOST RECENT read, which is when a refresh last ran.
 *
 * It used the oldest. An unreachable board never has its date updated (ingest
 * returns before touching it), so one employer leaving Greenhouse would have
 * kept the index "stale" forever and re-crawled all 21 boards every hour.
 * An index where no board has ever been read is stale. (A board added with
 * `pnpm ingest` is read as it is added, so it never needs this to be found.)
 */
export function staleFrom(fetched: Array<Date | null>, hours: number, now: number): boolean {
  if (fetched.length === 0) return false;
  if (fetched.every((d) => d === null)) return true;
  const newest = Math.max(...fetched.filter((d): d is Date => d !== null).map((d) => d.getTime()));
  return now - newest > hours * 3_600_000;
}
