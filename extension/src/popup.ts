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
    // "Not connected" is the one failure the person can fix from this popup,
    // so open the panel that fixes it rather than describing it and leaving
    // them to find the disclosure triangle.
    if (prepared?.needsToken) {
      const panel = document.getElementById('conn');
      if (panel instanceof HTMLDetailsElement) {
        panel.open = true;
        (document.getElementById('token') as HTMLInputElement | null)?.focus();
      }
    }
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

/* ── connection settings ───────────────────────────────────────────────────
 *
 * The address and the token were both hardcoded — the API at a developer's
 * loopback port, and no credential at all. That held exactly as long as the
 * product had no accounts and ran on one machine.
 *
 * Saving an address also *requests permission for it*. A Chrome extension
 * cannot fetch an origin it was not granted, and the failure is a bare
 * "failed to fetch" that looks identical to the server being down — so the
 * grant is asked for at the moment the address is typed, where the answer
 * still makes sense.
 */

const conn = {
  api: document.getElementById('api') as HTMLInputElement,
  token: document.getElementById('token') as HTMLInputElement,
  save: document.getElementById('save') as HTMLButtonElement,
  forget: document.getElementById('forget') as HTMLButtonElement,
  out: document.getElementById('connOut') as HTMLElement,
  details: document.getElementById('conn') as HTMLDetailsElement,
};

function say(text: string): void {
  conn.out.textContent = text;
}

/** Replaced with the site's own address when downloaded from it (routes/extension.ts). */
const POPUP_DEFAULT_API = 'http://127.0.0.1:5175';

async function loadSettings(): Promise<void> {
  const got = await chrome.storage.local.get(['api', 'token']);
  conn.api.value = typeof got.api === 'string' && got.api ? got.api : POPUP_DEFAULT_API;
  // Never render the token back. Its presence is the only thing worth showing;
  // a field that redisplays a credential is a credential on a screen.
  conn.token.value = '';
  conn.token.placeholder = typeof got.token === 'string' && got.token
    ? 'connected — leave blank to keep'
    : 'lfx_…';
  say(typeof got.token === 'string' && got.token ? 'Connected.' : 'Not connected yet.');
}

conn.save.addEventListener('click', () => {
  void (async () => {
    const api = conn.api.value.trim().replace(/\/+$/, '');
    const token = conn.token.value.trim();

    if (api && !/^https?:\/\//.test(api)) {
      say('The address needs to start with http:// or https://');
      return;
    }

    if (api) {
      // Loopback is already in the manifest; anything else has to be granted,
      // and the prompt must come from this click to count as a user gesture.
      const pattern = `${api}/*`;
      const already = await chrome.permissions.contains({ origins: [pattern] })
        .catch(() => false);
      if (!already) {
        const granted = await chrome.permissions.request({ origins: [pattern] })
          .catch(() => false);
        if (!granted) {
          say('Without permission for that address, Landfall cannot be reached from here.');
          return;
        }
      }
    }

    const patch: Record<string, string> = {};
    if (api) patch.api = api;
    if (token) patch.token = token;
    await chrome.storage.local.set(patch);
    await loadSettings();
    say('Saved.');
  })();
});

conn.forget.addEventListener('click', () => {
  void (async () => {
    await chrome.storage.local.remove(['token']);
    await loadSettings();
    // Deliberately only local. Revoking for real happens in Landfall, where the
    // row is deleted — clearing it here just stops this browser using it, and
    // saying otherwise would be a false reassurance.
    say('Forgotten on this browser. Revoke it in Landfall to kill it everywhere.');
  })();
});

void loadSettings();
