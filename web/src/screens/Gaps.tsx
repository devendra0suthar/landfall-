import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { GapReport, GapRow } from '../api.js';

/**
 * What is still unanswered, and what each answer would unlock.
 *
 * Reported as reach, never as a percentage. "Answer this and 26 forms stop
 * asking" is something a person can act on; "your profile is 63% complete" is
 * a number about our schema, not about their job search.
 */

export function Gaps(): React.ReactElement {
  const { data, error, loading, reload } = useAsync(() => api<GapReport>('/api/gaps'), []);

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Answer once, reuse everywhere</span>
          <h1>Gaps</h1>
        </div>
        {data && (
          <span className="sub">
            measured over {data.formsRead} forms we have read · {data.totalQuestions} questions
          </span>
        )}
      </div>

      <div className="body">
        <State loading={loading} error={error}>
          {data && (
            <>
              {data.reach.bankable > 0 && (
                <div className="note">
                  <span className="lbl">Why this is worth your time</span>
                  <p className="sub">
                    The unanswered questions below appear{' '}
                    <strong>{data.reach.bankable.toLocaleString()}</strong> times across the
                    forms we have read. They are the same few questions wearing many
                    employers&rsquo; phrasings — which is what makes answering one worth
                    doing once.
                  </p>
                </div>
              )}

              {data.rows.profile.length > 0 && (
                <Section
                  title="Fill these on your profile"
                  note={`Together they appear ${data.reach.profile} times. They belong on the profile
                         rather than here — the same fact stored twice is a fact that can
                         disagree with itself.`}
                  rows={data.rows.profile}
                />
              )}

              <Section
                title="Answer once, reused everywhere"
                note="Stored against the normalised question, so every employer who asks it in
                      their own words gets the same answer."
                rows={data.rows.bankable}
                editable
                onSaved={reload}
              />

              {data.rows.perPosting.length > 0 && (
                <Section
                  title="Written per posting"
                  note="These recur, and they are still not bankable. One stored answer sent to
                        twenty-five employers is the thing this product exists not to do — the
                        letter starter on each posting is the help here."
                  rows={data.rows.perPosting}
                />
              )}

              {data.rows.yours.length > 0 && (
                <Section
                  title="Yours alone — never stored"
                  note="Consent notices, attestations and demographic questions. Landfall will
                        never keep an answer to these, and never tick one for you: that would be
                        a statement you did not make."
                  rows={data.rows.yours}
                  tone="bad"
                />
              )}
            </>
          )}
        </State>
      </div>
    </>
  );
}

function Section({ title, note, rows, editable, tone, onSaved }: {
  title: string; note: string; rows: GapRow[];
  editable?: boolean; tone?: 'bad'; onSaved?: () => void;
}): React.ReactElement {
  return (
    <div className="card">
      <header>
        <span className="lbl">{title}</span>
        <span className="sub">{rows.length}</span>
      </header>
      <div className="pad">
        <p className="sub">{note}</p>
        {rows.map((r) => (
          <GapLine key={r.labelKey} row={r} editable={editable} tone={tone} onSaved={onSaved} />
        ))}
      </div>
    </div>
  );
}

function GapLine({ row, editable, tone, onSaved }: {
  row: GapRow; editable?: boolean; tone?: 'bad'; onSaved?: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(row.answer ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ unlocked: number }>(`/api/bank/${encodeURIComponent(row.labelKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      });
      setSaved(res.unlocked);
      onSaved?.();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '11px 0', borderBottom: '1px solid var(--rule-soft)',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{row.label}</span>
        <span className={tone === 'bad' ? 'chip bad' : row.answer ? 'chip ok' : 'chip'}>
          {row.jobCount} form{row.jobCount === 1 ? '' : 's'}
        </span>
        {row.requiredCount > 0 && (
          <span className="chip warn">{row.requiredCount} required</span>
        )}
      </div>

      {row.profileField && (
        <span className="sub">
          Belongs on the profile, as <span className="mono">{row.profileField}</span>.
        </span>
      )}

      {editable && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your answer, in your words"
            style={{
              flex: 1, minWidth: 200, fontFamily: 'inherit', fontSize: '0.88rem',
              padding: '7px 9px', border: '1px solid var(--rule)', borderRadius: 4,
              background: 'var(--surface)', color: 'var(--ink)',
            }}
          />
          <button className="btn" onClick={() => void save()} disabled={busy || !value.trim()}>
            {busy ? 'Saving…' : row.answer ? 'Update' : 'Save'}
          </button>
        </div>
      )}

      {saved !== null && (
        <span className="sub" style={{ color: 'var(--good)' }}>
          Saved — {saved} form{saved === 1 ? '' : 's'} stop asking.
        </span>
      )}
      {err && <span className="sub" style={{ color: 'var(--stop)' }}>{err}</span>}
    </div>
  );
}
