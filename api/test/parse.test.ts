import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResume } from '../src/profile/parse.js';

/**
 * The parser, held to what it promises.
 *
 * Every case here is a bug that actually shipped or a rule the product cannot
 * break. The parser is the one component that proposes facts about a person,
 * so "it returned something" is not a passing condition — what it returned, and
 * how sure it claimed to be, both matter.
 */

const CV = [
  'Priya Raman',
  'Data Operations Analyst',
  'priya.raman@fastmail.in - +91 98290 41765 - Jodhpur, Rajasthan, India',
  'www.linkedin.com/in/priyaraman',
  'SKILLS',
  'python - sql - pandas - etl - tableau',
  'EXPERIENCE',
  'Data Operations Analyst, Tessellate Labs',
  'Jun 2023 - Present - Jodhpur',
  '- Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.',
  '- Automated quality checks in pandas.',
  'Analyst, Marwar Systems',
  'Aug 2021 - May 2023 - Jodhpur',
  '- Rebuilt the daily ETL in Airflow.',
].join('\n');

test('separates roles from a "Title, Company" heading', () => {
  // Regression: the separator regex demanded whitespace on both sides, so the
  // commonest heading shape matched nothing and every résumé parsed with zero
  // roles — silently, with all the contact fields still filled in.
  const r = parseResume(CV);
  assert.equal(r.roles.length, 2);
  assert.equal(r.roles[0]!.title.value, 'Data Operations Analyst');
  assert.equal(r.roles[0]!.company.value, 'Tessellate Labs');
  assert.equal(r.roles[1]!.company.value, 'Marwar Systems');
});

test('reads date ranges, and marks an open one as present', () => {
  const r = parseResume(CV);
  assert.equal(r.roles[0]!.start.value, 'Jun 2023');
  assert.equal(r.roles[0]!.end.value, null, 'a current role ends in null, not the word "Present"');
  assert.equal(r.roles[1]!.end.value, 'May 2023');
});

test('keeps bullets verbatim, stripped of their marker', () => {
  const r = parseResume(CV);
  const first = r.roles[0]!.bullets[0]!.value;
  assert.equal(first, 'Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.');
  assert.ok(!first.startsWith('-'), 'the bullet marker is not part of the text');
});

test('does not read a date range as a phone number', () => {
  // Regression: "2019 - 2022" is eight digits and a separator — the same shape
  // as a phone number. Every résumé has date ranges, so the real number was
  // always reported as "one of several" and flagged for no actionable reason.
  const r = parseResume(CV.replace('Aug 2021 - May 2023 - Jodhpur', '2019 - 2022'));
  assert.equal(r.phone.value, '+91 98290 41765');
  assert.equal(r.phone.confidence, 'high');
});

test('finds the location on the contact line, beside the email', () => {
  // Regression: the search skipped any line containing "@", which is exactly
  // the line the location lives on.
  const r = parseResume(CV);
  assert.equal(r.location.value, 'Jodhpur, Rajasthan, India');
});

test('never claims certainty about a name read off the first line', () => {
  const r = parseResume(CV);
  assert.equal(r.firstName.value, 'Priya');
  assert.notEqual(r.firstName.confidence, 'high');
  assert.ok(r.firstName.reason, 'an uncertain field explains why');
});

test('flags a skill the matcher cannot see rather than dropping it', () => {
  const r = parseResume(CV.replace('python - sql', 'python - underwater basket weaving'));
  const odd = r.skills.find((s) => s.value.includes('basket'));
  assert.ok(odd, 'the skill is still offered — it is the candidate\'s to claim');
  assert.equal(odd.confidence, 'low');
  assert.match(odd.reason ?? '', /vocabulary/);
});

test('reports what it found and deliberately did not keep', () => {
  const r = parseResume(`${CV}\nDate of Birth: 4 March 1998\nMarital status: single`);
  assert.ok(r.excluded.includes('date of birth'));
  assert.ok(r.excluded.includes('marital status'));
  // The point is that they are named, not silently dropped: a candidate should
  // know the file contained them and that we did not keep them.
  assert.equal(r.roles.length, 2, 'excluded content does not derail the rest of the parse');
});

test('says so when there is almost no text, rather than returning empty fields', () => {
  const r = parseResume('Priya Raman');
  assert.ok(r.warnings.some((w) => /no text|scan|image/i.test(w)));
  assert.equal(r.roles.length, 0);
});

test('warns when an experience section yields no roles', () => {
  // A two-column PDF arrives as interleaved text. The parser cannot un-scramble
  // it, and saying so is the whole difference between a limitation and a bug.
  const r = parseResume('Priya Raman\nEXPERIENCE\nsome interleaved nonsense from two columns\nmore of it\nand more again here');
  assert.equal(r.roles.length, 0);
  assert.ok(r.warnings.some((w) => /no roles could be separated/i.test(w)));
});

test('counts every uncertain field as needing review', () => {
  const r = parseResume(CV);
  const uncertain = [r.firstName, r.lastName, r.location, r.currentTitle]
    .filter((f) => f.confidence !== 'high').length;
  assert.ok(r.needsReview >= uncertain);
  assert.ok(r.fieldCount > r.needsReview, 'not everything is flagged, or the signal is worthless');
});
