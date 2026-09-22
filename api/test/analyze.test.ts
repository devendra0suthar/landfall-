import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseResume } from '../src/analyze/analyze.js';
import { extractFacts } from '../src/jobs/extract.js';
import type { CandidateProfile } from '../src/plan/types.js';

/**
 * The résumé score, and the promises it makes.
 *
 * A score is only worth showing if it is explainable and stable. These
 * assertions are the difference between a number a candidate can act on and one
 * they learn to ignore.
 */

const profile: CandidateProfile = {
  firstName: 'Priya',
  lastName: 'Raman',
  email: 'priya.raman@fastmail.in',
  phone: '+91 98290 41765',
  location: 'Jodhpur, Rajasthan, India',
  linkedin: 'https://www.linkedin.com/in/priyaraman',
  currentTitle: 'Data Operations Analyst',
  resumePath: '/tmp/cv.pdf',
  skills: ['python', 'sql', 'etl', 'tableau'],
  experience: [{
    title: 'Data Operations Analyst',
    company: 'Tessellate Labs',
    start: 'Jun 2023',
    bullets: [
      'Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.',
      'Responsible for the ETL jobs that feed the finance dashboards.',
    ],
  }],
};

const JD = 'Senior Data Analyst. Requirements: strong SQL and Python. '
  + 'Experience with ETL pipelines, Tableau dashboards and Salesforce data.';

const facts = extractFacts(`Senior Data Analyst\n${JD}`, JD);

test('the three keyword buckets are a partition of what the posting asks for', () => {
  // The bug this catches: `missing` was computed from the skills list alone, so
  // a term a bullet already demonstrated came back as evidenced AND missing.
  // Two contradictory answers on one screen teach a candidate the score cannot
  // be trusted.
  const a = analyseResume(profile, facts, 'Senior Data Analyst');
  assert.ok(a.target, 'a job description was given');

  const { asked, evidenced, claimedNotShown, missing } = a.target;
  const union = [...evidenced, ...claimedNotShown, ...missing];

  assert.equal(union.length, asked.length, 'every asked-for term lands in exactly one bucket');
  assert.equal(new Set(union).size, union.length, 'no term appears in two buckets');
  for (const t of asked) assert.ok(union.includes(t), `"${t}" is unaccounted for`);
});

test('a category that cannot be judged carries no weight instead of scoring zero', () => {
  // With no job description there is nothing to match keywords against.
  // Scoring that 0 would punish the candidate for what the posting did not say.
  const a = analyseResume(profile, null);
  const keywords = a.categories.find((c) => c.key === 'keywords');
  assert.ok(keywords);
  assert.equal(keywords.weight, 0, 'unjudgeable means unweighted');

  const withJob = analyseResume(profile, facts);
  const judged = withJob.categories.find((c) => c.key === 'keywords');
  assert.ok(judged);
  assert.ok(judged.weight > 0, 'with a description it counts');
});

test('the score is the weighted mean of what could be judged, and nothing else', () => {
  const a = analyseResume(profile, facts);
  const judged = a.categories.filter((c) => c.weight > 0);
  const total = judged.reduce((n, c) => n + c.weight, 0);
  const expected = Math.round(judged.reduce((n, c) => n + c.score * c.weight, 0) / total);
  assert.equal(a.score, expected, 'every point is traceable to a category');
  assert.ok(a.score >= 0 && a.score <= 100);
});

test('the same résumé scores the same twice', () => {
  // No model, no clock, no randomness. A score that drifts between reloads is
  // one nobody can act on.
  assert.equal(analyseResume(profile, facts).score, analyseResume(profile, facts).score);
});

test('every finding that reports a problem says what to do about it', () => {
  const a = analyseResume(profile, facts);
  for (const c of a.categories) {
    for (const f of c.findings) {
      if (f.severity === 'bad') {
        assert.ok(f.fix, `"${f.message}" reports a problem with no action`);
      }
    }
  }
});

test('a gap is named, never filled in', () => {
  const a = analyseResume(profile, facts);
  const fixes = a.categories.flatMap((c) => c.findings).map((f) => f.fix ?? '').join(' ');
  // The line this product will not cross: telling someone to paste a keyword
  // they cannot defend is how a CV becomes a claim they have to answer for.
  assert.ok(
    !/add these keywords|insert the keywords|copy these terms/i.test(fixes),
    'advice must not be "paste the keywords in"',
  );
});

test('a duty-phrase bullet is reported as one', () => {
  const a = analyseResume(profile, facts);
  const impact = a.categories.find((c) => c.key === 'impact');
  assert.ok(impact);
  const weak = impact.findings.find((f) => /duty phrase/i.test(f.message));
  assert.ok(weak, 'the fixture opens a bullet with "Responsible for"');
});
