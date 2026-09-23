import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signing in with Google (FR-24).
 *
 * The authorization-code flow, by hand, because it is about eighty lines and a
 * Passport strategy would bring a plugin surface and a release cadence to guard
 * one redirect. The parts that are actually load-bearing are small and are all
 * here, stated:
 *
 *   1. **`state` is checked, not just sent.** It is a random value put in a
 *      short-lived cookie and echoed through Google. Without comparing it on
 *      the way back, anyone can hand a victim a callback URL carrying their own
 *      code and silently attach the victim's browser to the attacker's account.
 *      The comparison is timing-safe for the same reason password comparison
 *      is.
 *   2. **`email_verified` is required.** Google will happily report an
 *      unverified address on some workspace configurations. Since an account
 *      here is matched by email when no `googleId` is on file yet, accepting an
 *      unverified one would let someone claim a Landfall account by asserting
 *      its owner's address.
 *   3. **The id token is read from the token endpoint's response**, over TLS,
 *      direct from Google — not from anything the browser handed us — so it
 *      needs no signature check of its own. That is the whole reason to do the
 *      exchange server-side.
 *
 * Optional, like the model: with no client id configured the routes report
 * themselves unavailable and the button does not render. Email sign-in is
 * unaffected, and a deployment that never sets these is not a broken one.
 */

export const STATE_COOKIE = 'landfall_oauth_state';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Where Google sends the browser back to.
 *
 * Derived from the request rather than hardcoded, so the same build works on
 * localhost and on the deployed origin without a second configuration value to
 * get wrong — but overridable, because behind a proxy the scheme can arrive as
 * http even though the public URL is https, and Google matches this string
 * exactly against the console entry.
 */
export function redirectUri(req: { protocol: string; hostname: string; headers: Record<string, unknown> }): string {
  const configured = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return `${configured}/api/auth/google/callback`;
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  const scheme = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? req.hostname);
  return `${scheme}://${host}/api/auth/google/callback`;
}

/** A random, unguessable value for the `state` parameter. */
export function newState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Compare the returned state against the one we issued.
 *
 * Timing-safe and length-checked. Hashing both sides first means unequal
 * lengths do not leak through an early return, which `timingSafeEqual` would
 * otherwise throw on.
 */
export function stateMatches(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function authorizeUrl(cfg: GoogleConfig, redirect: string, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // We want an email address, not a standing grant: no refresh token is
    // requested, because nothing here ever acts as the candidate on Google.
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
}

/** Decode a JWT payload. The token came straight from Google over TLS. */
function decodeIdToken(idToken: string): Record<string, unknown> | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Exchange the code for an identity, or return null.
 *
 * Never throws for a bad code or a hostile callback — those are ordinary
 * outcomes of a public endpoint, and a 500 on each one is a log full of noise
 * that hides the real failure.
 */
export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  redirect: string,
): Promise<GoogleIdentity | null> {
  let res: Response;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = await res.json().catch(() => null) as { id_token?: string } | null;
  if (!body?.id_token) return null;

  const claims = decodeIdToken(body.id_token);
  if (!claims) return null;

  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  // Google sends this as a boolean or the string "true" depending on the path.
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  // The audience must be us. A token minted for another client is not a
  // statement about anyone's identity *here*.
  const audience = typeof claims.aud === 'string' ? claims.aud : '';

  if (!sub || !email || !verified || audience !== cfg.clientId) return null;

  const str = (k: string): string | null => (typeof claims[k] === 'string' && claims[k] ? claims[k] as string : null);
  return {
    sub,
    email,
    emailVerified: verified,
    name: str('name'),
    givenName: str('given_name'),
    familyName: str('family_name'),
  };
}
