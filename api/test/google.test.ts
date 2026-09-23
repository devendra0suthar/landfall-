import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newState, stateMatches, authorizeUrl, redirectUri } from '../src/auth/google.js';

/**
 * The parts of Google sign-in that are security, not plumbing.
 *
 * An OAuth callback is a public endpoint that mints a session, so the two
 * things worth testing are the ones that decide *whose* session it mints: the
 * `state` check, and the shape of the request that starts the flow. The token
 * exchange itself talks to Google and is exercised by using the product.
 */

const cfg = { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'secret' };

test('state values are unguessable and never repeat', () => {
  const seen = new Set(Array.from({ length: 200 }, () => newState()));
  assert.equal(seen.size, 200, 'states collided');
  for (const s of seen) assert.ok(s.length >= 40, 'state is too short to be unguessable');
});

test('state must match exactly, and absence never passes', () => {
  const s = newState();
  assert.equal(stateMatches(s, s), true);
  assert.equal(stateMatches(s, newState()), false);
  // The important cases. A missing cookie or a missing query parameter must
  // never compare equal — otherwise a callback with no state at all is
  // accepted, which is the whole attack.
  assert.equal(stateMatches(undefined, s), false);
  assert.equal(stateMatches(s, undefined), false);
  assert.equal(stateMatches(undefined, undefined), false);
  assert.equal(stateMatches('', ''), false);
  // Different lengths must not throw — timingSafeEqual does, on raw input.
  assert.equal(stateMatches('short', s), false);
});

test('the authorize URL asks for exactly what is needed', () => {
  const url = new URL(authorizeUrl(cfg, 'https://x.test/api/auth/google/callback', 'STATE'));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), cfg.clientId);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'STATE');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://x.test/api/auth/google/callback');
  // An email address, not a standing grant. Nothing here ever acts as the
  // candidate on Google, so no offline access and no refresh token.
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('access_type'), 'online');
  assert.ok(!url.searchParams.has('refresh_token'));
});

test('the redirect URI follows the public origin, not the proxy hop', () => {
  // Render terminates TLS at a proxy, so the request arrives as http. Sending
  // Google an http:// redirect_uri fails the exact-match check in their console
  // and the sign-in dies with a redirect_uri_mismatch nobody can read.
  const behindProxy = {
    protocol: 'http',
    hostname: 'internal',
    headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'landfall.example.com' },
  };
  assert.equal(
    redirectUri(behindProxy),
    'https://landfall.example.com/api/auth/google/callback',
  );
});

test('a configured public URL wins over the request', () => {
  process.env.PUBLIC_URL = 'https://pinned.example.com/';
  try {
    assert.equal(
      redirectUri({ protocol: 'http', hostname: 'whatever', headers: { host: 'whatever' } }),
      'https://pinned.example.com/api/auth/google/callback',
      'a trailing slash must not produce a doubled one',
    );
  } finally {
    delete process.env.PUBLIC_URL;
  }
});

test('x-forwarded-proto with several hops takes the first', () => {
  assert.equal(
    redirectUri({
      protocol: 'http',
      hostname: 'internal',
      headers: { 'x-forwarded-proto': 'https, http', host: 'a.test' },
    }),
    'https://a.test/api/auth/google/callback',
  );
});
