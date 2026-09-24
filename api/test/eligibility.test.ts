import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibilityWhere, excludedScopes, countryOf, bareOtherCountryLocations } from '../src/jobs/eligibility.js';
import type { CandidateProfile } from '../src/plan/types.js';

/**
 * The eligibility filter, which hides postings — so its failure mode is
 * silence.
 *
 * Every other filter in this product is additive: get it wrong and someone sees
 * too much. This one deletes opportunities from the list, and a candidate
 * cannot tell the difference between "there are no roles for me" and "the
 * filter ate them". So the rules are asserted rather than trusted, and the
 * bias is explicit: only hide what can be *demonstrated* to exclude them.
 */

const inIndia = (over: Partial<CandidateProfile> = {}): CandidateProfile => ({
  firstName: 'P', lastName: 'R', email: 'p@example.com', phone: '',
  country: 'India', ...over,
} as CandidateProfile);

test('the country is read from wherever it was recorded', () => {
  assert.equal(countryOf(inIndia()), 'india');
  assert.equal(countryOf(inIndia({ country: undefined, location: 'Jodhpur, Rajasthan, India' })), 'india');
  assert.equal(countryOf(inIndia({ country: '  INDIA  ' })), 'india');
});

test('with no country, nothing is hidden at all', () => {
  // No basis to exclude anything. An empty filter is the honest answer; a
  // default of "hide everything foreign" would silently empty the list.
  const profile = inIndia({ country: undefined, location: undefined });
  assert.equal(countryOf(profile), null);
  assert.deepEqual(eligibilityWhere(profile), {});
  assert.deepEqual(excludedScopes(profile), []);
});

test('their own country is never in the excluded list', () => {
  const excluded = excludedScopes(inIndia());
  assert.ok(!excluded.includes('INDIA'));
  assert.ok(excluded.includes('US'));
  assert.ok(excluded.includes('UK'));
});

test('a posting with no stated scope survives the scope clause', () => {
  // The bug this encodes: in SQL, `scope NOT IN ('US', …)` is NULL — not true —
  // when scope is NULL, so a bare NOT-IN drops every row that never stated one.
  // Measured on the real index that was 2,167 of 2,408 postings, and the filter
  // returned 15 rows while looking like a decisive feature.
  const where = eligibilityWhere(inIndia());
  const clauses = where.AND as Array<Record<string, unknown>>;
  const scopeClause = clauses.find((c) => JSON.stringify(c).includes('remoteScope'));
  assert.ok(scopeClause, 'there should be a scope clause');
  const arms = JSON.stringify(scopeClause);
  assert.ok(arms.includes('"remoteScope":null'), 'null scope must be kept explicitly');
});

test('scope only constrains remote roles', () => {
  // An on-site job in Bangalore carrying a stray "US" scope from the extractor
  // is still a job in Bangalore. Judging it by scope hid it from someone living
  // there, which is the filter deleting a real opportunity.
  const where = eligibilityWhere(inIndia());
  const clauses = where.AND as Array<Record<string, unknown>>;
  const scopeClause = JSON.stringify(clauses.find((c) => JSON.stringify(c).includes('remoteScope')));
  assert.ok(scopeClause.includes('"remote":false'), 'non-remote roles must bypass the scope check');
});

test('an unknown country is kept, not hidden', () => {
  const where = eligibilityWhere(inIndia());
  const clauses = where.AND as Array<Record<string, unknown>>;
  const placeClause = JSON.stringify(clauses.find((c) => JSON.stringify(c).includes('"country"')));
  assert.ok(placeClause.includes('"country":null'), 'a posting with no country must stay');
  assert.ok(placeClause.includes('"remote":true'), 'remote roles must stay');
});

test('a candidate elsewhere excludes a different set', () => {
  const inUs = inIndia({ country: 'United States' });
  const excluded = excludedScopes(inUs);
  assert.ok(!excluded.includes('US'), 'never exclude their own scope');
  assert.ok(excluded.includes('INDIA'));
});

test('a remote role whose whole location is another country is hidden; their own never is', () => {
  // Found signed in as an India-based candidate: the top two roles of their
  // run were remote, unscoped, and located "United States".
  const bare = bareOtherCountryLocations(excludedScopes(inIndia()));
  assert.ok(bare.includes('united states'));
  assert.ok(bare.includes('remote - united states'));
  assert.ok(!bare.some((l) => l.includes('india')), 'their own country is never hidden');
  // Two-letter codes are too ambiguous to act on as a whole location.
  assert.ok(!bare.includes('us') && !bare.includes('uk'));
});
