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
      <div className="row split">
        <div>
          <strong>Connect the autofill extension</strong>
          <div className="sub">
            Fills the employer’s form in your own browser, one click, and stops.
            The submit button stays yours.
          </div>
        </div>
      </div>

      {err && (
        <div className="note bad">
          <span className="lbl">That did not work</span>
          <p>{err}</p>
        </div>
      )}

      {fresh && (
        <div className="note ok">
          <span className="lbl">Your access token</span>
          <p className="mono" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>
            {fresh.token}
          </p>
          <p className="sub">{fresh.note}</p>
          <div className="row split">
            <span className="sub">Paste it into the extension popup, under Connection.</span>
            <button className="btn p" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy token'}
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
          {busy ? 'Working…' : 'Create a token'}
        </button>
      </div>

      <State loading={list.loading} error={list.error} empty={tokens.length === 0} rows={2}>
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

      <p className="sub">
        Changing your password revokes every token here, so the extension will
        need reconnecting afterwards.
      </p>
    </div>
  );
}
