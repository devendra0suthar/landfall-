import { prisma } from '../lib/db.js';
import { fetchFormChecked } from './greenhouse.js';
import { storeQuestions } from './ingest.js';
import type { JobPosting } from './types.js';

/**
 * Filling in the forms ingest never asked for.
 *
 * `ingestBoard` reads a board's whole job list but only pulls the form schema
 * for the first `FORM_BATCH` postings, so a board of 130 roles lands with 25
 * readable forms and 105 in the `unknown` state. That is honest — we really
 * have not asked — but it is not *finished*, and it is the difference between
 * a product that can prepare 17% of its index and one that can prepare all of
 * it. Measured on this database: 34 of 200 postings readable before, because
 * of the batch cap and nothing else.
 *
 * This walks the postings nobody has asked about and asks. It is deliberately
 * a separate pass rather than a bigger `FORM_BATCH`:
 *
 * - **Ingest stays fast.** Picking up new postings is one request per board;
 *   reading every form is one request per posting. Tying them together means
 *   the cheap job cannot run often.
 * - **It is resumable.** The query is "postings we have never asked about", so
 *   an interrupted run leaves the next one less to do, and a finished run is a
 *   no-op. Re-running costs nothing.
 * - **Politeness is inherited, not reimplemented.** `fetchJson` already
 *   throttles per host and caches negatives (NFR-1, NFR-2), so this loop is
 *   sequential on purpose — a concurrent fan-out here would defeat the
 *   throttle that makes us a well-behaved client.
 */

export interface BackfillResult {
  attempted: number;
  /** The vendor answered and published a form. */
  readable: number;
  /** The vendor answered and publishes none. A real measurement, not a failure. */
  unpublished: number;
  /** We could not ask. These stay `unknown` and will be retried. */
  unreachable: number;
  questionsWritten: number;
  /** Postings still never asked about after this run. */
  remaining: number;
}

/**
 * What a fetch outcome means for the stored state. Pure, so the rule can be
 * tested without a database or a network.
 *
 * The trap this exists to prevent: treating a failed request as evidence about
 * the employer. `reached: false` must write **nothing** — leaving the posting
 * in the `unknown` state so it is asked again — because writing
 * `formReadable: false` would record a timeout as "this employer publishes no
 * form", permanently, and the posting would never be retried.
 */
export function formStateFromFetch(
  reached: boolean,
  questions: JobPosting['questions'],
): { formReadable: boolean; formFetchedAt: Date } | null {
  if (!reached) return null;
  return { formReadable: Array.isArray(questions), formFetchedAt: new Date() };
}

export async function backfillForms(
  opts: { limit?: number; boardToken?: string } = {},
): Promise<BackfillResult> {
  const limit = opts.limit ?? 100;

  const where = {
    // Never asked. `formReadable: false` with a timestamp is a settled answer
    // and is not revisited here.
    formFetchedAt: null,
    // No point reading the form of a posting the employer has taken down.
    closedAt: null,
    ...(opts.boardToken ? { board: { slug: opts.boardToken } } : {}),
  };

  const jobs = await prisma.job.findMany({
    where,
    // Newest first: a candidate is far more likely to apply to something posted
    // this week, so that is where coverage is worth buying first.
    orderBy: { postedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      externalId: true,
      title: true,
      absoluteUrl: true,
      location: true,
      board: { select: { slug: true } },
    },
  });

  const result: BackfillResult = {
    attempted: 0, readable: 0, unpublished: 0, unreachable: 0,
    questionsWritten: 0, remaining: 0,
  };

  for (const job of jobs) {
    const posting: JobPosting = {
      vendor: 'greenhouse',
      boardToken: job.board.slug,
      vendorJobId: job.externalId,
      title: job.title,
      absoluteUrl: job.absoluteUrl,
      location: job.location,
      updatedAt: null,
    };

    result.attempted += 1;
    const { reached, posting: withForm } = await fetchFormChecked(posting);
    const state = formStateFromFetch(reached, withForm.questions);

    if (state === null) {
      result.unreachable += 1;
      continue;
    }

    await prisma.job.update({ where: { id: job.id }, data: state });

    if (Array.isArray(withForm.questions)) {
      result.readable += 1;
      result.questionsWritten += await storeQuestions(job.id, withForm.questions);
    } else {
      result.unpublished += 1;
    }
  }

  result.remaining = await prisma.job.count({ where });
  return result;
}
