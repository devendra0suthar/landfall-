import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Tier A means the candidate submits. This test is how that stays true.
 *
 * The rule is enforced by absence — there is no submit code in the extension,
 * not a guarded branch or a disabled flag — and absence is exactly the kind of
 * property that erodes silently. Someone adds a "convenience" click, or a
 * dependency brings one in, and nothing fails until an application has been
 * fired at an employer without a person reading it.
 *
 * So both the source and the built bundle are checked. The bundle matters
 * because that is what Chrome actually runs.
 */

const SUBMIT_PATTERNS: Array<[RegExp, string]> = [
  [/\.submit\s*\(/, 'calls .submit() on a form'],
  [/requestSubmit\s*\(/, 'calls requestSubmit()'],
  [/type\s*=\s*["']submit["'][^>]*\)?\s*\.\s*click/, 'clicks a submit control'],
  [/querySelector\([^)]*\[type=["']?submit/, 'reaches for a submit button'],
  [/button\[type=submit\]/, 'selects a submit button'],
];

function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the extension source contains no way to submit a form', () => {
  const sources = readdirSync(new URL('../src/', import.meta.url))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, read(`../src/${f}`)] as const);

  assert.ok(sources.length >= 3, 'the content script, worker and popup are all checked');

  for (const [name, code] of sources) {
    for (const [re, what] of SUBMIT_PATTERNS) {
      assert.ok(!re.test(code), `${name} ${what} — Tier A means the candidate submits, not us`);
    }
  }
});

test('the built bundle contains no way to submit a form', () => {
  // What Chrome runs is the bundle, not the source. A dependency that submits
  // would never appear in the source at all.
  const built = readdirSync(new URL('../dist/', import.meta.url)).filter((f) => f.endsWith('.js'));
  assert.ok(built.includes('content.js'), 'run `pnpm build:extension` before this test');

  for (const file of built) {
    const code = read(`../dist/${file}`);
    for (const [re, what] of SUBMIT_PATTERNS) {
      assert.ok(!re.test(code), `dist/${file} ${what}`);
    }
  }
});

test('the manifest asks for no permission beyond the boards it fills', () => {
  const manifest = JSON.parse(read('../manifest.json')) as {
    permissions: string[];
    host_permissions: string[];
  };

  // <all_urls> on a form-filling extension is a request to read every page the
  // candidate visits, which is not what this does and not what it should be
  // able to do.
  for (const host of manifest.host_permissions) {
    assert.ok(!/all_urls|\*:\/\/\*\//.test(host), `host permission "${host}" is far wider than this needs`);
  }
  assert.ok(!manifest.permissions.includes('tabs'), 'full tab access is not needed to fill the active one');
  assert.ok(!manifest.permissions.includes('webRequest'), 'this extension never inspects traffic');
});
