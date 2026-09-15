import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePlan } from '../src/plan/plan.js';
import { tailor } from '../src/resume/tailor.js';
import { buildStarter } from '../src/compose/letter.js';
import type { AnswerBank, CandidateProfile } from '../src/plan/types.js';
import type { FormQuestion, JobPosting } from '../src/ingest/types.js';
import type { IndexedJob } from '../src/jobs/indexer.js';

/**
 * Planning, tailoring and composing — against a real employer's form.
 *
 * The fixture is a genuine Greenhouse schema captured from a live board, not a
 * hand-written one: a form invented to satisfy the planner proves only that the
 * planner satisfies itself. Nothing here touches the network.
 *
 * These assertions are the product's promises in executable form. If one fails,
 * the answer is not to relax it.
 */

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/greenhouse-form.json', import.meta.url), 'utf8'),
) as {
  title: string;
  questions: Array<{
    label: string;
    required: boolean;
    fields: Array<{ name: string; type: string; values?: Array<{ label: string; value: string | number }> }>;
  }>;
};

const KIND: Record<string, string> = {
  input_text: 'short_text', textarea: 'long_text', input_file: 'file',
  multi_value_single_select: 'single_select', multi_value_multi_select: 'multi_select',
};

/** The same normalisation ingest stores, so labelKeys match what the bank uses. */
const norm = (s: string): string =>
  s.toLowerCase().replace(/[*?]/g, '').replace(/\s+/g, ' ').replace(/[^\w\s/-]/g, '').trim();

const CONSENT = /privacy notice|consent|certify|attest/i;
const DEMOGRAPHIC = /gender|race|ethnicity|veteran|disability/i;

const questions: FormQuestion[] = fixture.questions.map((q) => ({
  label: q.label,
  labelKey: norm(q.label),
  required: q.required,
  answerability: CONSENT.test(q.label) || DEMOGRAPHIC.test(q.label)
    ? 'demographic'
    : /resume|cv/i.test(q.label)
      ? 'file'
      : /cover letter/i.test(q.label)
        ? 'generated'
        : 'bank',
  // Options travel with the field. Without them the planner cannot match a
  // stored answer to what the employer actually offers, and correctly refuses
  // to push a raw value at a select — which is the behaviour, not a bug.
  fields: q.fields.map((f) => ({
    name: f.name,
    kind: (KIND[f.type] ?? 'unknown') as never,
    ...(f.values ? { options: f.values.map((v) => ({ label: v.label, value: String(v.value) })) } : {}),
  })),
})) as FormQuestion[];

const posting: JobPosting = {
  vendor: 'greenhouse',
  boardToken: 'addepar1',
  vendorJobId: '1',
  title: fixture.title,
  absoluteUrl: 'https://example.invalid/jobs/1',
  location: 'Pune, India',
  updatedAt: null,
  questions,
};

const profile: CandidateProfile = {
  firstName: 'Priya',
  lastName: 'Raman',
  email: 'priya.raman@fastmail.in',
  phone: '+91 98290 41765',
  location: 'Jodhpur, Rajasthan, India',
  linkedin: 'https://www.linkedin.com/in/priyaraman',
  currentTitle: 'Data Operations Analyst',
  skills: ['python', 'sql', 'etl'],
  experience: [{
    title: 'Data Operations Analyst',
    company: 'Tessellate Labs',
    start: 'Jun 2023',
    bullets: [
      'Built a Python and SQL pipeline that cut weekly reporting from 6 hours to 20 minutes.',
      'Ran the office move and the vendor selection for it.',
    ],
  }],
};

const bank: AnswerBank = { answers: [{ labelKeys: ['are you 18 years of age or older'], text: 'Yes' }] };

const job = {
  id: 'j1',
  vendor: 'greenhouse',
  boardToken: 'addepar1',
  vendorJobId: '1',
  company: 'Addepar',
  title: fixture.title,
  absoluteUrl: 'https://example.invalid/jobs/1',
  location: 'Pune, India',
  department: null,
  office: null,
  updatedAt: null,
  firstPublished: null,
  facts: {
    skills: ['python', 'salesforce'],
    requiredSkills: ['python', 'salesforce'],
    requirementsFound: true,
    level: null,
    workplace: null,
    years: null,
    summary: 'Build data pipelines in python. Salesforce experience required.',
    descriptionChars: 60,
  },
  formReadable: true,
} as unknown as IndexedJob;

/* ─────────────────────────── the plan ─────────────────────────── */

test('a consent question is never answered from stored data', () => {
  const plan = compilePlan(posting, profile, bank);
  const privacy = plan.actions.find((a) => /privacy notice/i.test(a.questionLabel));
  assert.ok(privacy, 'the fixture contains a privacy notice — the case this rule exists for');
  assert.equal(privacy.source, 'user');
});

test('every action records where its value came from', () => {
  const plan = compilePlan(posting, profile, bank);
  for (const a of plan.actions) {
    assert.ok(a.source, `${a.questionLabel} has no recorded source`);
    if (a.source === 'profile' || a.source === 'bank') {
      assert.ok(a.value, `${a.questionLabel} claims a stored answer but carries no value`);
    }
  }
});

test('the profile fills the fields it should, and nothing it should not', () => {
  const plan = compilePlan(posting, profile, bank);
  const byLabel = (re: RegExp) => plan.actions.find((a) => re.test(a.questionLabel));
  assert.equal(byLabel(/first name/i)?.value, 'Priya');
  assert.equal(byLabel(/email/i)?.value, 'priya.raman@fastmail.in');
  assert.equal(byLabel(/cover letter/i)?.source, 'generated', 'prose is never pulled from a store');
});

test('a banked answer resolves, and its absence does not', () => {
  // Regression: loadBank wrote the answer to `value` while the planner reads
  // `text`. Every lookup still matched, so the bank looked wired and resolved
  // nothing — the seeded answers filled no field for several commits.
  const withBank = compilePlan(posting, profile, bank);
  const age = withBank.actions.find((a) => /18 years of age/i.test(a.questionLabel));
  assert.equal(age?.source, 'bank');
  assert.equal(age?.value, 'Yes');

  const without = compilePlan(posting, profile, { answers: [] });
  const sameQ = without.actions.find((a) => /18 years of age/i.test(a.questionLabel));
  assert.notEqual(sameQ?.source, 'bank', 'an empty bank cannot resolve anything');
});

test('a plan with an unanswered required field is not executable', () => {
  const plan = compilePlan(posting, profile, { answers: [] });
  assert.equal(plan.executable, false);
});

/* ─────────────────────────── tailoring ─────────────────────────── */

test('every emitted bullet is one the candidate wrote', () => {
  const t = tailor(profile, job);
  assert.equal(t.integrity.allVerbatim, true);
  assert.deepEqual(t.integrity.notFound, []);
  const written = new Set(profile.experience![0]!.bullets);
  for (const r of t.roles) for (const b of r.kept) assert.ok(written.has(b.text));
});

test('scores the relevant bullet above the irrelevant one', () => {
  const t = tailor(profile, job);
  const kept = t.roles[0]!.kept;
  assert.match(kept[0]!.text, /Python and SQL/);
  assert.ok(kept[0]!.score > 0, 'a bullet matching the posting scores above zero');
});

test('names a skill the posting wants and the candidate has not claimed', () => {
  const t = tailor(profile, job);
  assert.ok(t.coverage.missing.includes('salesforce'));
  assert.ok(!t.coverage.evidenced.includes('salesforce'), 'an honest gap is never filled in');
});

/* ─────────────────────────── the letter ─────────────────────────── */

test('the starter leaves prompts rather than inventing claims', () => {
  const starter = buildStarter(
    { boardToken: 'addepar1', company: 'Addepar', title: job.title, location: 'Pune, India', absoluteUrl: job.absoluteUrl, asks: ['python'] },
    profile,
  );
  assert.ok(starter.placeholders.length >= 2, 'the parts only a human knows stay unwritten');
  for (const p of starter.placeholders) assert.ok(starter.text.includes(p));
  assert.match(starter.text, /Dear Addepar/, 'the employer is named, not the board slug');
});

test('the word count excludes bracketed prompts', () => {
  const starter = buildStarter(
    { boardToken: 'addepar1', company: 'Addepar', title: 'Analyst', absoluteUrl: 'https://example.invalid', asks: [] },
    profile,
  );
  const withBrackets = starter.text.split(/\s+/).filter(Boolean).length;
  assert.ok(starter.wordCount < withBrackets, 'prompts are not writing, and are not counted as it');
});

test('every fact in the starter is traceable to the profile or the posting', () => {
  const starter = buildStarter(
    { boardToken: 'addepar1', company: 'Addepar', title: 'Analyst', absoluteUrl: 'https://example.invalid', asks: ['python'] },
    profile,
  );
  for (const f of starter.facts) assert.ok(['profile', 'posting'].includes(f.source));
  // Every profile-sourced fact is either a field verbatim or composed from
  // fields — the full name is first + last, which no substring check would
  // find in the profile object.
  const fields = Object.values(profile).filter((v): v is string => typeof v === 'string');
  const composed = new Set([...fields, `${profile.firstName} ${profile.lastName}`]);
  for (const f of starter.facts.filter((x) => x.source === 'profile')) {
    assert.ok(
      composed.has(f.value),
      `the starter states "${f.value}" as a fact about the candidate, and no profile field says it`,
    );
  }
});
