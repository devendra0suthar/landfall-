import { useRef, useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { ProfilePayload } from '../api.js';
import { ProfileEditor } from './ProfileEditor.js';

/**
 * The verified facts, and the file that gets attached.
 *
 * Every form in the sample asks for a résumé, so the upload here is the single
 * highest-leverage control in the product: without it, the file action on every
 * plan resolves to nothing no matter how complete the rest of the profile is.
 */

export function Profile(): React.ReactElement {
  const { data, error, loading, reload } = useAsync(() => api<ProfilePayload>('/api/profile'), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function upload(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try {
      // Sent as the raw file, not multipart: one file with no fields around it,
      // and a multipart parser on the server would be code with nothing else
      // to do.
      await api(`/api/resume?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (fileRef.current) fileRef.current.value = '';
      reload();
    } catch (e) {
      setUploadError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Profile</span>
          <h1>{data ? `${data.profile.firstName} ${data.profile.lastName}` : 'Profile'}</h1>
        </div>
        {data && <span className="chip">{data.candidate.region}</span>}
      </div>

      <div className="body">
        <State loading={loading} error={error}>
          {data && (
            <>
              <div className="card">
                <header>
                  <span className="lbl">Résumé file</span>
                  {data.resume
                    ? <span className="chip ok">ready to attach</span>
                    : <span className="chip bad">none on file</span>}
                </header>
                <div className="pad">
                  {data.resume ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <strong>{data.resume.filename}</strong>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                          {data.resume.bytes.toLocaleString()} bytes · uploaded{' '}
                          {new Date(data.resume.uploadedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <a className="btn" href="/api/resume" target="_blank" rel="noopener noreferrer">
                          Open the file
                        </a>
                        <a className="btn p" href="#/parse">Read it into my profile</a>
                      </div>
                    </div>
                  ) : (
                    <p className="sub">
                      Every form in the sample asks for one. Until there is a file here, the
                      attachment field on every application stays unanswered.
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.rtf,.txt,.md" />
                    <button className="btn p" onClick={() => void upload()} disabled={busy}>
                      {busy ? 'Uploading…' : data.resume ? 'Replace it' : 'Upload'}
                    </button>
                  </div>
                  {uploadError && <div className="note bad"><p className="sub">{uploadError}</p></div>}
                  <p className="sub">
                    PDF, Word, RTF, text or markdown, up to 8 MB. Stored in{' '}
                    {data.candidate.region} with the rest of your data, and never served from a
                    public link.
                  </p>
                </div>
              </div>

              {editing ? (
                <ProfileEditor
                  payload={data}
                  onDone={() => { setEditing(false); reload(); }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button className="btn" onClick={() => setEditing(true)}>Edit these facts</button>
                  </div>
                  <div className="grid">
                    <Fact k="Email" v={data.profile.email} />
                    <Fact k="Phone" v={data.profile.phone} />
                    <Fact k="Location" v={data.profile.location} />
                    <Fact k="Current title" v={data.profile.currentTitle} />
                  </div>
                </>
              )}

              {!editing && (
              <div className="card">
                <header>
                  <span className="lbl">Skills you claim</span>
                  <span className="sub">{data.profile.skills.length} claimed</span>
                </header>
                <div className="pad">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {data.profile.skills.map((s) => <span key={s} className="chip ok">{s}</span>)}
                  </div>
                  <p className="sub">
                    Self-declared only. We never infer a skill from a bullet — a claim made on
                    your behalf is still a claim.
                  </p>
                </div>
              </div>
              )}

              {!editing && (
              <div className="card">
                <header><span className="lbl">Experience</span></header>
                <div className="pad">
                  {data.profile.roles.map((r) => (
                    <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <h3>
                        {r.title} — {r.company}{' '}
                        <span className="mono" style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>
                          {r.start} – {r.end ?? 'Present'}
                        </span>
                      </h3>
                      {r.bullets.map((b) => (
                        <div className="bullet" key={b}>
                          <span className="s" style={{ color: 'var(--ink-muted)' }}>·</span>
                          <span>{b}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <p className="sub">
                    Tailoring picks among these for each posting. It never edits a line and never
                    adds one, so what is here is exactly what an employer reads.
                  </p>
                </div>
              </div>
              )}

              <div className="card">
                <header>
                  <span className="lbl">Saved answers</span>
                  <span className="sub">reused across employers</span>
                </header>
                <div className="pad">
                  {data.bank.map((b) => (
                    <div className="plan" key={b.labelKey}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                        {b.labelKey}
                      </span>
                      <span>{b.value}</span>
                    </div>
                  ))}
                  <p className="sub">
                    Nothing here is a consent, an attestation or a demographic answer — those
                    reach you every time, by design.
                  </p>
                </div>
              </div>
            </>
          )}
        </State>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string | null }): React.ReactElement {
  return (
    <div className="card" style={{ padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span className="lbl">{k}</span>
      <span>{v ?? <span className="sub">not set</span>}</span>
    </div>
  );
}
