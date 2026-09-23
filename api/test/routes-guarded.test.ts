import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every route is authenticated, proved by reading the source.
 *
 * This is the same shape of test as `extension/test/no-submit.test.ts`: it
 * enforces a rule by absence rather than by exercising a path. The rule is
 * CLAUDE.md #7 — `requireCandidate` (or `requireFreshAuth`) is the only way a
 * route learns who is asking.
 *
 * It exists because of what it replaced. Fifteen hand-copied
 * `currentCandidateId()` helpers each returned the first row in the database,
 * and the reason that survived so long is that nothing failed when it was
 * wrong: every endpoint answered confidently, with someone's real CV. A new
 * route that forgets the guard would fail exactly as quietly. This is the thing
 * that makes it loud.
 *
 * The allowlist below is deliberately explicit and deliberately short. Adding
 * to it should feel like a decision, because it is one.
 */

/**
 * Routes that are public on purpose.
 *
 * FR-24: "No account is required to browse; one is required before anything is
 * stored." Everything here is either the door itself or public job data that
 * belongs to the employer, never to a candidate.
 */
const PUBLIC: Record<string, string> = {
  'POST /api/auth/signup': 'the door — creates the account',
  'POST /api/auth/login': 'the door — proves an existing one',
  'GET /api/jobs/resolve': 'employer posting data only; no candidate data is read (FR-24)',
  'GET /api/resume/templates': 'the list of layout names; depends on nothing about anybody',
  // Google sign-in is a door, like the two above it. Nothing here reads
  // candidate data; the callback *creates* the session rather than using one,
  // and it is guarded by the `state` cookie instead — see src/auth/google.ts.
  'GET /api/auth/google/available': 'says whether the server has Google credentials; no data',
  'GET /api/auth/google': 'the door — starts the OAuth redirect',
  'GET /api/auth/google/callback': 'the door — state-checked, and it is what mints the session',
};

/** How the guard may be spelled. `freshCandidate` is account.ts wrapping it. */
const GUARDS = ['requireCandidate(', 'requireFreshAuth(', 'freshCandidate(', 'sessionFromRequest('];

interface Route { method: string; path: string; file: string; guard: string | null }

function routesIn(dir: string): Route[] {
  const found: Route[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = /app\.(get|post|put|patch|delete)\(\s*'([^']+)'/.exec(line);
      if (!m) return;
      // The guard is the first thing a handler does, so a short window is
      // enough — and a wide one would let a guard in the *next* handler count
      // for this one, which is the bug this test is supposed to catch.
      const body = lines.slice(i, i + 25).join('\n');
      const guard = GUARDS.find((g) => body.includes(g)) ?? null;
      found.push({
        method: (m[1] ?? '').toUpperCase(),
        path: m[2] ?? '',
        file,
        guard: guard?.replace('(', '') ?? null,
      });
    });
  }
  return found;
}

const ROUTES = routesIn('src/routes');

test('there are routes to check at all', () => {
  // A regex that silently stops matching would make every assertion below pass.
  assert.ok(ROUTES.length > 30, `expected the full route table, found ${ROUTES.length}`);
});

test('every route is guarded, or is on the public list with a reason', () => {
  const unguarded = ROUTES
    .filter((r) => r.guard === null)
    .filter((r) => !(`${r.method} ${r.path}` in PUBLIC));

  assert.deepEqual(
    unguarded.map((r) => `${r.method} ${r.path} (${r.file})`),
    [],
    'these routes read or write candidate data with nothing checking who is asking. '
    + 'Add requireCandidate — or, if it is genuinely public, add it to PUBLIC here '
    + 'with the reason it is safe.',
  );
});

test('the public list has no stale entries', () => {
  // A route that was made public, then deleted or later guarded, must not leave
  // a standing exemption behind for the next route that reuses its path.
  const live = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  const stale = Object.keys(PUBLIC).filter((k) => !live.has(k));
  assert.deepEqual(stale, [], 'these are exempted but no longer exist as written');

  const guardedAnyway = Object.keys(PUBLIC).filter((k) => {
    const r = ROUTES.find((x) => `${x.method} ${x.path}` === k);
    return r?.guard != null && r.guard !== 'sessionFromRequest';
  });
  assert.deepEqual(guardedAnyway, [], 'these are guarded now, so the exemption should go');
});

test('data leaving or changing asks for a recent password (FR-27)', () => {
  // The three points REQUIREMENTS FR-27 names after the posture-C amendment:
  // where the record leaves, where it is destroyed, and where it is rewritten.
  const needFresh = ['GET /api/export', 'DELETE /api/account', 'PUT /api/profile'];
  for (const key of needFresh) {
    const route = ROUTES.find((r) => `${r.method} ${r.path}` === key);
    assert.ok(route, `${key} has gone missing`);
    assert.ok(
      route.guard === 'requireFreshAuth' || route.guard === 'freshCandidate',
      `${key} is guarded by ${route.guard}, but FR-27 wants a fresh password proof`,
    );
  }
});

test('no route still resolves the candidate by findFirst', () => {
  // The exact shape of the bug this whole layer replaced.
  const offenders: string[] = [];
  for (const file of readdirSync('src/routes').filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join('src/routes', file), 'utf8');
    if (/candidate\.findFirst\s*\(/.test(src)) offenders.push(file);
  }
  assert.deepEqual(
    offenders, [],
    'resolving the candidate with findFirst() returns whoever is first in the '
    + 'database, which is how every account read as the same person.',
  );
});
