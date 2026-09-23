#!/usr/bin/env node
/**
 * The design system, checked without a browser.
 *
 * Browser automation does not work on this machine, so the front end is never
 * seen by a test — which means the two failure modes that cost the most here
 * are the ones nothing catches: a class the CSS does not define (the element
 * renders unstyled and nobody notices until a screenshot), and a colour pair
 * that fails WCAG (nobody notices at all, because the person it fails is not
 * the person reviewing it).
 *
 * Both were being re-derived by hand every time the design changed. They are a
 * gate now. NFR-5 commits this product to WCAG 2.2 AA; this is the part of that
 * commitment a machine can hold.
 *
 * Run: pnpm --filter ./web check:design
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = 'src/styles.css';
const SRC = 'src';

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`pass  ${msg}`);

/* ── 1. every className used exists in the stylesheet ─────────────────────── */

const css = readFileSync(CSS, 'utf8');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

const used = new Map();
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const text = readFileSync(path, 'utf8');
    // Only literal className strings. A computed one cannot be checked here,
    // and guessing at template literals would produce false alarms that train
    // people to ignore this script.
    for (const m of text.matchAll(/className=["'`]([^"'`{}]+)["'`]/g)) {
      for (const name of m[1].split(/\s+/).filter(Boolean)) {
        if (!used.has(name)) used.set(name, new Set());
        used.get(name).add(path);
      }
    }
  }
}(SRC));

const undefinedClasses = [...used.keys()].filter((c) => !defined.has(c));
if (undefinedClasses.length > 0) {
  for (const c of undefinedClasses) {
    fail(`.${c} is used in ${[...used.get(c)].join(', ')} but defined nowhere in ${CSS}`);
  }
} else {
  pass(`${used.size} class names used, all defined`);
}

/* ── 2. colour pairs meet WCAG 2.2 AA, in both themes ─────────────────────── */

function tokensIn(block) {
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)) out[m[1]] = m[2];
  return out;
}

const light = tokensIn(css.slice(0, css.indexOf('@media')));
const darkStart = css.indexOf('prefers-color-scheme: dark');
const darkBlock = css.slice(darkStart, css.indexOf('}\n}', darkStart) + 3);
// Dark is a palette swap over light, so anything it does not override is
// inherited — which is exactly how the focus ring failed in dark mode only.
const dark = { ...light, ...tokensIn(darkBlock) };

function channels(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * What must pass, and why each one is here.
 *
 * 4.5 is AA for body text (1.4.3). 3.0 is the floor for a UI component boundary
 * or a graphical object carrying meaning (1.4.11) — borders, rings, meter fills.
 */
const PAIRS = [
  ['body text', '--ink', '--paper', 4.5],
  ['body text on card', '--ink', '--surface', 4.5],
  ['muted label', '--ink-muted', '--surface', 4.5],
  ['muted label on tint', '--ink-muted', '--surface-2', 4.5],
  ['link', '--deep', '--surface', 4.5],
  ['primary button text', '--deep-ink', '--deep', 4.5],
  ['nav item', '--nav-fg-dim', '--nav-bg', 4.5],
  ['nav item hover', '--nav-fg', '--nav-bg', 4.5],
  ['good', '--good', '--good-soft', 4.5],
  ['warn', '--warn', '--warn-soft', 4.5],
  ['stop', '--stop', '--stop-soft', 4.5],
  ['focus ring', '--ring', '--surface', 3.0],
  ['focus ring on page', '--ring', '--paper', 3.0],
  ['input border', '--field-line', '--surface', 3.0],
  ['input border on page', '--field-line', '--paper', 3.0],
  // The score bar is a graphical object conveying information, so 1.4.11
  // applies to it against its own track. Note it is --deep, not --deep-bright:
  // the brand cyan manages 2.12:1 here, which is why the bright shade is
  // confined to the aria-hidden wordmark rule.
  ['meter fill', '--deep', '--rule-soft', 3.0],
  ['meter fill, good', '--good', '--rule-soft', 3.0],
  ['meter fill, warn', '--warn', '--rule-soft', 3.0],
  ['meter fill, low', '--ink-muted', '--rule-soft', 3.0],
];

for (const [name, fg, bg, need] of PAIRS) {
  for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
    const a = tokens[fg];
    const b = tokens[bg];
    if (!a || !b) { fail(`${theme}: ${name} — ${!a ? fg : bg} is not defined`); continue; }
    const r = ratio(a, b);
    if (r < need) {
      fail(`${theme}: ${name} — ${a} on ${b} is ${r.toFixed(2)}:1, needs ${need}:1`);
    }
  }
}
if (failures === 0) pass(`${PAIRS.length} colour pairs meet AA in both themes`);

process.exit(failures === 0 ? 0 : 1);
