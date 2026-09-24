import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { ParseResponse, ParsedField } from '../api.js';

/**
 * What we read from the file, and how sure we are.
 *
 * The flagged fields are the point of this screen, so they lead: a parse result
 * that reads as finished invites someone to accept it, and the whole reason
 * this step exists is that a confidently wrong résumé parse puts a stranger's
 * phone number on a hundred applications.
 *
 * Nothing is saved until the candidate presses save. The draft lives in this
 * component and goes to the profile in one request.
 */

const TONE: Record<string, string> = { high: 'chip ok', medium: 'chip warn', low: 'chip bad' };

export function ParseReview(): React.ReactElement {
  const { data, error, loading } = useAsync(
    () => api<ParseResponse>('/api/resume/parse', { method: 'POST' }),
    [],
  );

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Profile · résumé</span>
          <h1>What we read from your file</h1>
        </div>
        {data && (
          <div style={{ display: 'flex', gap: 7 }}>
            <span className={data.parsed.needsReview > 0 ? 'chip warn' : 'chip ok'}>
              {data.parsed.needsReview} need your eye
            </span>
            <span className="chip">{data.parsed.fieldCount} fields read</span>
          </div>
        )}
      </div>

      <div className="body">
        <State loading={loading} error={error}>
          {data && <Review data={data} />}
        </State>
      </div>
    </>
  );
}

function Review({ data }: { data: ParseResponse }): React.ReactElement {
  const p = data.parsed;
  const [draft, setDraft] = useState({
    firstName: p.firstName.value,
    lastName: p.lastName.value,
    email: p.email.value,
    phone: p.phone.value,
    location: p.location.value,
    linkedin: p.linkedin.value,
    currentTitle: p.currentTitle.value,
  });
  const [skills, setSkills] = useState(p.skills.map((s) => s.value).join(', '));
  const [roles] = useState(p.roles);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          ...draft,
          phone: draft.phone || null,
          location: draft.location || null,
          linkedin: draft.linkedin || null,
          currentTitle: draft.currentTitle || null,
          skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
          experience: roles.map((r) => ({
            title: r.title.value,
            company: r.company.value,
            start: r.start.value,
            end: r.end.value,
            location: r.location?.value ?? null,
            bullets: r.bullets.map((b) => b.value),
          })),
        }),
      });
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  if (saved) {
    return (
      <div className="note ok">
        <span className="lbl">Confirmed and saved</span>
        <p className="sub">
          These are your facts now. Match scores and every tailored résumé are computed from
          them on the next request.
        </p>
        <a className="btn" href="#/profile">Back to your profile</a>
      </div>
    );
  }

  return (
    <>
      <div className="note">
        <span className="lbl">Nothing here is saved yet</span>
        <p className="sub">{data.note}</p>
        <p className="sub">
          Read from <span className="mono">{data.source.filename}</span> ·{' '}
          {p.textLength.toLocaleString()} characters of text.
        </p>
      </div>

      {p.warnings.map((w) => (
        <div className="note bad" key={w}>
          <span className="lbl">Worth knowing</span>
          <p className="sub">{w}</p>
        </div>
      ))}

      {p.excluded.length > 0 && (
        <div className="note bad">
          <span className="lbl">Found, and deliberately not kept</span>
          <p className="sub">
            {p.excluded.join(', ')} appear in the file. Landfall does not store these and no
            employer form will receive them from us.
          </p>
        </div>
      )}

      <div className="card">
        <header>
          <span className="lbl">Contact</span>
          <span className="sub">correct anything that is wrong before saving</span>
        </header>
        <div className="pad">
          <Row f={p.firstName} label="First name" value={draft.firstName} onChange={(v) => setDraft({ ...draft, firstName: v })} />
          <Row f={p.lastName} label="Last name" value={draft.lastName} onChange={(v) => setDraft({ ...draft, lastName: v })} />
          <Row f={p.email} label="Email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
          <Row f={p.phone} label="Phone" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} />
          <Row f={p.location} label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} />
          <Row f={p.linkedin} label="LinkedIn" value={draft.linkedin} onChange={(v) => setDraft({ ...draft, linkedin: v })} />
          <Row f={p.currentTitle} label="Current title" value={draft.currentTitle} onChange={(v) => setDraft({ ...draft, currentTitle: v })} />
        </div>
      </div>

      <div className="card">
        <header>
          <span className="lbl">Skills</span>
          <span className="sub">{p.skills.filter((s) => s.confidence === 'low').length} will never match a posting</span>
        </header>
        <div className="pad">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {p.skills.map((s) => (
              <span key={s.value} className={TONE[s.confidence] ?? 'chip'} title={s.reason ?? ''}>
                {s.value}
              </span>
            ))}
          </div>
          <input
            className="review-input"
            aria-label="Skills, separated by commas"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
          />
          <p className="sub">
            Red ones are outside the matcher&rsquo;s vocabulary — keep them if they are true,
            but they will never count as evidence against a posting.
          </p>
        </div>
      </div>

      <div className="card">
        <header>
          <span className="lbl">Experience</span>
          <span className="sub">{roles.length} roles · {roles.reduce((n, r) => n + r.bullets.length, 0)} bullets</span>
        </header>
        <div className="pad">
          {roles.length === 0 && (
            <p className="sub">
              No roles could be separated out of the text. You can add them by hand on your
              profile — tailoring needs the parts, so this is the one thing worth the typing.
            </p>
          )}
          {roles.map((r) => (
            <div key={`${r.company.value}-${r.title.value}`} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong>{r.title.value}</strong>
                <span className="sub">
                  {r.company.value}{r.location ? ` · ${r.location.value}` : ''}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  {r.start.value || '?'} – {r.end.value ?? 'Present'}
                </span>
                <span className={TONE[r.start.confidence] ?? 'chip'}>{r.start.confidence}</span>
              </div>
              {r.start.reason && <span className="sub">{r.start.reason}</span>}
              {r.bullets.map((b) => (
                <div className="bullet" key={b.value}>
                  <span className="s" style={{ color: 'var(--ink-muted)' }}>·</span>
                  <span>{b.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {err && <div className="note bad"><span className="lbl">Not saved</span><p className="sub">{err}</p></div>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn p" onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Confirm and save to my profile'}
        </button>
        <a className="btn" href="#/profile">Cancel</a>
        <span className="sub">
          You are confirming these are your facts. Nothing was stored until now.
        </span>
      </div>
    </>
  );
}

function Row({ f, label, value, onChange }: {
  f: ParsedField<string>; label: string; value: string; onChange: (v: string) => void;
}): React.ReactElement {
  const flagged = f.confidence !== 'high';
  return (
    // Layout lives in .review-row, not inline: an inline grid cannot be
    // overridden by the phone breakpoint, and on a 390px screen it squeezed
    // every input to ~20px and wrapped each hint one word per line.
    <div className={flagged ? 'review-row flagged' : 'review-row'}>
      <label className="sub" htmlFor={`pf-${label.replace(/ /g, "-")}`}>{label}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <input
          id={`pf-${label.replace(/ /g, "-")}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {f.reason && <span className="sub">{f.reason}</span>}
        {f.alternatives && f.alternatives.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {f.alternatives.map((alt) => (
              <button
                key={alt}
                className="btn"
                style={{ padding: '3px 8px', fontSize: '0.78rem' }}
                onClick={() => onChange(alt)}
              >
                {alt}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className={`${TONE[f.confidence] ?? 'chip'} conf`}>
        {f.confidence}
      </span>
    </div>
  );
}
