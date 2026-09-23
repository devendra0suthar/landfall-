import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

/**
 * The model client, and the one place that knows whether we have one.
 *
 * This is the first thing in Landfall that talks to an LLM, and it is
 * deliberately optional. Everything else in the product — ingest, the plan
 * compiler, tailoring, scoring, the Kit — is deterministic and works with no
 * key set, and that stays true: a missing key disables the suggestion feature
 * and nothing else. `pnpm test` therefore runs offline, which is what makes
 * the rule-1 verifier in `src/suggest/verify.ts` testable at all.
 */

export const SUGGEST_MODEL = 'claude-opus-5';

let cached: Anthropic | null | undefined;

export function claudeClient(): Anthropic | null {
  if (cached !== undefined) return cached;
  try {
    // The SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or a stored
    // profile itself.
    cached = new Anthropic();
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Whether the suggestion routes can do anything.
 *
 * Constructing the client is **not** the test. `new Anthropic()` succeeds with
 * no credentials at all and only fails when a request is built, which showed up
 * here as a screen offering a working button that returned "the model could not
 * be reached" — a configuration problem reported as an outage.
 *
 * So the credentials are checked directly. The SDK will also accept a stored
 * OAuth profile, which is not visible on the client object, so the CLI's
 * credential directory counts too: a developer who ran `ant auth login` has
 * credentials even with no environment variable set. This stays best-effort by
 * nature, which is why `isAuthFailure` below exists — the request itself is the
 * authority, and this only decides what the screen offers.
 */
export function modelConfigured(): boolean {
  const client = claudeClient();
  if (!client) return false;
  if (client.apiKey !== null && client.apiKey !== undefined) return true;
  if (client.authToken !== null && client.authToken !== undefined) return true;
  return existsSync(join(homedir(), '.config', 'anthropic'));
}

/**
 * Whether a failure was "no credentials" rather than "the model is down".
 *
 * The two want opposite responses — one is fixed by setting an environment
 * variable, the other by waiting — and telling a candidate to wait for a
 * problem that will never resolve is the failure mode being avoided.
 *
 * `AuthenticationError` covers a key the API rejected. The local case, where
 * the SDK cannot find a credential to send, is a plain `Error` with no type to
 * match on, so its message is matched instead — narrowly, and only after the
 * typed check has had its chance.
 */
export function isAuthFailure(err: unknown): boolean {
  if (err instanceof Anthropic.AuthenticationError) return true;
  if (err instanceof Anthropic.PermissionDeniedError) return true;
  return err instanceof Error
    && /could not resolve authentication method/i.test(err.message);
}
