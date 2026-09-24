import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePlan } from '../src/plan/plan.js';
import { tailor } from '../src/resume/tailor.js';
import { buildStarter } from '../src/compose/letter.js';
import { buildKit, formState } from '../src/kit/kit.js';
import { runRow } from '../src/run/run.js';
import type { AnswerBank, CandidateProfile } from '../src/plan/types.js';
import type { FormQuestion, JobPosting } from '../src/ingest/types.js';
import type { IndexedJob } from '../src/jobs/indexer.js';

/**
 * The Application Kit — the promises of FR-39 … FR-43, executable.
 *
 * Built on the same real captured Greenhouse schema as plan.test.ts, for the
 * same reason: a form invented to satisfy the assembler proves only that the
 * assembler satisfies itself.
 *
 * The rules under test here are the ones where the *convenient* implementation
 * is the dishonest one — reporting an unread form as empty, computing a
 * percentage against an unknown total, or letting a demographic question with a
 * plausible stored answer slide into the prepared list. Each of these has a
 * failure mode that looks like success on screen, which is why they are tests
 * and not review comments.
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
  resumePath: 'C:/Users/D/projects/landfall/api/storage/resumes/priya-raman-cv.pdf',
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

const bank: AnswerBank = {
  answers: [
    { labelKeys: ['are you 18 years of age or older'], text: 'Yes' },
    { labelKeys: ['notice period'], text: '30 days' },
  ],
};

const indexed = {
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

const jobRow = {
  id: 'j1',
  title: fixture.title,
  company: 'Addepar',
  location: 'Pune, India',
  absoluteUrl: 'https://example.invalid/jobs/1',
  formFetchedAt: new Date('2026-09-20T00:00:00Z'),
  formReadable: true,
};

const tailored = tailor(profile, indexed);
const starter = buildStarter(
  {
    boardToken: 'addepar1',
    company: 'Addepar',
    title: fixture.title,
    location: 'Pune, India',
    absoluteUrl: 'https://example.invalid/jobs/1',
    asks: ['python', 'salesforce'],
  },
  profile,
);

/** A Kit for a form we read. */
const readableKit = buildKit({
  job: jobRow,
  plan: compilePlan(posting, profile, bank),
  formFields: questions.length,
  tailored,
  starter,
  bank,
  attachedFilename: 'Priya Raman CV.pdf',
});

/* ──────────────────── three states, never two (FR-40) ──────────────────── */

test('a form we never asked about is "unread", not "unpublished"', () => {
  // formReadable defaults to false, so reading it before checking whether a
  // fetch ever happened reports every un-ingested posting as a vendor that
  // publishes nothing. That is the conflation the schema comment was written
  // about, and it turns a gap in our coverage into a false claim about theirs.
  assert.equal(formState({ formFetchedAt: null, formReadable: false }), 'unread');
  assert.equal(
    formState({ formFetchedAt: null, formReadable: true }),
    'unread',
    'never asked outranks any stale readability flag',
  );
});

test('a vendor that publishes no form is "unpublished", and a read one is "readable"', () => {
  const at = new Date('2026-09-20T00:00:00Z');
  assert.equal(formState({ formFetchedAt: at, formReadable: false }), 'unpublished');
  assert.equal(formState({ formFetchedAt: at, formReadable: true }), 'readable');
});

/* ─────────── an unknown total is never rendered as a number ─────────── */

test('no form means fields is null and coverage is null — never zero, never a percentage', () => {
  const kit = buildKit({
    job: { ...jobRow, formFetchedAt: null, formReadable: false },
    plan: null,
    formFields: null,
    tailored,
    starter,
    bank,
    attachedFilename: 'Priya Raman CV.pdf',
  });

  // A 0 here renders as "this employer asks nothing", and a percentage against
  // an unknown denominator is a guess wearing a number's clothes. Both look
  // like a complete Kit to the person reading it.
  assert.equal(kit.form.fields, null);
  assert.equal(kit.form.coverage, null);
  assert.notEqual(kit.form.stated, 0, 'a Kit still ships (FR-43)');
});

test('an unreadable form still ships a Kit, and says the questions are not the employer\'s', () => {
  const kit = buildKit({
    job: { ...jobRow, formFetchedAt: new Date('2026-09-20T00:00:00Z'), formReadable: false },
    plan: null,
    formFields: null,
    tailored,
    starter,
    bank,
    attachedFilename: 'Priya Raman CV.pdf',
  });

  assert.equal(kit.form.state, 'unpublished');
  assert.ok(kit.answers.length > 0, 'FR-43 — silence would be the product failing quietly');
  for (const q of kit.answers) {
    assert.equal(
      q.read, false,
      `"${q.label}" was not read from this form and must not claim to have been`,
    );
  }
  assert.match(kit.form.statement, /not theirs|starting point/i);
});

test('every question read from a real form is marked as read', () => {
  assert.equal(readableKit.form.state, 'readable');
  for (const q of [...readableKit.answers, ...readableKit.yours, ...readableKit.openItems]) {
    assert.equal(q.read, true, `"${q.label}" came from the employer's own schema`);
  }
});

/* ──────────── what is theirs stays theirs (FR-6, CLAUDE.md rule 2) ──────────── */

test('a consent or demographic question never reaches the prepared list', () => {
  const privacy = readableKit.yours.find((q) => /privacy notice/i.test(q.label));
  assert.ok(privacy, 'the fixture contains a privacy notice — the case this rule exists for');
  assert.equal(privacy.value, null, 'an attestation is never pre-filled');

  for (const q of readableKit.answers) {
    assert.ok(
      !CONSENT.test(q.label) && !DEMOGRAPHIC.test(q.label),
      `"${q.label}" is the candidate's to answer and must not appear as prepared`,
    );
    assert.ok(q.source !== 'user', 'a "user" answer is never presented as prepared');
  }
});

test('prose is an open item, not a prepared answer', () => {
  // A generated cover letter in the prepared column would read as done. It is
  // a starter with the candidate's gaps still in it (FR-13).
  const letter = readableKit.openItems.find((q) => /cover letter/i.test(q.label));
  assert.ok(letter, 'the fixture asks for a cover letter');
  assert.equal(letter.source, 'generated');
});

/* ─────────────────────── nothing is summed away ─────────────────────── */

test('prepared, yours and open are counted separately and never merged', () => {
  const { prepared, yours, open } = readableKit.counts;
  assert.equal(prepared, readableKit.answers.length);
  assert.equal(yours, readableKit.yours.length);
  assert.equal(open, readableKit.openItems.length);

  // The whole point: a single "ready" figure would absorb the 17.7% only the
  // candidate may answer into a number that looks like progress.
  assert.ok(yours > 0, 'the fixture has questions only the candidate may answer');
  assert.ok(open > 0, 'the fixture has questions nothing could resolve');
  assert.equal(readableKit.form.stated, prepared + yours + open);
});

test('the form\'s size and the plan\'s size are reported separately', () => {
  // The planner drops optional profile questions left blank. For coverage that
  // is correct; for a candidate deciding what to fill in, a field they never
  // see is a field they cannot decide about — so the difference is named.
  assert.equal(readableKit.form.fields, questions.length);
  assert.ok(readableKit.form.skippedOptionalBlank >= 0);
  assert.equal(
    readableKit.form.stated + readableKit.form.skippedOptionalBlank,
    readableKit.form.fields,
    'every question on the form is either stated or explicitly accounted for',
  );
});

/* ───────────────────────── nothing leaks ───────────────────────── */

test('a file answer shows the document name, never a path on our disk', () => {
  const file = readableKit.answers.find((q) => q.source === 'file');
  assert.ok(file, 'the fixture asks for a résumé');
  assert.equal(file.value, 'Priya Raman CV.pdf');

  const serialised = JSON.stringify(readableKit);
  assert.ok(
    !serialised.includes('storage/resumes'),
    'the résumé\'s location on our disk must not reach the client',
  );
  assert.ok(!serialised.includes('C:/Users'), 'no filesystem path in a Kit');
});

test('the résumé in a Kit is the candidate\'s own words', () => {
  // The Kit is the last thing between tailoring and a real application, so it
  // re-asserts the integrity check rather than trusting it (CLAUDE.md rule 1).
  assert.equal(readableKit.resume.integrityOk, true);
  assert.ok(readableKit.resume.bulletsKept <= readableKit.resume.bulletsAvailable);
});

test('a file question with no résumé on file is an open item, not a blank prepared row', () => {
  // The one field every form in the sample asks for. Rendering it as prepared
  // with an empty value is how a candidate reaches the employer's form
  // believing the attachment is handled.
  const kit = buildKit({
    job: jobRow,
    plan: compilePlan(posting, profile, bank),
    formFields: questions.length,
    tailored,
    starter,
    bank,
    attachedFilename: null,
  });

  for (const q of kit.answers) {
    assert.notEqual(
      q.source, 'file',
      `"${q.label}" claims an attachment while no résumé is on file`,
    );
    assert.notEqual(q.value, null, `"${q.label}" is presented as prepared with no value`);
  }

  const file = kit.openItems.find((q) => /resume|cv/i.test(q.label));
  assert.ok(file, 'the unattachable résumé field is surfaced as an open item');
  assert.match(file.reason ?? '', /no résumé on file/i, 'and says what to do about it');
});

test('a Kit carries the bullets it dropped, not just the ones it kept', () => {
  // The integrity claim — "every line is yours, verbatim" — is an assertion.
  // The kept-and-dropped list with scores is what lets the candidate check it.
  // A selection you cannot inspect is indistinguishable from a rewrite, so the
  // evidence travels with the claim rather than sitting behind another request.
  assert.ok(readableKit.resume.roles.length > 0, 'the profile has work history');

  const bullets = readableKit.resume.roles.flatMap((r) => [...r.kept, ...r.dropped]);
  const written = profile.experience?.flatMap((r) => r.bullets) ?? [];
  assert.equal(
    bullets.length, written.length,
    'every bullet the candidate wrote is accounted for as kept or dropped',
  );
  for (const b of bullets) {
    assert.ok(
      written.includes(b.text),
      `"${b.text.slice(0, 40)}…" is not a bullet the candidate wrote`,
    );
  }
});

test('every fact in the letter starter is traceable to the profile or the posting', () => {
  // The Kit is where the letter is read and edited, so its provenance has to
  // arrive with it. A starter whose sources are a request away is one nobody
  // checks before sending.
  assert.ok(readableKit.letter.facts.length > 0);
  for (const f of readableKit.letter.facts) {
    assert.ok(
      f.source === 'profile' || f.source === 'posting',
      `"${f.field}" has no traceable source`,
    );
    assert.ok(f.value.length > 0, `"${f.field}" is empty`);
  }
  assert.equal(readableKit.letter.grounded, readableKit.letter.facts.length);
});

test('asked, evidenced and missing keywords stay separate', () => {
  const { asked, evidenced, missing } = readableKit.resume;
  // "salesforce" is asked for and not claimed — an honest gap, and exactly the
  // kind of thing a résumé optimiser reports as a keyword to insert. We report
  // it as something the candidate does not have.
  assert.ok(asked.includes('salesforce'));
  assert.ok(missing.includes('salesforce'));
  assert.ok(!evidenced.includes('salesforce'));
});

/* ───────────── a run never disagrees with the Kit it links to ───────────── */

test('a run counts exactly what the Kit shows, with and without a résumé on file', () => {
  // The run once counted every file action as prepared. With no résumé on
  // file the Kit lists that field as open — so the worklist said "ready" about
  // the one field every form in the sample asks for, and the Kit it linked to
  // said otherwise.
  const plan = compilePlan(posting, profile, bank);
  for (const attachedFilename of ['Priya Raman CV.pdf', null]) {
    const kit = buildKit({
      job: jobRow, plan, formFields: questions.length, tailored, starter, bank, attachedFilename,
    });
    const row = runRow({
      job: jobRow, plan, questions: questions.length, hasAttachment: attachedFilename !== null,
    });
    assert.ok(row.ok);
    assert.deepEqual(
      { prepared: row.counts.prepared, yours: row.counts.yours, open: row.counts.open },
      kit.counts,
      `attachment: ${attachedFilename ?? 'none'}`,
    );
  }

  const without = runRow({ job: jobRow, plan, questions: questions.length, hasAttachment: false });
  const withCv = runRow({ job: jobRow, plan, questions: questions.length, hasAttachment: true });
  assert.ok(without.ok && withCv.ok);
  assert.equal(without.counts.prepared, withCv.counts.prepared - 1, 'the résumé field moves, it does not vanish');
  assert.equal(without.counts.open, withCv.counts.open + 1);
});

test('a run names an unread form as unread, not as one the employer does not publish', () => {
  const unread = runRow({
    job: { formFetchedAt: null, formReadable: false }, plan: null, questions: 0, hasAttachment: true,
  });
  const unpublished = runRow({
    job: { formFetchedAt: new Date('2026-09-20T00:00:00Z'), formReadable: false },
    plan: compilePlan({ ...posting, questions: [] }, profile, bank),
    questions: 0,
    hasAttachment: true,
  });
  assert.ok(!unread.ok && !unpublished.ok);
  assert.match(unread.reason, /not read/);
  assert.match(unpublished.reason, /publishes no/);
  // An unpublished form must not become an item reporting "0 fields" either.
  assert.notEqual(unread.reason, unpublished.reason);
});
