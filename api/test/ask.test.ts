import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsk, whereFor, chipsFor, companyKey, EMPTY } from '../src/ask/parse.js';

/**
 * Ask Landfall's reading of plain words. Every rule here is one a person would
 * notice being wrong: a city missed, a follow-up that forgets the last
 * question, a request we cannot honour silently ignored.
 */

const vocab = { companies: ['Databricks', 'Gusto, Inc.', 'Rubrik Job Board', 'Stripe', 'Zscaler'] };

test('a whole request is read into its parts', () => {
  const r = parseAsk('senior remote data engineer jobs in Bangalore with python, posted this week', null, vocab);
  assert.deepEqual(r.filters.words, ['data', 'engineer']);
  assert.deepEqual(r.filters.skills, ['python']);
  assert.equal(r.filters.place?.label, 'Bengaluru');
  assert.equal(r.filters.workplace, 'remote');
  assert.equal(r.filters.level, 'senior');
  assert.equal(r.filters.days, 7);
  assert.deepEqual(r.notes, []);
});

test('both spellings of a city are one place, and the longer name wins', () => {
  assert.equal(parseAsk('jobs in bengaluru', null, vocab).filters.place?.label, 'Bengaluru');
  assert.equal(parseAsk('jobs in Bangalore', null, vocab).filters.place?.label, 'Bengaluru');
  assert.equal(parseAsk('roles in new delhi', null, vocab).filters.place?.label, 'Delhi NCR');
  // "new york" must not become the word "new" plus nothing.
  const ny = parseAsk('designer in new york', null, vocab);
  assert.equal(ny.filters.place?.label, 'New York');
  assert.deepEqual(ny.filters.words, ['designer']);
});

test('a follow-up refines the last answer instead of starting again', () => {
  const first = parseAsk('remote data engineer in india', null, vocab).filters;
  const next = parseAsk('only this week', first, vocab).filters;
  assert.deepEqual(next.words, ['data', 'engineer'], 'the role carries over');
  assert.equal(next.place?.label, 'India');
  assert.equal(next.workplace, 'remote');
  assert.equal(next.days, 7);
  // New role words replace the old ones; everything else stays.
  const other = parseAsk('product manager', next, vocab).filters;
  assert.deepEqual(other.words, ['product', 'manager']);
  assert.equal(other.place?.label, 'India');
});

test('"start over" really starts over', () => {
  const first = parseAsk('remote data engineer in india', null, vocab).filters;
  const r = parseAsk('start over, designer in london', first, vocab);
  assert.equal(r.reset, true);
  assert.deepEqual(r.filters.words, ['designer']);
  assert.equal(r.filters.place?.label, 'London');
  assert.equal(r.filters.workplace, null);
});

test('what cannot be filtered on is said, not silently dropped', () => {
  const r = parseAsk('data engineer jobs with visa sponsorship and good salary', null, vocab);
  assert.equal(r.notes.length, 2);
  assert.match(r.notes[0]!, /visa/i);
  assert.match(r.notes[1]!, /pay/i);
  // And neither word ends up as a title filter that would match nothing.
  assert.deepEqual(r.filters.words, ['data', 'engineer']);
});

test('companies are recognised the way people type them', () => {
  assert.equal(companyKey('Gusto, Inc.'), 'gusto');
  assert.equal(companyKey('Rubrik Job Board'), 'rubrik');
  assert.equal(parseAsk('anything at gusto', null, vocab).filters.company, 'Gusto, Inc.');
  assert.equal(parseAsk('rubrik roles', null, vocab).filters.company, 'Rubrik Job Board');
});

test('filler words never become title filters', () => {
  const r = parseAsk('please show me some jobs', null, vocab);
  assert.deepEqual(r.filters.words, []);
  assert.deepEqual(whereFor(r.filters), {}, 'nothing understood means no filter, not an impossible one');
});

test('the query and the chips say the same thing', () => {
  const f = parseAsk('staff backend engineer at stripe in dublin, last 30 days', null, vocab).filters;
  const where = JSON.stringify(whereFor(f));
  for (const w of f.words) assert.ok(where.includes(w));
  assert.ok(where.includes('dublin') && where.includes('Stripe') && where.includes('staff'));
  const labels = chipsFor(f).map((c) => c.label).join(' | ');
  assert.match(labels, /in Dublin/);
  assert.match(labels, /at Stripe/);
  assert.match(labels, /30 days/);
  assert.deepEqual(chipsFor(EMPTY), []);
});

test('title words are whole words, so "data" is not "Database"', async () => {
  const { titleMatches } = await import('../src/ask/parse.js');
  // Found on the first real conversation.
  assert.equal(titleMatches('Staff Backend Engineer - Database Change Management', ['data', 'engineer']), false);
  assert.equal(titleMatches('Senior Data Engineer', ['data', 'engineer']), true);
  assert.equal(titleMatches('Data Engineering Manager', ['data', 'engineer']), true, 'engineering is still engineer');
  assert.equal(titleMatches('Product Managers, Growth', ['product', 'manager']), true);
  assert.equal(titleMatches('C++ Developer', ['c++']), true);
});

test('a typed phrase is matched as a phrase first', async () => {
  const { titleHasPhrase } = await import('../src/ask/parse.js');
  assert.equal(titleHasPhrase('Senior Data Engineer', ['data', 'engineer']), true);
  assert.equal(titleHasPhrase('Data Engineering Lead', ['data', 'engineer']), true);
  assert.equal(titleHasPhrase('Senior Solutions Engineer (Presales, Technical, Data and AI)', ['data', 'engineer']), false);
  assert.equal(titleHasPhrase('Front-End Engineer', ['front', 'end', 'engineer']), true);
});

test('a complete new request starts fresh; a short one refines', () => {
  // Found in conversation: after "senior data engineer in london", the whole
  // new request "data engineer jobs in india" quietly kept "senior".
  const london = parseAsk('senior data engineer in london', null, vocab).filters;
  const india = parseAsk('data engineer jobs in india', london, vocab);
  assert.equal(india.filters.level, null, 'senior did not carry into a new request');
  assert.equal(india.filters.place?.label, 'India');
  assert.equal(india.reset, true);
  // An opening refine word keeps the context even with a role and a place.
  const also = parseAsk('and product manager in pune too', london, vocab).filters;
  assert.equal(also.level, 'senior');
  // A lone part refines.
  assert.equal(parseAsk('at stripe', london, vocab).filters.level, 'senior');
});
