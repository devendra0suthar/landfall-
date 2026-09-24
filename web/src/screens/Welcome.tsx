import { useRef, useState } from 'react';
import { api } from '../api.js';

/**
 * The first thing a new account sees.
 *
 * Upload-first, the way the products it is compared to open. The previous
 * version explained the product in three paragraphs and put the upload at the
 * bottom — on a phone, below the fold entirely — so the one action a new
 * person has to take was the last thing they found. The explanation is now one
 * line per step; the drop zone is the page.
 *
 * Uploading goes straight to the review step (`#/parse`): a parse is a
 * proposal and nothing is saved until they confirm it there, so skipping the
 * detour through the file list costs no honesty and saves a click.
 *
 * The two other ways in — type it by hand, or just look — stay, as links: a
 * product that demands an upload before it shows anything gets closed.
 */

const ACCEPT = '.pdf,.doc,.docx,.rtf,.txt,.md';

export function Welcome(): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function send(file: File): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/resume?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      window.location.hash = '#/parse';
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="body welcome">
      <div className="hero">
        <h1>Upload your résumé. We’ll line up the jobs and prepare every application.</h1>
        <p className="sub">You check each one and press submit yourself — Landfall never applies for you.</p>
      </div>

      <div
        className={dragging ? 'drop-zone big over' : 'drop-zone big'}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void send(file);
        }}
      >
        <strong>Drop your résumé here</strong>
        <span className="sub">PDF, Word, RTF or text · up to 8 MB</span>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          aria-label="Choose your résumé file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
          }}
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
        <button className="btn p" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Reading it…' : 'Choose a file'}
        </button>
        {err && <span className="sub" role="alert">{err}</span>}
      </div>

      <ol className="steps-row">
        <li><strong>1</strong> We read it — you check what we found</li>
        <li><strong>2</strong> We match roles you can actually take</li>
        <li><strong>3</strong> Each form comes prepared — you submit</li>
      </ol>

      <p className="sub welcome-alt">
        No file to hand? <a href="#/profile">Type it in</a> · or <a href="#/jobs">just browse jobs</a>
      </p>
    </div>
  );
}
