/**
 * The popup.
 *
 * Reports what was filled, what was deliberately skipped and why, and what the
 * form asks that we could not answer. A fill that silently covers two thirds of
 * a form is the failure this panel exists to prevent, so every count is shown —
 * including the zeroes, and including the fields we chose not to touch.
 */

interface PlanAction {
  label: string;
  labelKey: string;
  fieldName: string;
  required: boolean;
  source: string;
  value: string | null;
}

interface Report {
  blocked: string | null;
  attached: string | null;
  fill: Array<{ via: string; questionLabel: string; kind: string }>;
  skipped: Array<{ questionLabel: string; reason: string }>;
  unmatched: Array<{ questionLabel: string; required: boolean }>;
  unplanned: Array<{ label: string }>;
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing from popup.html`);
  return el;
};

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));

const row = (chip: string, cls: string, text: string): string =>
  `<div class="row"><span class="chip ${cls}">${esc(chip)}</span><span>${esc(text)}</span></div>`;

async function run(): Promise<void> {
  const out = $('out');
  const button = $('go') as HTMLButtonElement;

  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!current?.url) {
    out.innerHTML = row('stopped', 'bad', 'no active tab to read');
    return;
  }

  button.disabled = true;
  out.textContent = 'Working out which posting this is…';

  const prepared = await chrome.runtime.sendMessage({ type: 'landfall:prepare', url: current.url });

  if (!prepared?.ok) {
    out.innerHTML = row('stopped', 'bad', prepared?.error ?? 'unknown error');
    button.disabled = false;
    return;
  }

  const heading = row(prepared.posting.company, 'ok', prepared.posting.title);

  if (prepared.plan.formState !== 'readable') {
    out.innerHTML = heading
      + row('no plan', 'warn', prepared.plan.message ?? 'this vendor publishes no form schema');
    button.disabled = false;
    return;
  }

  const actions = (prepared.plan.actions ?? []).map((a: PlanAction) => ({
    questionLabel: a.label,
    labelKey: a.labelKey,
    fieldName: a.fieldName,
    required: a.required,
    source: a.source,
    value: a.value ?? undefined,
  }));

  if (!current.id) {
    out.innerHTML = heading + row('stopped', 'bad', 'this tab cannot be scripted');
    button.disabled = false;
    return;
  }

  let report: Report;
  try {
    report = await chrome.tabs.sendMessage(current.id, {
      type: 'landfall:fill',
      actions,
      resume: prepared.resume,
    }) as Report;
  } catch {
    // "Landfall is not running here" and "Landfall ran and found nothing" are
    // different states, and a spinner would flatten them into one.
    out.innerHTML = heading + row('stopped', 'bad',
      "Landfall is not running on this page. Open the employer's application form on a supported board.");
    button.disabled = false;
    return;
  }

  if (report.blocked) {
    out.innerHTML = heading + row('stopped', 'bad', report.blocked);
    button.disabled = false;
    return;
  }

  const byLabel = report.fill.filter((f) => f.via === 'label').length;

  out.innerHTML = [
    heading,
    row(`${report.fill.length} filled`, 'ok', report.attached
      ? `including ${report.attached}`
      : 'no file attached — check the résumé field yourself before submitting'),

    ...report.skipped.map((s) => row('yours', 'warn', `${s.questionLabel} — ${s.reason}`)),

    ...report.unmatched.map((u) => row(u.required ? 'missing *' : 'missing', 'bad',
      `${u.questionLabel} — the plan expected this field and the page does not have it`)),

    ...report.unplanned.map((u) => row('unplanned', 'warn',
      `${u.label} — on the form, not in the plan. Read it yourself`)),

    byLabel > 0
      ? `<div class="note">${byLabel} field(s) matched by label rather than name — this vendor may have changed how it renders forms.</div>`
      : '',

    '<div class="note"><strong>Nothing was submitted.</strong> Read the form and press their '
    + 'submit button yourself.</div>',
  ].join('');

  button.disabled = false;
}

$('go').addEventListener('click', () => { void run(); });
