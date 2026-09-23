import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRewording, numbersIn, properNounsIn } from '../src/suggest/verify.js';
import { suggestRewordings } from '../src/suggest/suggest.js';

/**
 * Tests for the rule-1 gate.
 *
 * These encode CLAUDE.md rule 1 rather than covering lines: each one is a
 * specific way a rewording feature could put a claim in someone's mouth. The
 * competitor this feature answers to inserts missing keywords into bullets on
 * purpose; the third test is the one that says we do not.
 */

const kinds = (from: string, to: string): string[] =>
  verifyRewording(from, to).objections.map((o) => o.kind);

test('an invented metric is rejected', () => {
  const v = verifyRewording(
    'Reduced report turnaround for the operations team',
    'Reduced report turnaround by 40% for the operations team',
  );
  assert.equal(v.ok, false);
  assert.ok(v.objections.some((o) => o.kind === 'new-number' && o.detail === '40%'));
});

test('an inserted technology is rejected — this is keyword stuffing', () => {
  const v = verifyRewording(
    'Built the ingestion pipeline that loads nightly sales data',
    'Built the Airflow ingestion pipeline that loads nightly sales data',
  );
  assert.equal(v.ok, false);
  assert.ok(v.objections.some((o) => o.kind === 'new-technology'));
});

test('a promotion the candidate did not receive is rejected', () => {
  const v = verifyRewording(
    'Helped migrate the reporting warehouse to a new host',
    'Led the migration of the reporting warehouse to a new host',
  );
  assert.equal(v.ok, false);
  assert.ok(v.objections.some((o) => o.kind === 'escalation'));
});

test('an honest rewording passes', () => {
  const v = verifyRewording(
    'Was responsible for maintaining the nightly data quality checks',
    'Maintained the nightly data quality checks',
  );
  assert.deepEqual(v.objections, []);
  assert.equal(v.ok, true);
});

test('a rewording may not quietly drop the metric the candidate earned', () => {
  const v = verifyRewording(
    'Cut manual reconciliation time by 6 hours each week',
    'Cut manual reconciliation time substantially each week',
  );
  assert.equal(v.ok, false);
  assert.ok(v.objections.some((o) => o.kind === 'dropped-number'));
});

test('an unchanged line is not a suggestion', () => {
  assert.deepEqual(kinds('Wrote the nightly load', 'wrote the  nightly load'), ['unchanged']);
});

test('a blank proposal is rejected before anything else', () => {
  assert.deepEqual(kinds('Wrote the nightly load', '   '), ['empty']);
});

test('spelled-out numbers are the same claim as digits', () => {
  const v = verifyRewording(
    'Supported three regional teams through the rollout',
    'Supported 3 regional teams through the rollout',
  );
  assert.equal(v.objections.filter((o) => o.kind.endsWith('number')).length, 0);
});

test('a bare count is not the same claim as a percentage', () => {
  assert.ok(numbersIn('improved throughput 40').includes('40'));
  assert.ok(numbersIn('improved throughput by 40%').includes('40%'));
  const v = verifyRewording('improved throughput 40', 'improved throughput by 40%');
  assert.ok(v.objections.some((o) => o.kind === 'new-number'));
});

test('an unrecognised proper noun is still a claim', () => {
  const v = verifyRewording(
    'Rebuilt the billing export for the finance team',
    'Rebuilt the Salesforce billing export for the finance team',
  );
  assert.equal(v.ok, false);
  assert.ok(v.objections.some((o) => o.kind === 'new-entity' || o.kind === 'new-technology'));
});

test('a capital at the start of a sentence is not a proper noun', () => {
  assert.deepEqual(properNounsIn('Maintained the nightly checks'), []);
  assert.deepEqual(properNounsIn('Ran the job. Checked the output'), []);
});

test('padding a short line out with adjectives is rejected', () => {
  const v = verifyRewording(
    'Wrote the nightly load',
    'Carefully wrote and thoroughly documented the complex nightly data load process',
  );
  assert.ok(v.objections.some((o) => o.kind === 'inflated'));
});

// ── orchestration: what reaches the candidate ──
//
// The model is injected, so these run with no key and no network. That is the
// point: the guarantee is not "the model behaves", it is "what the model
// returns cannot reach a CV unchecked".

const BULLETS = [
  { id: 'b1', text: 'Built the ingestion pipeline that loads nightly sales data' },
  { id: 'b2', text: 'Was responsible for maintaining the nightly data quality checks' },
];

test('a proposal that invents a keyword never reaches the candidate', async () => {
  const result = await suggestRewordings(BULLETS, async () => [
    { id: 'b1', rewritten: 'Built the Airflow ingestion pipeline loading nightly sales data', why: 'tighter' },
  ]);
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.discarded.length, 1);
  assert.equal(result.discarded[0]?.bulletId, 'b1');
});

test('an honest proposal is passed through with its original', async () => {
  const result = await suggestRewordings(BULLETS, async () => [
    { id: 'b2', rewritten: 'Maintained the nightly data quality checks', why: 'cuts filler' },
  ]);
  assert.equal(result.discarded.length, 0);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.original, BULLETS[1]?.text);
  assert.equal(result.suggestions[0]?.proposal, 'Maintained the nightly data quality checks');
});

test('an id we did not send is dropped rather than matched by position', async () => {
  const result = await suggestRewordings(BULLETS, async () => [
    { id: 'someone-elses-bullet', rewritten: 'Anything at all', why: 'x' },
  ]);
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.discarded, []);
});

test('the model declining to change a line is not reported as a failure', async () => {
  const result = await suggestRewordings(BULLETS, async () => [
    { id: 'b1', rewritten: BULLETS[0]!.text, why: 'already clear' },
  ]);
  assert.deepEqual(result.suggestions, []);
  assert.deepEqual(result.discarded, []);
});

test('a repeated id is taken once', async () => {
  const result = await suggestRewordings(BULLETS, async () => [
    { id: 'b2', rewritten: 'Maintained the nightly data quality checks', why: 'a' },
    { id: 'b2', rewritten: 'Kept the nightly data quality checks running', why: 'b' },
  ]);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.rationale, 'a');
});

test('no bullets means no model call at all', async () => {
  let called = false;
  const result = await suggestRewordings([], async () => { called = true; return []; });
  assert.equal(called, false);
  assert.deepEqual(result.suggestions, []);
});
