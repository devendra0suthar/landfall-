import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resumeLines, renderResume, TEMPLATES, templateFrom, DEFAULT_TEMPLATE,
} from '../src/resume/document.js';
import type { CandidateProfile } from '../src/plan/types.js';
import type { TailoredResume } from '../src/resume/tailor.js';

/**
 * Layouts, and the one rule that makes several of them safe.
 *
 * A template may change metrics, alignment and rules. It may not change a word,
 * drop a role, or reorder a history — the moment a layout starts editing
 * content to fit, "which template did I send?" becomes a question about what
 * the employer was told, not about how it looked.
 */

const profile = {
  firstName: 'Priya', lastName: 'Raman', email: 'p@example.in', phone: '+91 00000 00000',
  currentTitle: 'Data Operations Analyst', location: 'Jodhpur, India',
  skills: ['python', 'sql', 'pandas'],
} as CandidateProfile;

const tailored = {
  roles: [
    {
      title: 'Data Operations Analyst', company: 'Tessellate Labs',
      start: '2023-06', end: null, location: 'Jodhpur',
      kept: [
        { text: 'Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.', score: 3, matched: [] },
        { text: 'Automated quality checks in pandas.', score: 2, matched: [] },
      ],
      dropped: [],
    },
    {
      title: 'Analyst', company: 'Earlier Co', start: '2021-01', end: '2023-05',
      location: null, kept: [{ text: 'Ran the weekly review.', score: 1, matched: [] }], dropped: [],
    },
  ],
  bulletsKept: 3, bulletsAvailable: 3,
  coverage: { asked: [], evidenced: [], claimedNotShown: [], missing: [] },
  integrity: { allVerbatim: true, notFound: [] },
  text: '',
} as TailoredResume;

const ids = Object.keys(TEMPLATES) as Array<keyof typeof TEMPLATES>;

test('there is more than one layout, and each names what it suits', () => {
  assert.ok(ids.length >= 3, 'expected at least three templates');
  for (const id of ids) {
    const t = TEMPLATES[id];
    assert.equal(t.id, id, 'the registry key and the id must agree');
    assert.ok(t.name.length > 0 && t.suits.length > 20, `${id} should say what it suits`);
  }
});

test('every template says exactly the same thing', () => {
  // The invariant. Layout is presentation; content is the candidate's history,
  // and a template that trimmed it to fit would be editing their CV.
  const reference = resumeLines(tailored, profile, 'classic').map((l) => l.text);
  for (const id of ids) {
    assert.deepEqual(
      resumeLines(tailored, profile, id).map((l) => l.text),
      reference,
      `${id} changed the content, not just the layout`,
    );
  }
});

test('every bullet the candidate wrote survives every layout', () => {
  for (const id of ids) {
    const text = resumeLines(tailored, profile, id).map((l) => l.text).join('\n');
    for (const role of tailored.roles) {
      for (const bullet of role.kept) {
        assert.ok(text.includes(bullet.text), `${id} dropped a bullet`);
      }
      assert.ok(text.includes(role.company), `${id} dropped a role`);
    }
  }
});

test('the layouts actually differ', () => {
  // A picker offering three identical documents is worse than offering one.
  const shapes = ids.map((id) => {
    const lines = resumeLines(tailored, profile, id);
    return JSON.stringify(lines.map((l) => [l.size, l.align ?? '', l.ruleBelow ?? false, l.spaceBefore ?? 0]));
  });
  assert.equal(new Set(shapes).size, ids.length, 'two templates render identically');
});

test('every template produces a real PDF', () => {
  for (const id of ids) {
    const pdf = renderResume(tailored, profile, id);
    assert.ok(pdf.length > 500, `${id} produced a suspiciously small file`);
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-', `${id} is not a PDF`);
    assert.ok(pdf.subarray(-6).toString('latin1').includes('%%EOF'), `${id} is truncated`);
  }
});

test('an unknown template falls back rather than failing', () => {
  // A stale link should still hand someone a résumé.
  assert.equal(templateFrom('nonsense'), DEFAULT_TEMPLATE);
  assert.equal(templateFrom(undefined), DEFAULT_TEMPLATE);
  assert.equal(templateFrom(42), DEFAULT_TEMPLATE);
  assert.equal(templateFrom('__proto__'), DEFAULT_TEMPLATE);
  assert.equal(templateFrom('compact'), 'compact');
});
