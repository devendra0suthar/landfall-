import { useState } from 'react';
import { api } from '../api.js';
import type { AnalysisCategory, AnalyzeResponse, Finding, Severity } from '../api.js';

/**
 * Score my résumé — against any job description, from anywhere.
 *
 * The limitation this removes is the one that made Landfall unusable for most
 * real job hunting: every other screen works only on postings in our own index,
 * so a role found on LinkedIn, sent by a recruiter, or read on the employer's
 * own careers page could not be used at all. Pasting the description runs it
 * through the same extractor, scorer and tailor as an indexed posting.
 *
 * On the score itself: it is a weighted mean of six categories, each of which
 * shows what it measured and what it found. There is no hidden weighting and no
 * model in the loop — the same résumé scores the same number twice, for the same
 * stated reasons. A score a candidate cannot reproduce or act on is one they
 * learn to ignore.
 */

const SEVERITY_CHIP: Record<Severity, string> = {
  good: 'chip ok',
  warn: 'chip warn',
  bad: 'chip bad',
};

const BAND_COLOUR: Record<'weak' | 'fair' | 'strong', string> = {
  weak: 'var(--stop)',
  fair: 'var(--warn)',
  strong: 'var(--good)',
};

export function Analyze(): React.ReactElement {
  const [jd, setJd] = useState('');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(withJob: boolean): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, string> = {};
      if (withJob) {
        body.jobDescription = jd;
        if (title.trim()) body.title = title.trim();
      }
      setResult(await api<AnalyzeResponse>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(body),
      }));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const a = result?.analysis ?? null;

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Your résumé, scored</span>
          <h1>Analysis</h1>
        </div>
        {a && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
            <span className="lbl">Score</span>
            <span className="num" style={{
              letterSpacing: "-0.035em", fontWeight: 700,
              fontSize: '2.4rem', lineHeight: 1, color: BAND_COLOUR[a.band],
            }}>
              {a.score}
            </span>
            <span className="lbl">{a.band} · out of 100</span>
          </div>
        )}
      </div>

      <div className="body">
        <div className="card flow">
          <header><span className="lbl">Paste the job description</span></header>
          <p className="sub">
            From anywhere — LinkedIn, the employer’s own careers page, an email from a
            recruiter. It does not have to be a posting we have indexed, and nothing you
            paste here is stored.
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Job title (optional — helps read seniority)"
            aria-label="Job title"
            style={{
              fontFamily: 'inherit', fontSize: '0.9rem', padding: '8px 10px',
              border: '1px solid var(--rule)', borderRadius: 5,
              background: 'var(--surface)', color: 'var(--ink)', width: '100%',
            }}
          />
          <textarea
            value={jd}
            onChange={(e) => setJd(e.target.value)}
            rows={10}
            placeholder="Paste the full job description here…"
            aria-label="Job description"
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.5,
              padding: 11, border: '1px solid var(--rule)', borderRadius: 5,
              background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="btn p"
              disabled={busy || jd.trim().length < 40}
              onClick={() => void run(true)}
            >
              {busy ? 'Scoring…' : 'Score against this job'}
            </button>
            {/* Scoring with no job is a real use: it is what a candidate wants
                before they have a specific role in mind. */}
            <button className="btn" disabled={busy} onClick={() => void run(false)}>
              Score my résumé on its own
            </button>
            {jd.trim().length > 0 && jd.trim().length < 40 && (
              <span className="sub">A description needs at least 40 characters.</span>
            )}
          </div>
        </div>

        {err && (
          <div className="note bad">
            <span className="lbl">Could not score that</span>
            <p>{err}</p>
          </div>
        )}

        {result && a && (
          <>
            {/* What the extractor understood, shown before the score. A paste
                that lost its formatting produces a confident score against the
                wrong requirements, and the candidate has no way to tell unless
                we show our reading of it. */}
            {result.readJob && (
              <div className="card flow">
                <header>
                  <span className="lbl">What we read from it</span>
                  <span className="sub">{result.readJob.characters.toLocaleString()} characters</span>
                </header>
                <p className="sub">
                  Check this looks right. If the skills below are not what the posting asks
                  for, the paste lost something and the score is measuring the wrong thing.
                </p>
                <div className="rows">
                  <div className="row split">
                    <span className="lbl">Skills it asks for</span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(result.readJob.requiredSkills.length > 0
                        ? result.readJob.requiredSkills
                        : result.readJob.skills).map((s) => <span key={s} className="chip">{s}</span>)}
                    </span>
                  </div>
                  <div className="row split">
                    <span className="lbl">Seniority · experience · workplace</span>
                    <span className="sub">
                      {result.readJob.level ?? 'not stated'}
                      {' · '}
                      {result.readJob.years ? `${result.readJob.years}+ years` : 'no bar stated'}
                      {' · '}
                      {result.readJob.workplace ?? 'not stated'}
                    </span>
                  </div>
                  {!result.readJob.requirementsFound && (
                    <div className="row split">
                      <span className="sub">
                        No distinct requirements section found, so terms were taken from the
                        whole description.
                      </span>
                      <span className="chip warn">less precise</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {a.topFixes.length > 0 && (
              <div className="card flow">
                <header><span className="lbl">Do these first</span></header>
                <p className="sub">
                  Ordered by how much they cost you. Each one says what to do — never the
                  words to write, because a line this app wrote is a claim you would have to
                  defend in the interview.
                </p>
                <div className="rows">
                  {a.topFixes.map((f, i) => <FindingRow key={i} f={f} />)}
                </div>
              </div>
            )}

            {a.target && (
              <div className="card flow">
                <header>
                  <span className="lbl">Against this posting</span>
                  <span className="sub">{a.target.asked.length} terms asked for</span>
                </header>
                <div className="rows">
                  <TermRow
                    label="Evidenced — a bullet of yours shows it"
                    terms={a.target.evidenced} cls="chip ok"
                    empty="Nothing the posting asks for is demonstrated by a bullet yet."
                  />
                  <TermRow
                    label="Claimed, but no bullet shows it"
                    terms={a.target.claimedNotShown} cls="chip warn"
                    empty="Nothing claimed without evidence."
                  />
                  <TermRow
                    label="Not in your skills list at all"
                    terms={a.target.missing} cls="chip"
                    empty="Nothing missing."
                  />
                </div>
                <p className="sub">
                  Every term lands in exactly one of these three. A résumé optimiser would
                  tell you to paste the last group in; we list them so you can decide which
                  ones are actually true of you.
                </p>
              </div>
            )}

            <div className="card flow">
              <header>
                <span className="lbl">How the score is made</span>
                <span className="sub">weighted mean · nothing hidden</span>
              </header>
              <div className="rows">
                {a.categories.map((c) => <CategoryRow key={c.key} c={c} />)}
              </div>
            </div>

            {result.tailored && (
              <div className="card flow">
                <header>
                  <span className="lbl">Your résumé, aimed at this posting</span>
                  <span className={result.tailored.integrityOk ? 'chip ok' : 'chip bad'}>
                    {result.tailored.integrityOk ? 'every line is yours, verbatim' : 'integrity check failed'}
                  </span>
                </header>
                <p className="sub">
                  {result.tailored.bulletsKept} of {result.tailored.bulletsAvailable} bullets
                  kept, chosen and ordered by what this posting asks for. Nothing rewritten,
                  nothing added.
                </p>
                <pre className="bullet mono" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
                  {result.tailored.text}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function CategoryRow({ c }: { c: AnalysisCategory }): React.ReactElement {
  const [open, setOpen] = useState(false);
  // Weight 0 means the category could not be judged — shown, but plainly
  // excluded rather than rendered as a zero the candidate would read as failure.
  const judged = c.weight > 0;

  return (
    <div className="row split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>{c.label}</strong>
          {judged
            ? <span className="lbl">{c.weight}% of the score</span>
            : <span className="chip">not scored</span>}
        </span>
        <span className="sub">{c.measured}</span>
        {judged && (
          <span
            className={`meter ${c.score >= 70 ? 'good' : c.score >= 40 ? 'warn' : 'low'}`}
            role="img"
            aria-label={`${c.label} ${c.score} of 100`}
          >
            <span style={{ width: `${Math.max(2, c.score)}%` }} />
          </span>
        )}
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {c.findings.map((f, i) => <FindingRow key={i} f={f} flat />)}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        {judged && (
          <span className="num" style={{
            letterSpacing: "-0.035em", fontWeight: 700, fontSize: '1.3rem',
            color: c.score >= 70 ? 'var(--good)' : c.score >= 40 ? 'var(--warn)' : 'var(--stop)',
          }}>
            {c.score}
          </span>
        )}
        <button className="btn" onClick={() => setOpen((s) => !s)}>
          {open ? 'Hide' : 'Why'}
        </button>
      </div>
    </div>
  );
}

function FindingRow({ f, flat }: { f: Finding; flat?: boolean }): React.ReactElement {
  const inner = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
      <span>{f.message}</span>
      {f.fix && <span className="sub">{f.fix}</span>}
    </div>
  );

  if (flat) {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span className={SEVERITY_CHIP[f.severity]}>{f.severity}</span>
        {inner}
      </div>
    );
  }

  return (
    <div className="row split">
      {inner}
      <span className={SEVERITY_CHIP[f.severity]}>{f.severity}</span>
    </div>
  );
}

function TermRow({ label, terms, cls, empty }: {
  label: string; terms: string[]; cls: string; empty: string;
}): React.ReactElement {
  return (
    <div className="row split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <span className="lbl">{label}</span>
        {terms.length === 0
          ? <span className="sub">{empty}</span>
          : (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {terms.map((t) => <span key={t} className={cls}>{t}</span>)}
            </span>
          )}
      </div>
      <span className="lbl">{terms.length}</span>
    </div>
  );
}
