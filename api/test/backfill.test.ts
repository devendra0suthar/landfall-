import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formStateFromFetch } from '../src/ingest/backfill.js';

/**
 * The three states, at the point where they are written down.
 *
 * Everything else in this product reads `formFetchedAt` and `formReadable` and
 * is careful about the difference. This is the one place those two columns are
 * decided, so it is the one place the distinction can actually be lost — and
 * losing it here is permanent, because a posting marked "publishes no form"
 * stops being asked again.
 */

test('a request that never reached the vendor writes nothing', () => {
  // The trap: `reached: false` with no questions looks exactly like "this
  // employer publishes no form". Writing that would record our timeout as a
  // fact about them, and the posting would never be retried.
  assert.equal(formStateFromFetch(false, undefined), null);
  assert.equal(
    formStateFromFetch(false, []),
    null,
    'even an empty array is not evidence when the vendor never answered',
  );
});

test('the vendor answering with no form is a measurement, not a failure', () => {
  const state = formStateFromFetch(true, undefined);
  assert.ok(state, 'we asked, so the result is recorded');
  assert.equal(state.formReadable, false);
  assert.ok(state.formFetchedAt instanceof Date, 'the timestamp is what makes it a settled answer');
});

test('a form with questions is readable', () => {
  const state = formStateFromFetch(true, [] as never);
  assert.ok(state);
  assert.equal(state.formReadable, true, 'an empty question list is still a published form');

  const withQuestions = formStateFromFetch(true, [{ label: 'Email' }] as never);
  assert.ok(withQuestions);
  assert.equal(withQuestions.formReadable, true);
});

test('a refresh closes postings only when the board was reached and listed something', async () => {
  // listJobs used to return [] both for "no jobs" and for a failed request.
  // Closing on that would hide every role an employer has because of one
  // timeout; an empty listing from a board that had hundreds is treated the
  // same way — far more likely a hiccup than a mass closure.
  const { postingsToClose } = await import('../src/ingest/ingest.js');
  assert.deepEqual(postingsToClose(false, ['1', '2']), { act: false, why: 'board unreachable — nothing closed' });
  assert.equal(postingsToClose(true, []).act, false);
  assert.deepEqual(postingsToClose(true, ['1', '2']), { act: true, stillListed: ['1', '2'] });
});
