import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../src/routes/searches.js';

test('the same search saved twice is recognised even after Postgres reorders its keys', () => {
  // Stored JSONB comes back with keys in a different order; a plain
  // JSON.stringify comparison made a new copy on every save.
  const sent = { words: ['software', 'engineer'], skills: [], place: { label: 'Bengaluru', terms: ['bangalore'] }, days: null };
  const stored = { days: null, place: { terms: ['bangalore'], label: 'Bengaluru' }, skills: [], words: ['software', 'engineer'] };
  assert.equal(canonical(sent), canonical(stored));
  // Array order still matters — it is meaning, not storage.
  assert.notEqual(canonical({ words: ['a', 'b'] }), canonical({ words: ['b', 'a'] }));
});
