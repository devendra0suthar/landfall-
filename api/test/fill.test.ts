import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { matchPlanToPage } from '../src/fill/match.js';
import type { PageField, PlanAction } from '../src/fill/match.js';

/**
 * Filling, proved against a rendered form before it touches a real one.
 *
 * NFR-11: an executor change is proved against local fixtures first. The
 * fixture here is a genuine Greenhouse schema rendered into HTML — two
 * renderings of it, in fact, because the failure this guards against is a
 * vendor changing how they render and the filler silently covering two thirds
 * of a form while reporting success.
 *
 * No network, no browser, no employer touched.
 */

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/greenhouse-form.json', import.meta.url), 'utf8'),
) as {
  questions: Array<{
    label: string;
    required: boolean;
    fields: Array<{ name: string; type: string; values?: Array<{ label: string; value: string | number }> }>;
  }>;
};

const TAG: Record<string, string> = {
  input_text: 'text', textarea: 'textarea', input_file: 'file',
  multi_value_single_select: 'select', multi_value_multi_select: 'select',
};

/**
 * Render the schema the way a well-behaved vendor does: every input carries the
 * name the API advertised.
 */
function renderWithNames(): string {
  const parts = fixture.questions.map((q, i) => {
    const f = q.fields[0]!;
    const kind = TAG[f.type] ?? 'text';
    const id = `q${i}`;
    if (kind === 'select') {
      const opts = (f.values ?? []).map((v) => `<option>${v.label}</option>`).join('');
      return `<label for="${id}">${q.label}</label><select id="${id}" name="${f.name}">${opts}</select>`;
    }
    if (kind === 'textarea') return `<label for="${id}">${q.label}</label><textarea id="${id}" name="${f.name}"></textarea>`;
    if (kind === 'file') return `<label for="${id}">${q.label}</label><input type="file" id="${id}" name="${f.name}">`;
    return `<label for="${id}">${q.label}</label><input type="text" id="${id}" name="${f.name}">`;
  });
  return `<form>${parts.join('')}</form>`;
}

/**
 * Render it the way Greenhouse's React front end actually does for custom
 * questions: the `name` attribute is gone, and only the label identifies the
 * field. Measured in Phase 0; this is the case the fallbacks exist for.
 */
function renderWithoutNames(): string {
  return renderWithNames().replace(/ name="[^"]*"/g, '');
}

/** Read a rendered page the way a content script would. */
function readFields(html: string): PageField[] {
  const { document } = new JSDOM(html).window;
  return [...document.querySelectorAll('input, select, textarea')].map((el, i) => {
    const id = el.getAttribute('id');
    const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() ?? null : null;
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const kind: PageField['kind'] = tag === 'select'
      ? 'select'
      : tag === 'textarea'
        ? 'textarea'
        : type === 'file'
          ? 'file'
          : type === 'checkbox'
            ? 'checkbox'
            : 'text';
    return {
      name: el.getAttribute('name'),
      id,
      label,
      kind,
      ...(kind === 'select'
        ? { options: [...el.querySelectorAll('option')].map((o) => o.textContent?.trim() ?? '') }
        : {}),
      handle: `f${i}`,
    };
  });
}

/** A plan of the shape compilePlan produces for this form. */
const plan: PlanAction[] = fixture.questions.map((q) => {
  const f = q.fields[0]!;
  const label = q.label.toLowerCase();
  if (/privacy notice|consent/.test(label)) {
    return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'user', required: q.required };
  }
  if (/cover letter/.test(label)) {
    return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'generated', required: q.required };
  }
  if (/resume|cv/.test(label)) {
    return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'file', value: 'C:/storage/resume.pdf', required: q.required };
  }
  if (/first name/.test(label)) return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'profile', value: 'Priya', required: q.required };
  if (/last name/.test(label)) return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'profile', value: 'Raman', required: q.required };
  if (/email/.test(label)) return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'profile', value: 'priya.raman@fastmail.in', required: q.required };
  if (/phone/.test(label)) return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'profile', value: '+91 98290 41765', required: q.required };
  if (/linkedin/.test(label)) return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'profile', value: 'https://www.linkedin.com/in/priyaraman', required: q.required };
  if (f.values?.length) {
    return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'bank', value: f.values[0]!.label, required: q.required };
  }
  return { fieldName: f.name, questionLabel: q.label, labelKey: label, source: 'unresolved', required: q.required };
});

/* ─────────────────────────── the tests ─────────────────────────── */

test('fills every planned field on a well-rendered form', () => {
  const r = matchPlanToPage(plan, readFields(renderWithNames()));
  assert.equal(r.unmatched.length, 0, `unmatched: ${r.unmatched.map((u) => u.questionLabel).join(', ')}`);
  const fillable = plan.filter((a) => ['profile', 'bank', 'file'].includes(a.source)).length;
  assert.equal(r.fill.length, fillable);
  assert.ok(r.fill.every((f) => f.via === 'name'), 'a vendor that publishes names is matched by name');
});

test('still fills the form when the renderer drops every name attribute', () => {
  // The measured Greenhouse React case. Without the label fallback this
  // silently fills nothing and reports a clean run.
  const r = matchPlanToPage(plan, readFields(renderWithoutNames()));
  assert.equal(r.unmatched.length, 0);
  assert.ok(r.fill.every((f) => f.via === 'label'), 'and it records that the weaker route was used');
});

test('never fills a consent or attestation field', () => {
  for (const html of [renderWithNames(), renderWithoutNames()]) {
    const r = matchPlanToPage(plan, readFields(html));
    const privacy = /privacy notice/i;
    assert.ok(!r.fill.some((f) => privacy.test(f.questionLabel)), 'the privacy notice is never touched');
    const skipped = r.skipped.find((s) => privacy.test(s.questionLabel));
    assert.ok(skipped, 'and it is reported as deliberately skipped, not quietly dropped');
    assert.match(skipped.reason, /yours to answer/);
  }
});

test('never writes prose the candidate has not written', () => {
  const r = matchPlanToPage(plan, readFields(renderWithNames()));
  assert.ok(!r.fill.some((f) => /cover letter/i.test(f.questionLabel)));
  assert.ok(r.skipped.some((s) => /cover letter/i.test(s.questionLabel)));
});

test('refuses a value a dropdown does not offer', () => {
  // Phase 0 measured this: a profile's free-text "she/her" pushed at a
  // four-option pronouns select matched nothing and failed silently.
  const fields = readFields(renderWithNames());
  const select = fields.find((f) => f.kind === 'select');
  assert.ok(select, 'the fixture has a dropdown');
  const bogus: PlanAction[] = [{
    fieldName: select.name ?? '', questionLabel: select.label ?? '', labelKey: '',
    source: 'bank', value: 'Definitely Not An Option', required: true,
  }];
  const r = matchPlanToPage(bogus, fields);
  assert.equal(r.fill.length, 0);
  assert.match(r.skipped[0]!.reason, /not one of the \d+ options/);
});

test('reports a planned field that is no longer on the page', () => {
  const fields = readFields(renderWithNames()).filter((f) => !/email/i.test(f.label ?? ''));
  const r = matchPlanToPage(plan, fields);
  assert.ok(r.unmatched.some((u) => /email/i.test(u.questionLabel)),
    'a field the plan expects and the page lacks is named, not silently skipped');
});

test('reports a field on the page that the plan did not know about', () => {
  const html = renderWithNames().replace('</form>',
    '<label for="extra">Do you agree to the terms?</label><input type="checkbox" id="extra" name="terms"></form>');
  const r = matchPlanToPage(plan, readFields(html));
  assert.ok(r.unplanned.some((u) => /terms/i.test(u.label)),
    'a late-added consent checkbox is surfaced rather than ignored');
  assert.ok(!r.fill.some((f) => /terms/i.test(f.questionLabel)), 'and never ticked');
});

test('never fills the same field twice', () => {
  const r = matchPlanToPage([...plan, ...plan], readFields(renderWithNames()));
  const handles = r.fill.map((f) => f.handle);
  assert.equal(new Set(handles).size, handles.length);
});

test('writes nothing when the plan resolved a field but carried no value', () => {
  const broken: PlanAction[] = [{
    fieldName: 'first_name', questionLabel: 'First Name', labelKey: 'first name',
    source: 'profile', value: '', required: true,
  }];
  const r = matchPlanToPage(broken, readFields(renderWithNames()));
  assert.equal(r.fill.length, 0, 'an empty string is not an answer');
  assert.match(r.skipped[0]!.reason, /carried no value/);
});
