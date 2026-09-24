import type { FillPlan } from '../plan/types.js';
import { bucketFor, formState } from '../kit/kit.js';

/**
 * One row of a run, decided without touching the database.
 *
 * Pure so the two ways a run can lie are testable: counting a question as
 * prepared that the Kit it links to lists as open, and describing a form we
 * never read as one the employer does not publish. Both are rule 8 failures
 * — a worklist that says "ready" about an application that is not.
 */

export interface RunCounts {
  /** Answers we can put on the form from facts they confirmed. */
  prepared: number;
  /** Questions only they may answer — consent, attestation, demographics. */
  yours: number;
  /** Asked, and we have nothing for it yet. */
  open: number;
  /** Questions on the employer's form. Only ever set for a form we read. */
  fields: number;
}

export type RunRow =
  | { ok: true; counts: RunCounts }
  | { ok: false; reason: string };

export function runRow(input: {
  job: { formFetchedAt: Date | null; formReadable: boolean };
  /** Null when there is no posting to plan against. */
  plan: FillPlan | null;
  /** Questions stored for the posting. */
  questions: number;
  hasAttachment: boolean;
}): RunRow {
  // Three states, three reasons. A form we have not read yet is our gap and
  // will be retried; one the vendor does not publish is theirs. Collapsing
  // them is the conflation FR-40 exists to prevent.
  switch (formState(input.job)) {
    case 'unread':
      return { ok: false, reason: 'we have not read this employer\'s form yet' };
    case 'unpublished':
      return { ok: false, reason: 'this employer publishes no readable form' };
    case 'readable':
      break;
  }
  if (input.plan === null) return { ok: false, reason: 'no longer indexed' };

  const counts: RunCounts = { prepared: 0, yours: 0, open: 0, fields: input.questions };
  for (const action of input.plan.actions) {
    const bucket = bucketFor(action.source, input.hasAttachment);
    if (bucket === 'answers') counts.prepared += 1;
    else if (bucket === 'yours') counts.yours += 1;
    else counts.open += 1;
  }
  return { ok: true, counts };
}
