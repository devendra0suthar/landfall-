import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { AppDetail, AppRow } from '../api.js';

/**
 * What you sent, and to whom.
 *
 * APPLIED means the candidate said they applied. The record shows the document
 * that actually went — frozen, hashed, and unchanged by every profile edit
 * since — because that is the question an interview invitation raises.
 */

export function Tracker({ appId }: { appId?: string }): React.ReactElement {
  const list = useAsync(
    () => api<{ counts: Record<string, number>; rows: AppRow[] }>('/api/applications'),
    [],
  );

  const selected = appId ?? list.data?.rows[0]?.id ?? null;
  const detail = useAsync(
    () => (selected
      ? api<AppDetail>(`/api/applications/${encodeURIComponent(selected)}`)
      : Promise.resolve(null)),
    [selected],
  );

  const counts = list.data?.counts ?? {};

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Applied</span>
          <h1>{counts.APPLIED ? `${counts.APPLIED} application${counts.APPLIED === 1 ? '' : 's'} sent` : 'Nothing sent yet'}</h1>
        </div>
      </div>

      <div className="body">
        {/* A class, not an inline grid: an inline 380px column cannot stack on a phone. */}
        <div className="tracker-grid">
          <div className="card">
            <header><span className="lbl">Newest first</span></header>
            <State loading={list.loading} error={list.error} empty={list.data?.rows.length === 0}>
              <div className="rows">
                {(list.data?.rows ?? []).map((r) => (
                  <a
                    key={r.id}
                    href={`#/tracker/${r.id}`}
                    className={`row${r.id === selected ? ' sel' : ''}`}
                    style={{ gridTemplateColumns: '1fr', textDecoration: 'none', color: 'inherit' }}
                  >
                    <span className="t">{r.title}</span>
                    <span className="m">{r.company}</span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className={r.status === 'APPLIED' ? 'chip deep' : 'chip'}>
                        {r.status.toLowerCase()}
                      </span>
                      {r.sent && <span className="chip ok">résumé archived</span>}
                      {r.quiet && <span className="chip warn">gone quiet</span>}
                    </span>
                  </a>
                ))}
              </div>
            </State>
            <div style={{ padding: '11px 14px', borderTop: '1px solid var(--rule)', background: 'var(--surface-2)' }}>
              <p className="sub">
                <strong>Applied</strong> means you told us you applied. Landfall never submits,
                so it can only record what you say happened.
              </p>
            </div>
          </div>

          <State loading={detail.loading} error={detail.error} empty={!selected}>
            {detail.data && <Detail app={detail.data} />}
          </State>
        </div>
      </div>
    </>
  );
}

function Detail({ app }: { app: AppDetail }): React.ReactElement {
  if (!app.sent) {
    return (
      <div className="card">
        <header><span className="lbl">{app.job.title}</span></header>
        <div className="pad">
          <div className="note">
            <span className="lbl">Nothing archived</span>
            <p className="sub">
              This one has not been marked applied, so there is no document to freeze yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const sent = app.sent;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div className="card">
        <header>
          <span className="lbl">
            Sent {new Date(sent.sentAt).toLocaleDateString()}
          </span>
          <span className={sent.tailored ? 'chip ok' : 'chip'}>
            {sent.tailored ? 'tailored for this posting' : 'your file, as it stood'}
          </span>
        </header>
        <div className="pad">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <strong>{sent.filename}</strong>
              <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                {sent.bytes.toLocaleString()} bytes
                {sent.variant ? ` · aimed as ${sent.variant}` : ''}
              </span>
            </div>
            <a
              className="btn"
              style={{ marginLeft: 'auto' }}
              href={`/api/applications/${encodeURIComponent(app.id)}/sent`}
            >
              Download what was sent
            </a>
          </div>


          {sent.bullets.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="lbl">What they read</span>
              {sent.bullets.map((b, i) => (
                <div className="bullet" key={b}>
                  <span className="s" style={{ color: 'var(--ink-muted)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>{b}</span>
                </div>
              ))}
              <p className="sub">
                Editing your profile since does not change this. It is what they actually read.
              </p>
            </div>
          ) : (
            <p className="sub">
              No bullet record — the file you already had was attached as-is, so there was
              nothing to select.
            </p>
          )}
        </div>
      </div>

      {/* Plain words up front; the proof (the file's fingerprint) is one click
          away for anyone who needs to show exactly what was sent. The status
          still says "you marked it", never "confirmed" (rule 6). */}
      <div className="note">
        <p className="sub">
          You marked this as applied. We have not heard from {app.job.company} — that
          part is up to them. Kept until {new Date(sent.expiresAt).toLocaleDateString()}, or
          until you delete it.
        </p>
        <details className="fold">
          <summary><span className="sub">File fingerprint</span></summary>
          <p className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', color: 'var(--ink-soft)' }}>
            SHA-256 {sent.sha256}
          </p>
          <p className="sub">The download will always match this — proof it is the file that went.</p>
        </details>
      </div>
    </div>
  );
}
