// The matcher is the same module the API and the test harness use. One
// implementation, proved against two renderings of a real form in
// api/test/fill.test.ts. If this ever needs its own copy, the copy is the bug.
import { matchPlanToPage } from '../../api/src/fill/match.js';
import type { MatchResult, PageField, PlanAction } from '../../api/src/fill/match.js';

/**
 * Tier A, in the page.
 *
 * Reads the employer's own form, fills what the plan resolved, and stops. The
 * candidate reads what is there and presses submit themselves.
 *
 * There is deliberately no code in this file that submits a form. Not a guarded
 * path, not a flag, not a disabled branch — nothing that calls `submit()` or
 * clicks a submit control. A rule enforced by absence cannot be switched on by
 * a config change or a well-meaning patch.
 */

interface FillRequest {
  type: 'landfall:fill';
  actions: PlanAction[];
  /** The résumé, fetched by the service worker where host permissions live. */
  resume?: { filename: string; contentType: string; base64: string };
}

interface FillReport extends MatchResult {
  type: 'landfall:report';
  url: string;
  blocked: string | null;
  attached: string | null;
}

/* ─────────────────── reading the page ─────────────────── */

const LABEL_SELECTORS = ['label[for]', '[aria-labelledby]'];

function labelFor(el: Element, doc: Document): string | null {
  const id = el.getAttribute('id');
  if (id) {
    const l = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return aria.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = doc.getElementById(by)?.textContent;
    if (t) return t.trim();
  }
  // Last resort: a wrapping label, which is how several vendors mark up
  // checkboxes.
  const wrapping = el.closest('label')?.textContent;
  return wrapping ? wrapping.trim() : null;
}

function kindOf(el: Element): PageField['kind'] {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  const type = (el as HTMLInputElement).type;
  if (type === 'file') return 'file';
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (['text', 'email', 'tel', 'url', 'number', 'search'].includes(type)) return 'text';
  return 'unknown';
}

const handles = new Map<string, Element>();

function readFields(doc: Document): PageField[] {
  handles.clear();
  const els = [...doc.querySelectorAll('input, select, textarea')];
  return els.map((el, i) => {
    const handle = `h${i}`;
    handles.set(handle, el);
    const kind = kindOf(el);
    return {
      name: el.getAttribute('name'),
      id: el.getAttribute('id'),
      label: labelFor(el, doc),
      kind,
      ...(kind === 'select'
        ? { options: [...el.querySelectorAll('option')].map((o) => o.textContent?.trim() ?? '') }
        : {}),
      handle,
    };
  });
}

/* ─────────────────── writing to the page ─────────────────── */

/**
 * Set a value the way a person would, as far as the page can tell.
 *
 * React and friends listen for input/change rather than reading the DOM
 * property, and setting `.value` directly bypasses their tracker — the field
 * looks filled and submits empty. Writing through the native setter and then
 * dispatching both events is what makes the framework believe it.
 */
function setValue(el: Element, value: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Attach the résumé to a file input.
 *
 * A page cannot set `input.files`, but an extension holding real bytes can,
 * through a DataTransfer. Returns the filename when it worked so the report can
 * say so — and null when it did not, because a candidate who believes their CV
 * is attached and submits without it is the worst outcome this feature has.
 */
function attachFile(el: Element, file: { filename: string; contentType: string; base64: string }): string | null {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') return null;
  try {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.filename, { type: file.contentType }));
    el.files = dt.files;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.files.length === 1 ? file.filename : null;
  } catch {
    return null;
  }
}

/* ─────────────────── walls we do not climb ─────────────────── */

/**
 * Something between the candidate and the form.
 *
 * CAPTCHAs are detected and never solved; a login wall is not ours to pass.
 * The run ends and the tab is left exactly as it is, for the person to finish.
 */
function blockedBy(doc: Document): string | null {
  const captcha = doc.querySelector(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, [data-sitekey], iframe[src*="turnstile"]',
  );
  if (captcha) return 'This form is behind a CAPTCHA. Landfall does not solve those — finish it yourself and the tab stays as it is.';

  const form = doc.querySelector('form');
  if (!form) return 'No application form on this page yet — open the posting\'s Apply view first.';

  const signIn = doc.querySelector('input[type="password"]');
  if (signIn) return 'This page is asking you to sign in. That is yours, not ours.';

  return null;
}

/* ─────────────────── the run ─────────────────── */

chrome.runtime.onMessage.addListener((msg: FillRequest, _sender, respond) => {
  if (msg.type !== 'landfall:fill') return undefined;

  const blocked = blockedBy(document);
  if (blocked) {
    const report: FillReport = {
      type: 'landfall:report',
      url: location.href,
      blocked,
      attached: null,
      fill: [], skipped: [], unmatched: [], unplanned: [],
    };
    respond(report);
    return true;
  }

  const fields = readFields(document);
  const result = matchPlanToPage(msg.actions, fields);

  let attached: string | null = null;
  for (const instruction of result.fill) {
    const el = handles.get(instruction.handle);
    if (!el) continue;
    if (instruction.kind === 'file') {
      attached = msg.resume ? attachFile(el, msg.resume) : null;
      continue;
    }
    setValue(el, instruction.value);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const report: FillReport = {
    type: 'landfall:report',
    url: location.href,
    blocked: null,
    attached,
    ...result,
  };
  respond(report);
  return true;
});

// Announce readiness so the popup can tell "no content script here" from
// "content script found nothing" — two states a spinner would flatten into one.
void chrome.runtime.sendMessage({ type: 'landfall:ready', url: location.href }).catch(() => {});

export type { FillReport, FillRequest };
export { LABEL_SELECTORS };
