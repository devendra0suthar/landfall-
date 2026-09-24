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

test('the index refreshes itself in production unless told not to, and never on a laptop by default', async () => {
  // It was opt-in via render.yaml, the setting never reached the service, and
  // production stayed on its day-one index.
  const { refreshHours } = await import('../src/ingest/refresh.js');
  assert.equal(refreshHours({ NODE_ENV: 'production' }), 24);
  assert.equal(refreshHours({}), null, 'a dev server never starts crawling by itself');
  assert.equal(refreshHours({ NODE_ENV: 'production', INDEX_REFRESH_HOURS: '0' }), null, '0 turns it off');
  assert.equal(refreshHours({ INDEX_REFRESH_HOURS: '6' }), 6);
});

test('one unreachable board cannot make the index refresh every hour', async () => {
  // Staleness used the OLDEST board read. A board that stopped answering never
  // gets its date updated, so the index read as stale forever.
  const { staleFrom } = await import('../src/ingest/refresh.js');
  const now = Date.parse('2026-09-25T12:00:00Z');
  const h = (n: number) => new Date(now - n * 3_600_000);
  assert.equal(staleFrom([h(2), h(2), h(300)], 24, now), false, 'refreshed 2 h ago; one dead board is ignored');
  assert.equal(staleFrom([h(25), h(26)], 24, now), true, 'nothing read for a day');
  assert.equal(staleFrom([null, null], 24, now), true, 'never read at all');
  assert.equal(staleFrom([], 24, now), false, 'no boards, nothing to do');
});
