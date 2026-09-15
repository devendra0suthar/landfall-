import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { JobScore, LetterStarter, Plan, PlanAction, Tailored } from '../api.js';

/**
 * Preparing one application.
 *
 * Everything a candidate needs before they open the employer's form: what we
 * can fill and from where, what the résumé will say, and what only they can
 * answer. The apply action opens the employer's own form — Landfall never
 * submits (FR-15).
 */

const SOURCE_CHIP: Record<PlanAction['source'], { cls: string; label: string }> = {
  profile: { cls: 'chip ok', label: 'profile' },
  bank: { cls: 'chip ok', label: 'saved answer' },
  file: { cls: 'chip ok', label: 'attachment' },
  generated: { cls: 'chip warn', label: 'needs writing' },
  user: { cls: 'chip', label: 'only you' },
  unresolved: { cls: 'chip bad', label: 'no answer' },
};

export function Prepare({ jobId }: { jobId: string }): React.ReactElement {
  const job = useAsync(
    () => api<{
      score: JobScore | null;
      job: { title: string; company: string; location: string | null; url: string; vendor: string };
    }>(`/api/jobs/${encodeURIComponent(jobId)}`),
    [jobId],
  );
  const plan = useAsync(() => api<Plan>(`/api/jobs/${encodeURIComponent(jobId)}/plan`), [jobId]);
  const resume = useAsync(
    () => api<Tailored>(`/api/jobs/${encodeURIComponent(jobId)}/resume`),
    [jobId],
  );

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ filename: string; sha256: string; bulletCount: number } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  async function apply(): Promise<void> {
    // The tab opens first, synchronously: a popup blocker stops a window opened
    // after an await, and a candidate who clicked "apply" and got nothing but a
    // status change would have no idea the form never opened.
    const url = job.data?.job.url;
    if (url) window.open(url, '_blank', 'noopener');
    setApplying(true);
    setApplyError(null);
    try {
      const created = await api<{ id: string }>('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      });
      const res = await api<{ sent: { filename: string; sha256: string; bulletCount: number } | null }>(
        `/api/applications/${created.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'APPLIED' }) },
      );
      setApplied(res.sent);
    } catch (e) {
      setApplyError((e as Error).message);
    }
    setApplying(false);
  }

  const counts = plan.data?.counts;

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">
            <a href="#/jobs">← Jobs</a>
            {job.data ? ` · ${job.data.job.company}${job.data.job.location ? ` · ${job.data.job.location}` : ''}` : ''}
          </span>
          <h1>{job.data?.job.title ?? 'Preparing…'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          {job.data?.score && (
            <>
              <Score
                k="Match"
                v={String(job.data.score.match.score)}
                note={`${job.data.score.match.confidence} confidence`}
                tone={job.data.score.match.score >= 60 ? 'good' : 'warn'}
              />
              <Score
                k="Readiness"
                v={job.data.score.readiness.measured && job.data.score.readiness.pct !== null
                  ? `${Math.round(job.data.score.readiness.pct * 100)}%`
                  : '—'}
                note={job.data.score.readiness.measured
                  ? `${job.data.score.readiness.filled} of ${job.data.score.readiness.total} fields`
                  : 'form not readable'}
                tone="deep"
              />
            </>
          )}
          {job.data && (
            <a className="btn" href={job.data.job.url} target="_blank" rel="noopener noreferrer">
              Open the posting ↗
            </a>
          )}
        </div>
      </div>

      <div className="body">
        {counts && (
          <div className="grid">
            <Stat n={counts.deterministic} k="fill from your own facts — no model, no typing" tone="ok" />
            <Stat n={counts.needsCandidate} k="only you may answer — consent, attestation, demographics" />
            <Stat n={counts.needsWriting} k="need prose you write" tone="warn" />
            <Stat n={counts.unresolved} k="nothing can answer yet" tone={counts.unresolved ? 'bad' : undefined} />
          </div>
        )}

        {job.data?.score && (
          <div className="card">
            <header>
              <span className="lbl">Why this match score</span>
              <span className="sub">{job.data.score.match.basis.join(' · ')}</span>
            </header>
            <div className="pad">
              {job.data.score.match.signals.map((sig) => (
                <div className="plan" key={sig.name}>
                  <span className={sig.hit ? 'chip ok' : 'chip'}>{sig.hit ? 'yes' : 'no'}</span>
                  <span>
                    <strong>{sig.name}</strong>
                    <span className="sub" style={{ display: 'block' }}>{sig.detail}</span>
                  </span>
                </div>
              ))}
              {job.data.score.match.missingSkills.length > 0 && (
                <p className="sub">
                  Asked for, not claimed: {job.data.score.match.missingSkills.slice(0, 8).join(' · ')}.
                  An inference about the posting, not a judgement about whether you would be hired.
                </p>
              )}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
          <div className="card">
            <header>
              <span className="lbl">The fill plan</span>
              {counts && (
                <span className="sub">
                  {counts.planned} of {counts.formFields} fields
                  {counts.skippedOptionalBlank > 0
                    ? ` · ${counts.skippedOptionalBlank} optional and blank`
                    : ''}
                </span>
              )}
            </header>
            <div className="pad">
              <State loading={plan.loading} error={plan.error}>
                {plan.data?.formState === 'unknown' ? (
                  <div className="note">
                    <span className="lbl">No form to plan</span>
                    <p className="sub">{plan.data.message}</p>
                  </div>
                ) : (
                  <div>
                    {(plan.data?.actions ?? []).map((a) => (
                      <div className="plan" key={`${a.fieldName}-${a.label}`}>
                        <span className={SOURCE_CHIP[a.source].cls}>{SOURCE_CHIP[a.source].label}</span>
                        <span>
                          {a.label}{a.required ? ' *' : ''}
                          {a.value && (
                            <span className="mono" style={{ display: 'block', color: 'var(--ink-soft)' }}>
                              {a.value}
                            </span>
                          )}
                          {a.reason && <span className="sub" style={{ display: 'block' }}>{a.reason}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </State>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            {(counts?.needsWriting ?? 0) > 0 && <Starter jobId={jobId} />}

            <div className="card">
              <header>
                <span className="lbl">Tailored résumé</span>
                {resume.data && (
                  <span className={resume.data.integrity.allVerbatim ? 'chip ok' : 'chip bad'}>
                    {resume.data.integrity.allVerbatim ? 'every line verbatim' : 'integrity failure'}
                  </span>
                )}
              </header>
              <div className="pad">
                <State loading={resume.loading} error={resume.error}>
                  {resume.data && (
                    <>
                      <span className="sub">
                        {resume.data.bulletsKept} of {resume.data.bulletsAvailable} bullets kept.
                        Nothing is rewritten and nothing is added.
                      </span>
                      {resume.data.roles.map((r) => (
                        <div key={`${r.company}-${r.title}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <h3>{r.title} — {r.company}</h3>
                          {r.kept.map((b) => (
                            <div className="bullet" key={b.text}>
                              <span className="s">{b.score}</span>
                              <span>
                                {b.text}
                                {b.matched.length > 0 && (
                                  <span className="mono" style={{ color: 'var(--good)' }}> · {b.matched.join(', ')}</span>
                                )}
                              </span>
                            </div>
                          ))}
                          {r.dropped.map((b) => (
                            <div className="bullet drop" key={b.text}>
                              <span className="s" style={{ color: 'var(--ink-muted)' }}>0</span>
                              <span>{b.text}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                      {resume.data.coverage.missing.length > 0 && (
                        <div className="note bad">
                          <span className="lbl">Asked for, and you have not claimed it</span>
                          <p className="sub">{resume.data.coverage.missing.slice(0, 8).join(' · ')}</p>
                          <p className="sub">An honest gap. This app will not paper over it.</p>
                        </div>
                      )}
                      <a className="btn" href={`/api/jobs/${encodeURIComponent(jobId)}/resume.pdf`} target="_blank" rel="noopener noreferrer">
                        Open the PDF
                      </a>
                    </>
                  )}
                </State>
              </div>
            </div>

            <div className="card">
              <header><span className="lbl">Apply — Tier A, assisted</span></header>
              <div className="pad">
                {applied ? (
                  <div className="note ok">
                    <span className="lbl">Recorded, and archived</span>
                    <p className="sub">
                      <span className="mono">{applied.filename}</span> · {applied.bulletCount} bullets
                    </p>
                    <p className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      sha256 {applied.sha256}
                    </p>
                    <p className="sub">
                      Written once. Editing your profile from here on will not change what they read.
                      Status stays <span className="mono">submitted</span>, never{' '}
                      <span className="mono">confirmed</span>, until they reply.
                    </p>
                    <a className="btn" href="#/tracker">See it in the tracker →</a>
                  </div>
                ) : (
                  <>
                    <p className="sub">
                      We open the employer&rsquo;s own form in a new tab. You read it, you press
                      submit. Landfall never submits anything itself — when you come back, we
                      record it and archive the exact document that went.
                    </p>
                    {applyError && <div className="note bad"><p className="sub">{applyError}</p></div>}
                    <button className="btn p" onClick={() => void apply()} disabled={applying}>
                      {applying ? 'Recording…' : 'Open the form and record it'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The one field a plan cannot resolve.
 *
 * Built on demand rather than with the page: a starter is worth a request only
 * when the candidate asks for one, and showing it unbidden invites them to send
 * it as-is — which is the failure the brackets exist to prevent.
 */
function Starter({ jobId }: { jobId: string }): React.ReactElement {
  const [starter, setStarter] = useState<LetterStarter | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  async function build(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ starter: LetterStarter }>(`/api/jobs/${encodeURIComponent(jobId)}/letter`);
      setStarter(res.starter);
      setDraft(res.starter.text);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="card">
      <header>
        <span className="lbl">The letter — yours to finish</span>
        {starter && (
          <span className="sub">
            {starter.facts.length} verified facts · {starter.placeholders.length} for you
          </span>
        )}
      </header>
      <div className="pad">
        {!starter ? (
          <>
            <p className="sub">
              A scaffold built only from facts you have verified, with a bracketed prompt
              wherever only you can answer. It is deliberately unfinished — a complete letter
              would be this app writing a claim in your name.
            </p>
            {err && <div className="note bad"><p className="sub">{err}</p></div>}
            <button className="btn" onClick={() => void build()} disabled={busy}>
              {busy ? 'Building…' : 'Build a starter'}
            </button>
          </>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={16}
              style={{
                width: '100%', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.5,
                padding: 11, border: '1px solid var(--rule)', borderRadius: 4,
                background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical',
              }}
            />
            <p className="sub">
              <strong>{draft.replace(/[[^]]*]/g, '').split(/s+/).filter(Boolean).length}</strong>{' '}
              words of real prose — brackets do not count, because they are prompts, not writing.
              {draft.includes('[') && (
                <span style={{ color: 'var(--stop)' }}> {draft.split('[').length - 1} prompt(s) still unanswered.</span>
              )}
            </p>
            <details>
              <summary className="lbl" style={{ cursor: 'pointer' }}>What went into it</summary>
              <div style={{ paddingTop: 10 }}>
                {starter.facts.map((f) => (
                  <div className="plan" key={`${f.field}-${f.value}`}>
                    <span className={f.source === 'profile' ? 'chip ok' : 'chip'}>{f.source}</span>
                    <span>
                      <span className="lbl">{f.field}</span>
                      <span style={{ display: 'block' }}>{f.value}</span>
                    </span>
                  </div>
                ))}
                {starter.wouldHelp.length > 0 && (
                  <p className="sub" style={{ marginTop: 10 }}>
                    Filling in {starter.wouldHelp.join(', ')} would remove a prompt.
                  </p>
                )}
                {starter.missingContext.map((m) => (
                  <p className="sub" key={m} style={{ marginTop: 8 }}>{m}</p>
                ))}
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

function Score({ k, v, note, tone }: {
  k: string; v: string; note: string; tone: 'good' | 'warn' | 'deep';
}): React.ReactElement {
  const colour = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--deep)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="lbl">{k}</span>
      <span style={{
        fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
        fontSize: '1.7rem', lineHeight: 1, color: colour,
      }}>
        {v}
      </span>
      <span className="lbl">{note}</span>
    </div>
  );
}

function Stat({ n, k, tone }: { n: number; k: string; tone?: 'ok' | 'warn' | 'bad' }): React.ReactElement {
  const colour = tone === 'ok' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--stop)' : 'var(--ink)';
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: '1.6rem', color: colour }}>
        {n}
      </span>
      <span className="sub">{k}</span>
    </div>
  );
}
