import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { ExtensionToken, ExtensionTokenList, NewExtensionToken } from '../api.js';

/**
 * Connecting the autofill extension (FR-15).
 *
 * The extension is the whole of Landfall's "auto apply": it fills the
 * employer's own form, in the candidate's own browser, and stops. It cannot
 * use the session cookie — it fetches from its own origin, and `SameSite=Lax`
 * correctly refuses to send a cookie cross-site — so it carries a bearer token
 * granted here on purpose.
 *
 * Two things this screen is careful about:
 *
 *   - **The token is shown exactly once.** Only its hash is stored, so there is
 *     no second chance to read it, and the copy is presented as the one action
 *     that matters rather than as a field among fields.
 *   - **Revoking is as prominent as connecting.** A credential you cannot see
 *     the list of is a credential you cannot withdraw, and a long-lived token
 *     with no visible list is how people end up unable to answer "what still
 *     has access to my CV?"
 */
export function ConnectExtension(): React.ReactElement {
  const list = useAsync(() => api<ExtensionTokenList>('/api/auth/extension'), []);
  const [fresh, setFresh] = useState<NewExtensionToken | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function connect(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const made = await api<NewExtensionToken>('/api/auth/extension', {
        method: 'POST',
        body: JSON.stringify(label.trim() ? { label: label.trim() } : {}),
      });
      setFresh(made);
      setLabel('');
      list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function revoke(t: ExtensionToken): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/auth/extension/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
      if (fresh?.id === t.id) setFresh(null);
      list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function copy(): Promise<void> {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the token is on screen to select by
      // hand, so this is a missing convenience rather than a failure.
      setCopied(false);
    }
  }

  const tokens = list.data?.tokens ?? [];

  return (
    <div className="card flow">
      <div>
        <strong>Connect the autofill extension</strong>
        <p className="sub">
          Fills the employer’s form in your own browser, one click, and stops.
          The submit button stays yours.
        </p>
      </div>

      {/*
        * How to get it. There was no way before: not in the Chrome Web Store,
        * no download, so the one feature closest to "apply for me" existed
        * only on a developer's laptop. The download is built for this site —
        * its address is already inside — so step 4 is the only typing.
        */}
      <ol className="install-steps">
        <li>
          <a className="btn p" href="/api/extension/download" download>Download the extension</a>
          <span className="sub"> Works in Chrome, Edge and Brave on a computer.</span>
        </li>
        <li>Unzip it. You get a folder called <span className="mono">landfall-extension</span>.</li>
        <li>
          Open <span className="mono">chrome://extensions</span> (or <span className="mono">edge://extensions</span>),
          turn on <strong>Developer mode</strong>, click <strong>Load unpacked</strong> and choose that folder.
        </li>
        <li>
          Click <strong>Create a connection code</strong> below, then paste it into the extension —
          click its icon, open <strong>Connection</strong>, and save.
        </li>
      </ol>
      <p className="sub">
        It isn’t in the Chrome Web Store yet, which is why Developer mode is needed. It can only
        read and fill job application pages and talk to Landfall — it cannot submit anything.
      </p>

      {err && (
        <div className="note bad">
          <span className="lbl">That did not work</span>
          <p>{err}</p>
        </div>
      )}

      {fresh && (
        <div className="note ok">
          <span className="lbl">Your connection code — shown once</span>
          <p className="mono" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
            {fresh.token}
          </p>
          <p className="sub">{fresh.note}</p>
          <div className="row split">
            <span className="sub">Paste it into the extension popup, under Connection.</span>
            <button className="btn p" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        </div>
      )}

      <div className="row split">
        <label className="field" style={{ flex: 1 }}>
          <span className="lbl">Name this one (optional)</span>
          <input
            value={label}
            placeholder="Work laptop"
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button className="btn p" disabled={busy} onClick={() => void connect()}>
          {busy ? 'Working…' : 'Create a connection code'}
        </button>
      </div>

      <State loading={list.loading} error={list.error} rows={2}>
        <div className="rows">
          {tokens.map((t) => (
            <div className="row split" key={t.id}>
              <div>
                <strong>{t.label ?? 'Unnamed extension'}</strong>
                <div className="sub">
                  connected {new Date(t.createdAt).toLocaleDateString()}
                  {' · '}
                  {t.lastUsedAt
                    ? `last used ${new Date(t.lastUsedAt).toLocaleDateString()}`
                    : 'never used'}
                </div>
              </div>
              <button className="btn" disabled={busy} onClick={() => void revoke(t)}>Revoke</button>
            </div>
          ))}
        </div>
      </State>

      {tokens.length > 0 && (
        <p className="sub">
          Changing your password disconnects every extension here, so it will
          need reconnecting afterwards.
        </p>
      )}
    </div>
  );
}

/**
 * The handoff, shown on the Kit where the decision to apply is actually made.
 *
 * The two halves of this product were disconnected at the one point they meet.
 * The Kit told people to "paste your answers" — while the extension that fills
 * the same form in one click went unmentioned on the screen where they were
 * about to apply. A feature nobody is told about at the moment they need it is
 * a feature that does not exist.
 *
 * It only appears for a form we can actually fill. Offering one-click autofill
 * against a form Landfall could not read would be a promise broken on the
 * click, which is worse than not offering it.
 */
export function ApplyWithExtension({ formState, url }: {
  formState: 'readable' | 'unread' | 'unpublished';
  url: string;
}): React.ReactElement | null {
  const tokens = useAsync(() => api<ExtensionTokenList>('/api/auth/extension'), []);
  if (formState !== 'readable') return null;

  // Undecided while loading: showing "not connected" and then flipping to
  // "connected" is a worse first impression than showing nothing for a moment.
  const connected = tokens.data ? tokens.data.tokens.length > 0 : null;

  return (
    <div className="card flow">
      <header><span className="lbl">Applying</span></header>
      {connected === false ? (
        <>
          <p>
            <strong>Landfall can fill this form for you.</strong> The extension fills the
            employer’s own form in your own browser — every answer below, typed in for you —
            and stops. You read it over and press submit.
          </p>
          <div className="row split">
            <span className="sub">It needs connecting once.</span>
            <a className="btn p" href="#/resume">Connect the extension</a>
          </div>
        </>
      ) : (
        <>
          <p>
            <strong>Open the form, then click the Landfall extension.</strong> It fills
            every prepared answer below and attaches your résumé. Nothing is submitted —
            check it over and press their submit button yourself.
          </p>
          <div className="row split">
            <span className="sub">Anything marked “yours” below is still yours to answer.</span>
            <a className="btn p" href={url} target="_blank" rel="noreferrer">
              Open their form ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}
