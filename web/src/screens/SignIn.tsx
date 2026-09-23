import { useState } from 'react';
import { api } from '../api.js';
import type { Me } from '../api.js';

/**
 * The door (FR-24).
 *
 * Until this existed there wasn't one: every endpoint answered as whichever
 * candidate happened to be first in the database, which was fine for one person
 * on a laptop and is a data breach on a public URL.
 *
 * Two things here are deliberately *less* helpful than convention:
 *
 *   - **Sign-up does not say "that email is taken."** That reply is an account
 *     enumeration oracle, and the people using this are job seekers whose
 *     current employer should not be able to test whether they have an account
 *     here. The server returns the same shaped refusal either way, and this
 *     screen does not invent a friendlier one.
 *   - **There is no password strength meter.** The only rule is length, because
 *     composition rules push people towards "Password1!". The rule is stated up
 *     front rather than enforced by a bouncing red bar.
 */

type Mode = 'in' | 'up';

export function SignIn({ onSignedIn }: { onSignedIn: (me: Me) => void }): React.ReactElement {
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/auth/${mode === 'in' ? 'login' : 'signup'}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      // Re-read rather than trusting the write's reply: `me` is the one shape
      // the shell renders from, and two sources for it would drift.
      const me = await api<Me>('/api/auth/me');
      onSignedIn(me);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="card flow gate-card" onSubmit={(e) => void submit(e)}>
        <div>
          <span className="wordmark gate-mark">Landfall</span>
          <p className="sub">
            {mode === 'in'
              ? 'Sign in to your applications, profile and saved answers.'
              : 'Create an account. Nothing is stored until you do.'}
          </p>
        </div>

        <label className="field">
          <span className="lbl">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="lbl">Password</span>
          <input
            type="password"
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'up' && (
            <span className="sub">At least 10 characters. A phrase you can remember beats a short scramble.</span>
          )}
        </label>

        {err && (
          <div className="note bad">
            <span className="lbl">That did not work</span>
            <p>{err}</p>
          </div>
        )}

        <button className="btn p" type="submit" disabled={busy}>
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>

        <p className="sub">
          {mode === 'in' ? 'No account yet? ' : 'Already have one? '}
          <button
            type="button"
            className="btn linkish"
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null); }}
          >
            {mode === 'in' ? 'Create one' : 'Sign in'}
          </button>
        </p>

        <p className="sub gate-foot">
          Your data is stored in one region and never leaves it. You can export
          everything or delete the account from inside the product.
        </p>
      </form>
    </div>
  );
}

/**
 * FR-27: prove the password again, in place.
 *
 * Shown when the API answers 403 with `reauth` — the session is still valid,
 * but it has been long enough that exporting or changing data should cost a
 * password. Rendered over the app rather than replacing it, so nobody loses
 * what they were in the middle of.
 */
export function ReauthPrompt({ onDone, onCancel }: {
  onDone: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api('/api/auth/confirm', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      onDone();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="gate gate-over" role="dialog" aria-modal="true" aria-label="Confirm your password">
      <form className="card flow gate-card" onSubmit={(e) => void submit(e)}>
        <div>
          <span className="lbl">Confirm it is you</span>
          <p>
            You have been signed in a while. Changing your profile or exporting
            your data asks for your password again.
          </p>
        </div>
        <label className="field">
          <span className="lbl">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {err && <div className="note bad"><p>{err}</p></div>}
        <div className="row split">
          <button type="button" className="btn" onClick={onCancel}>Not now</button>
          <button className="btn p" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
