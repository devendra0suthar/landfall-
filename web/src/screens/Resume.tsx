import { useRef, useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import { ConnectExtension } from './ConnectExtension.js';
import type { ResumeList, ResumeRow } from '../api.js';

/**
 * The résumé — the front door of the whole product.
 *
 * This screen exists because the upload did not have one. It worked, and it was
 * buried three cards down inside Profile, and the step that reads a résumé into
 * a profile (`#/parse`) had no navigation entry at all — reachable only from a
 * button that appeared once a file was already on file. So the first thing a
 * new candidate needs was the one thing they could not find, and someone
 * looking for "upload my CV" concluded the product did not do it.
 *
 * Every form in the sample asks for a résumé, which makes this the highest
 * leverage control there is: with no file here, the attachment action on every
 * plan resolves to nothing no matter how complete the rest of the profile is.
 */

const ACCEPT = '.pdf,.doc,.docx,.rtf,.txt,.md';

export function Resume(): React.ReactElement {
  const list = useAsync(() => api<ResumeList>('/api/resumes'), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function send(file: File): Promise<void> {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      // The raw file, not multipart: one file with no fields around it, and a
      // multipart parser on the server would be code with nothing else to do.
      await api(`/api/resume?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (fileRef.current) fileRef.current.value = '';
      setNote(`${file.name} uploaded, and it is the file every application will attach.`);
      list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function activate(row: ResumeRow): Promise<void> {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      await api(`/api/resume/${encodeURIComponent(row.id)}/activate`, { method: 'POST' });
      setNote(`${row.filename} is now the file every application will attach.`);
      list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  async function remove(row: ResumeRow): Promise<void> {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api<{ promoted: { filename: string } | null }>(
        `/api/resume/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      );
      // Say which file took over. A silent promotion means the next application
      // attaches something the candidate did not choose.
      setNote(res.promoted
        ? `${row.filename} removed. ${res.promoted.filename} is now the active file.`
        : `${row.filename} removed. No résumé is on file, so applications will attach nothing.`);
      list.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const rows = list.data?.rows ?? [];
  const active = rows.find((r) => r.active) ?? null;

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Your file</span>
          <h1>Résumé</h1>
        </div>
        {active && (
          <a className="btn p" href="#/parse">Read it into my profile →</a>
        )}
      </div>

      <div className="body">
        <State loading={list.loading} error={list.error}>
          {/* The drop zone is the first thing on the screen whether or not a
              file exists. "Replace" hidden behind an existing file is how the
              upload became invisible in the first place. */}
          <div
            className={dragging ? 'drop-zone over' : 'drop-zone'}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) void send(file);
            }}
          >
            <span className="lbl">
              {rows.length === 0 ? 'Start here — upload your résumé' : 'Upload another'}
            </span>
            <p className="sub">
              Drop a file here, or choose one. PDF, Word, RTF, text or markdown, up to 8 MB.
            </p>
            {/* The native input stays in the tree for keyboard and screen-reader
                users — it is the real control — but the styled button is what
                carries the affordance, so the input is visually hidden rather
                than removed. */}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void send(file);
              }}
              style={{
                position: 'absolute', width: 1, height: 1,
                opacity: 0, pointerEvents: 'none',
              }}
            />
            <button className="btn p" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Working…' : 'Choose a file'}
            </button>
          </div>

          {err && (
            <div className="note bad">
              <span className="lbl">That upload did not work</span>
              <p>{err}</p>
            </div>
          )}
          {note && (
            <div className="note ok">
              <span className="lbl">Done</span>
              <p>{note}</p>
            </div>
          )}

          {rows.length === 0 ? (
            <div className="note warn">
              <span className="lbl">No résumé on file</span>
              <p>
                Every form in the sample asks for one. Until there is a file here, the attachment
                field on every application stays unanswered — and the match scores you see are
                based only on the skills you have typed in by hand.
              </p>
              <p className="sub">
                Once a file is up, <a href="#/parse">reading it into your profile</a> fills in your
                roles, dates and bullets — each one shown with a confidence, for you to confirm or
                correct. Nothing it reads is saved until you accept it.
              </p>
            </div>
          ) : (
            <div className="card flow">
              <header>
                <span className="lbl">On file</span>
                <span className="sub">
                  {rows.length} {rows.length === 1 ? 'file' : 'files'} · exactly one is attached
                </span>
              </header>
              <div className="rows">
                {rows.map((r) => (
                  <div className="row split" key={r.id}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong>{r.filename}</strong>
                        {r.active
                          ? <span className="chip ok">attached to every application</span>
                          : <span className="chip">stored</span>}
                      </span>
                      <span className="sub mono">
                        {r.bytes.toLocaleString()} bytes · uploaded{' '}
                        {new Date(r.uploadedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                      {r.active ? (
                        <a className="btn" href="/api/resume" target="_blank" rel="noopener noreferrer">
                          Open
                        </a>
                      ) : (
                        <button className="btn" disabled={busy} onClick={() => void activate(r)}>
                          Attach this one
                        </button>
                      )}
                      <button className="btn" disabled={busy} onClick={() => void remove(r)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {active && (
            <div className="card flow">
              <header><span className="lbl">Next</span></header>
              <p className="sub">Read it into your profile — you check what we found before anything is saved.</p>
              <a className="btn p" href="#/parse">Read {active.filename} into my profile →</a>
            </div>
          )}
        </State>
        <ConnectExtension />
    </div>
    </>
  );
}
