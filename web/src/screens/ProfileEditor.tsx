import { useState } from 'react';
import { api } from '../api.js';
import type { ProfilePayload } from '../api.js';

/**
 * One form over the whole profile.
 *
 * Saves everything at once rather than field by field. A partial save that
 * half-applies is worse than one that fails outright: the candidate would have
 * no way to tell which half went through.
 *
 * Skills are a comma-separated line rather than a tag widget on purpose — the
 * matcher works against a fixed lowercase vocabulary, and a plain list is the
 * clearest way to see exactly what is being claimed. Roles are edited as text
 * with one bullet per line, the same shape the tailor reads them in.
 */

interface RoleDraft {
  title: string;
  company: string;
  start: string;
  end: string;
  location: string;
  bullets: string;
}

const input: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.88rem',
  padding: '7px 9px',
  border: '1px solid var(--rule)',
  borderRadius: 4,
  background: 'var(--surface)',
  color: 'var(--ink)',
};

export function ProfileEditor({ payload, onDone, onCancel }: {
  payload: ProfilePayload;
  onDone: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const p = payload.profile;

  const [form, setForm] = useState({
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone ?? '',
    location: p.location ?? '',
    country: p.country ?? '',
    linkedin: p.linkedin ?? '',
    currentTitle: p.currentTitle ?? '',
    skills: p.skills.join(', '),
    years: p.yearsExperience === null ? '' : String(p.yearsExperience),
  });

  const [roles, setRoles] = useState<RoleDraft[]>(p.roles.map((r) => ({
    title: r.title,
    company: r.company,
    start: r.start,
    end: r.end ?? '',
    location: r.location ?? '',
    bullets: r.bullets.join('\n'),
  })));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>): void =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const setRole = (i: number, k: keyof RoleDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void =>
      setRoles((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone || null,
          location: form.location || null,
          country: form.country || null,
          linkedin: form.linkedin || null,
          currentTitle: form.currentTitle || null,
          skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
          yearsExperience: form.years === '' ? null : Number(form.years),
          experience: roles
            .filter((r) => r.title.trim() !== '' && r.company.trim() !== '')
            .map((r) => ({
              title: r.title,
              company: r.company,
              start: r.start,
              end: r.end || null,
              location: r.location || null,
              bullets: r.bullets.split('\n').map((b) => b.trim()).filter(Boolean),
            })),
        }),
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const field = (k: keyof typeof form, label: string): React.ReactElement => (
    <div className="card" style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label className="lbl" htmlFor={`p-${k}`}>{label}</label>
      <input id={`p-${k}`} value={form[k]} onChange={set(k)} style={input} />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="grid">
        {field('firstName', 'First name *')}
        {field('lastName', 'Last name *')}
        {field('email', 'Email *')}
        {field('phone', 'Phone')}
        {field('location', 'Location')}
        {field('country', 'Country')}
        {field('linkedin', 'LinkedIn')}
        {field('currentTitle', 'Current title')}
        {field('years', 'Years of experience')}
      </div>

      <div className="card">
        <header><span className="lbl">Skills you claim — comma separated</span></header>
        <div className="pad">
          <input value={form.skills} onChange={set('skills')} style={input} />
          <p className="sub">
            Lowercased when saved, because the matcher is. Everything here is a claim you
            are making — nothing is ever inferred from your bullets.
          </p>
        </div>
      </div>

      <div className="card">
        <header>
          <span className="lbl">Experience — one bullet per line</span>
          <button
            className="btn"
            onClick={() => setRoles((rs) => [...rs, {
              title: '', company: '', start: '', end: '', location: '', bullets: '',
            }])}
          >
            Add a role
          </button>
        </header>
        <div className="pad">
          {roles.map((r, i) => (
            <div
              // These rows have no identity until they are saved, and saving
              // replaces the whole list — so the index is the honest key.
              key={`role-${i}`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 7,
                paddingBottom: 12, borderBottom: '1px solid var(--rule-soft)',
              }}
            >
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input value={r.title} placeholder="Title" onChange={setRole(i, 'title')} style={{ ...input, flex: 2, minWidth: 140 }} />
                <input value={r.company} placeholder="Company" onChange={setRole(i, 'company')} style={{ ...input, flex: 2, minWidth: 140 }} />
                <input value={r.start} placeholder="Start" onChange={setRole(i, 'start')} style={{ ...input, flex: 1, minWidth: 90 }} />
                <input value={r.end} placeholder="End (blank = present)" onChange={setRole(i, 'end')} style={{ ...input, flex: 1, minWidth: 90 }} />
              </div>
              <textarea
                value={r.bullets}
                rows={5}
                onChange={setRole(i, 'bullets')}
                style={{ ...input, lineHeight: 1.5, resize: 'vertical' }}
              />
              <button
                className="btn"
                style={{ alignSelf: 'flex-start', color: 'var(--stop)' }}
                onClick={() => setRoles((rs) => rs.filter((_, j) => j !== i))}
              >
                Remove this role
              </button>
            </div>
          ))}
        </div>
      </div>

      {err && (
        <div className="note bad">
          <span className="lbl">Not saved</span>
          <p className="sub">{err}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn p" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <span className="sub">
          Applications you have already sent keep the résumé that went with them — editing
          here does not rewrite history.
        </span>
      </div>
    </div>
  );
}
