import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import { ApplyWithExtension } from './ConnectExtension.js';
import type { ApplicationKit, JobScore, KitFormState, KitQuestion } from '../api.js';
import type { TemplateList } from '../api.js';

/**
 * The Application Kit — one screen for the whole handover.
 *
 * This is what Landfall gives a candidate instead of applying for them: every
 * question the employer's form asks, in their order, with the prepared answer
 * and where it came from — and a plain statement of what we could not read.
 *
 * It absorbed the old Prepare screen, which showed the same facts across three
 * requests. Two screens over one deliverable meant two places for the honesty
 * rules to live, and they had already started to differ: Prepare rendered a
 * missing form as a quiet note under "the fill plan", where this screen leads
 * with it.
 *
 * Three design rules here are load-bearing rather than cosmetic:
 *
 * - **The form's state is announced before anything else.** A Kit that looks
 *   complete because the form was never read is the worst thing this screen
 *   can show, so the banner comes first and is rendered from the server's own
 *   sentence. Deriving that copy here would let each screen word it slightly
 *   differently, and "we haven't checked" would eventually read as "there's
 *   nothing to check".
 *
 * - **Prepared, yours and open are three lists, never one with badges.** A
 *   single sorted table with a status column invites a "92% ready" summary
 *   above it, and that number would absorb the questions only the candidate
 *   may answer into something that looks like progress.
 *
 * - **Every claim shows its evidence next to it.** "Every line is yours,
 *   verbatim" sits above the kept-and-dropped bullets that let them check it.
 *   A claim whose evidence is one screen away is one most people never verify.
 */

const SOURCE_CHIP: Record<KitQuestion['source'], { cls: string; label: string }> = {
  profile: { cls: 'chip ok', label: 'your profile' },
  bank: { cls: 'chip ok', label: 'saved answer' },
  file: { cls: 'chip ok', label: 'attachment' },
  generated: { cls: 'chip warn', label: 'needs writing' },
  user: { cls: 'chip', label: 'only you' },
  unresolved: { cls: 'chip bad', label: 'no answer yet' },
};

const FORM_TONE: Record<KitFormState, string> = {
  readable: 'note',
  unpublished: 'note warn',
  unread: 'note warn',
};

const FORM_LABEL: Record<KitFormState, string> = {
  readable: 'Read from this employer’s form',
  unpublished: 'This employer publishes no readable form',
  unread: 'We have not read this form yet',
};

export function Kit({ jobId }: { jobId: string }): React.ReactElement {
  const kit = useAsync(
    () => api<ApplicationKit>(`/api/jobs/${encodeURIComponent(jobId)}/kit`),
    [jobId],
  );

  /**
   * Scoring is a second request, deliberately.
   *
   * Match and readiness are discovery signals with their own nullability — a
   * score of 0 and "no profile to compare against" are different facts, and
   * that logic already lives behind /api/jobs/:id. Folding it into the Kit
   * contract would mix the handover artifact with the ranking that led to it.
   */
  const scored = useAsync(
    () => api<{ score: JobScore | null }>(`/api/jobs/${encodeURIComponent(jobId)}`),
    [jobId],
  );

  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState<{ filename: string; sha256: string } | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  /**
   * The candidate marks their own submission (FR-22).
   *
   * Nothing here submits anything to the employer — it records that the
   * candidate says they sent it. `submitted` is their claim; only external
   * evidence would make it `confirmed`.
   */
  async function markApplied(): Promise<void> {
    setMarking(true);
    setMarkError(null);
    try {
      const created = await api<{ id: string }>('/api/applications', {
        method: 'POST',
        body: JSON.stringify({ jobId }),
      });
      const res = await api<{ sent: { filename: string; sha256: string } | null }>(
        `/api/applications/${created.id}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'APPLIED' }) },
      );
      setMarked(res.sent);
    } catch (e) {
      setMarkError((e as Error).message);
    }
    setMarking(false);
  }

  const k = kit.data;
  const score = scored.data?.score ?? null;

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">
            <a href="#/jobs">← Jobs</a>
            {k ? ` · ${k.job.company}${k.job.location ? ` · ${k.job.location}` : ''}` : ''}
          </span>
          <h1>{k?.job.title ?? 'Building your kit…'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          {score && (
            <>
              {/* Two scores, shown separately and never combined (FR-8). One is
                  an inference about the posting; the other is a measurement of
                  our own coverage. Averaging them would mean nothing. */}
              <Score
                k="Match"
                v={String(score.match.score)}
                note={`${score.match.confidence} confidence`}
                tone={score.match.score >= 60 ? 'good' : 'warn'}
              />
              <Score
                k="Readiness"
                v={score.readiness.measured && score.readiness.pct !== null
                  ? `${Math.round(score.readiness.pct * 100)}%`
                  : '—'}
                note={score.readiness.measured
                  ? `${score.readiness.filled} of ${score.readiness.total} fields`
                  : 'form not readable'}
                tone="deep"
              />
            </>
          )}
          {k && (
            <a className="btn" href={k.job.url} target="_blank" rel="noopener noreferrer">
              Open their form ↗
            </a>
          )}
        </div>
      </div>

      <div className="body">
        <State loading={kit.loading} error={kit.error}>
          {k && (
            <>
              {/* Announced first, always. See the header comment. */}
              <div className={FORM_TONE[k.form.state]}>
                <span className="lbl">{FORM_LABEL[k.form.state]}</span>
                <p>{k.form.statement}</p>
                <p className="sub">
                  {k.form.fields === null
                    // "Unknown" is a real answer and gets rendered as one. A 0
                    // here would read as "they ask nothing".
                    ? 'Questions on their form: unknown'
                    : `${k.form.stated} of ${k.form.fields} questions on their form are covered below`}
                  {k.form.coverage !== null ? ` · ${k.form.coverage}% coverage` : ''}
                  {k.form.skippedOptionalBlank > 0
                    ? ` · ${k.form.skippedOptionalBlank} optional field${k.form.skippedOptionalBlank === 1 ? '' : 's'} you have left blank`
                    : ''}
                </p>
              </div>

              <div className="grid">
                <Stat n={k.counts.prepared} k="ready to paste — from your own verified facts" tone="ok" />
                <Stat n={k.counts.yours} k="only you may answer — consent, attestation, demographics" />
                <Stat
                  n={k.counts.open}
                  k="still open — prose to write, or nothing stored yet"
                  tone={k.counts.open > 0 ? 'warn' : undefined}
                />
              </div>

              {score && (
                <div className="card flow">
                  <header>
                    <span className="lbl">Why this match score</span>
                    <span className="sub">{score.match.basis.join(' · ')}</span>
                  </header>
                  <div className="rows">
                    {score.match.signals.map((sig) => (
                      <div className="row split" key={sig.name}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                          <strong>{sig.name}</strong>
                          <span className="sub">{sig.detail}</span>
                        </span>
                        <span className={sig.hit ? 'chip ok' : 'chip'}>{sig.hit ? 'yes' : 'no'}</span>
                      </div>
                    ))}
                  </div>
                  {score.match.missingSkills.length > 0 && (
                    <p className="sub">
                      Asked for, not claimed: {score.match.missingSkills.slice(0, 8).join(' · ')}. An
                      inference about the posting, not a judgement about whether you would be hired.
                    </p>
                  )}
                </div>
              )}

              {k.answers.length > 0 && (
                <Section
                  title="Their questions, your answers"
                  note="In the employer’s own field order. Every value came from something you confirmed."
                >
                  {k.answers.map((q, i) => <Row key={`${q.fieldName ?? q.label}-${i}`} q={q} />)}
                </Section>
              )}

              {k.yours.length > 0 && (
                <Section
                  title="Yours to answer"
                  note="Consent, attestations and demographic questions. Landfall never answers one of these on your behalf — ticking it would be making a statement in your name."
                >
                  {k.yours.map((q, i) => <Row key={`${q.fieldName ?? q.label}-${i}`} q={q} />)}
                </Section>
              )}

              {k.openItems.length > 0 && (
                <Section
                  title="Still open"
                  note="Answer these once and they are saved for every employer that asks the same thing."
                >
                  {k.openItems.map((q, i) => <Row key={`${q.fieldName ?? q.label}-${i}`} q={q} />)}
                </Section>
              )}

              {/* The attachment is the one open item with a one-click fix, so it
                  gets a route out rather than just a reason. */}
              {k.openItems.some((q) => q.source === 'file' || /resume|cv/i.test(q.label)) && (
                <div className="note warn">
                  <span className="lbl">No résumé attached</span>
                  <p>
                    This employer asks for one and there is no file on record, so that field would
                    go in empty. Upload it once and it is answered here and on every application
                    after this.
                  </p>
                  <a className="btn p" href="#/resume">Upload my résumé →</a>
                </div>
              )}

              <Resume kit={k} jobId={jobId} />
              <ApplyWithExtension formState={k.form.state} url={k.job.url} />

              <Letter kit={k} />

              <div className="card flow">
                <header>
                  <span className="lbl">When you have sent it</span>
                </header>
                <p className="sub">
                  Landfall does not submit. Open their form, paste your answers, send it yourself —
                  then mark it here so the tracker holds a record of what you sent.
                </p>
                {marked ? (
                  <div className="note ok">
                    <span className="lbl">Recorded, and archived</span>
                    <p>
                      <span className="mono">{marked.filename}</span>
                    </p>
                    <p className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                      sha256 {marked.sha256}
                    </p>
                    <p className="sub">
                      Written once. Editing your profile from here on will not change what they
                      read. Status is <span className="mono">submitted</span>, on your word — it
                      becomes <span className="mono">confirmed</span> only on evidence from them.{' '}
                      <a href="#/tracker">Open the tracker →</a>
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button className="btn p" onClick={() => void markApplied()} disabled={marking}>
                      {marking ? 'Recording…' : 'I sent this application'}
                    </button>
                    {markError && <span className="chip bad">{markError}</span>}
                  </div>
                )}
              </div>
            </>
          )}
        </State>
      </div>
    </>
  );
}

/**
 * The résumé, and the working behind it.
 *
 * The keyword split is the part a résumé optimiser would sell as "ATS
 * optimisation". The difference is the third group: we name what the posting
 * asks for and the candidate cannot evidence, instead of suggesting they add it.
 */
function Resume({ kit, jobId }: { kit: ApplicationKit; jobId: string }): React.ReactElement {
  const [showWorking, setShowWorking] = useState(false);
  // Remembered per browser, not per posting: someone who prefers one layout
  // prefers it for every application, and re-choosing it each time is the kind
  // of small friction that makes a feature feel like a toy.
  const [template, setTemplate] = useState<string>(
    () => {
      try { return localStorage.getItem('landfall:template') ?? 'classic'; } catch { return 'classic'; }
    },
  );

  return (
    <div className="card flow">
      <header>
        <span className="lbl">Your résumé, aimed at this posting</span>
        <span className={kit.resume.integrityOk ? 'chip ok' : 'chip bad'}>
          {kit.resume.integrityOk ? 'every line is yours, verbatim' : 'integrity check failed'}
        </span>
      </header>
      <p className="sub">
        {kit.resume.bulletsKept} of {kit.resume.bulletsAvailable} bullets kept, chosen and ordered
        by what this posting asks for. Nothing was rewritten and nothing was added.
      </p>

      <div className="rows">
        <KeywordRow
          label="Asked for and evidenced"
          terms={kit.resume.evidenced}
          cls="chip ok"
          empty="No asked-for term is evidenced by a bullet yet."
        />
        <KeywordRow
          label="Claimed, but no bullet shows it"
          terms={kit.resume.claimedNotShown}
          cls="chip warn"
          empty="Nothing claimed without evidence."
        />
        <KeywordRow
          label="Asked for and you have not claimed it"
          terms={kit.resume.missing}
          cls="chip"
          empty="Nothing the posting asks for is missing."
        />
      </div>

      <p className="sub">
        A résumé optimiser would tell you to add the last group as keywords. We list them as gaps,
        because putting a skill on a CV you cannot demonstrate is a claim you have to defend in the
        interview.
      </p>

      <TemplatePicker value={template} onChange={setTemplate} />

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <a
          className="btn"
          href={`/api/jobs/${encodeURIComponent(jobId)}/resume.pdf?template=${encodeURIComponent(template)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          The PDF you would attach ↗
        </a>
        <button className="btn" onClick={() => setShowWorking((s) => !s)}>
          {showWorking ? 'Hide the working' : 'Show which bullets, and why'}
        </button>
      </div>

      {showWorking && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          {kit.resume.roles.map((r) => (
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
              {/* Shown, not hidden: the candidate is owed the chance to disagree
                  with what was left out. A selection you cannot inspect is
                  indistinguishable from a rewrite. */}
              {r.dropped.map((b) => (
                <div className="bullet drop" key={b.text}>
                  <span className="s" style={{ color: 'var(--ink-muted)' }}>0</span>
                  <span>{b.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Count real prose, treating a bracketed prompt as the gap it is.
 *
 * Character-for-character the rule in `api/src/compose/letter.ts` (`wordCount`),
 * which has the test. It is duplicated rather than shared because the count has
 * to update as the candidate types and the server sees the draft only if they
 * save it — but the two must not disagree, so if that rule changes, change both.
 *
 * The version this replaced had lost its backslashes — `/[[^]]*]/` and `/s+/` —
 * so it split on the letter "s" and stripped nothing. Every count it showed was
 * wrong.
 */
function proseWords(text: string): number {
  return text.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter(Boolean).length;
}

/** How many prompts are still unanswered. */
function promptCount(text: string): number {
  return (text.match(/\[[^\]]*\]/g) ?? []).length;
}

/**
 * The letter — theirs to finish.
 *
 * The draft starts read-only behind an explicit "edit" step. Prepare used to
 * build it on request for the same reason: a letter that arrives looking
 * finished invites being sent as-is, which is exactly what the brackets exist
 * to prevent. Now that the text comes down with the Kit there is no request to
 * withhold, so the friction is the edit affordance instead.
 */
function Letter({ kit }: { kit: ApplicationKit }): React.ReactElement {
  const [draft, setDraft] = useState(kit.letter.text);
  const [editing, setEditing] = useState(false);
  const [showFacts, setShowFacts] = useState(false);

  const remaining = promptCount(draft);

  return (
    <div className="card flow">
      <header>
        <span className="lbl">Cover letter starter — yours to finish</span>
        <span className="chip">
          {kit.letter.grounded} grounded {kit.letter.grounded === 1 ? 'fact' : 'facts'} ·{' '}
          {kit.letter.yours} for you
        </span>
      </header>
      <p className="sub">
        Deliberately unfinished. The bracketed prompts are the parts only you can write — a
        complete letter would be this app making claims in your name.
      </p>

      {editing ? (
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
            <strong>{proseWords(draft)}</strong> words of real prose — brackets do not count,
            because they are prompts, not writing.
            {remaining > 0 && (
              <span style={{ color: 'var(--stop)' }}>
                {' '}{remaining} prompt{remaining === 1 ? '' : 's'} still unanswered.
              </span>
            )}
          </p>
        </>
      ) : (
        <>
          <pre className="bullet mono" style={{ whiteSpace: 'pre-wrap' }}>{draft}</pre>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setEditing(true)}>Edit this draft</button>
          </div>
        </>
      )}

      {kit.letter.wouldHelp.length > 0 && (
        <p className="sub">
          Filling these in your profile would each close one prompt:{' '}
          {kit.letter.wouldHelp.join(', ')}
        </p>
      )}

      <div style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setShowFacts((s) => !s)}>
          {showFacts ? 'Hide what went into it' : 'What went into it'}
        </button>
      </div>

      {showFacts && (
        <div className="rows" style={{ marginTop: 10 }}>
          {kit.letter.facts.map((f) => (
            <div className="row split" key={`${f.field}-${f.value}`}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <span className="lbl">{f.field}</span>
                <span>{f.value}</span>
              </span>
              <span className={f.source === 'profile' ? 'chip ok' : 'chip'}>{f.source}</span>
            </div>
          ))}
          {kit.letter.missingContext.map((m) => (
            <p className="sub" key={m}>{m}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, note, children }: {
  title: string; note: string; children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="card flow">
      <header><span className="lbl">{title}</span></header>
      <p className="sub">{note}</p>
      <div className="rows">{children}</div>
    </div>
  );
}

function Row({ q }: { q: KitQuestion }): React.ReactElement {
  const chip = SOURCE_CHIP[q.source];
  const [copied, setCopied] = useState(false);

  /** Per-field copy (FR-41). The candidate pastes; we never write into the form. */
  async function copy(): Promise<void> {
    if (q.value === null) return;
    try {
      await navigator.clipboard.writeText(q.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard permission can be refused, and a silent no-op would look
      // like the value copied. The value is on screen and selectable either
      // way, so this degrades to "select it yourself" rather than to nothing.
      setCopied(false);
    }
  }

  return (
    <div className="row split">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>{q.label}</strong>
          {q.required && <span className="chip warn">required</span>}
          {!q.read && (
            // The candidate must be able to tell an expected question from one
            // we actually read. An expected question that never appears costs
            // nothing; an unexpected one that does is what catches people out.
            <span className="chip">expected, not read from their form</span>
          )}
        </span>
        {q.value !== null && <span className="mono">{q.value}</span>}
        {q.reason !== null && <span className="sub">{q.reason}</span>}
        {/* Two fields can carry the same label — Addepar's form has two
            "LinkedIn Profile" questions — so the vendor's own field name is
            shown to disambiguate rather than deduping them away. */}
        {q.fieldName !== null && <span className="sub mono">{q.fieldName}</span>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <span className={chip.cls}>{chip.label}</span>
        {q.value !== null && (
          <button className="btn" onClick={() => void copy()}>{copied ? 'copied' : 'copy'}</button>
        )}
      </div>
    </div>
  );
}

function KeywordRow({ label, terms, cls, empty }: {
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
        letterSpacing: "-0.035em", fontWeight: 700,
        fontSize: '1.7rem', lineHeight: 1, color: colour,
      }}>
        {v}
      </span>
      <span className="lbl">{note}</span>
    </div>
  );
}

function Stat({ n, k, tone }: { n: number; k: string; tone?: 'ok' | 'warn' | 'bad' }): React.ReactElement {
  const colour = tone === 'ok' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)'
    : tone === 'bad' ? 'var(--stop)' : 'var(--ink)';
  return (
    <div className="card stat">
      <strong style={{ color: colour }}>{n}</strong>
      <span className="sub">{k}</span>
    </div>
  );
}

/**
 * Choosing a layout.
 *
 * Every option renders the same words from the same facts — they differ in
 * metrics, alignment and rules, and a test asserts that content is identical
 * across all of them. So this is genuinely a preference, and it says so rather
 * than implying that one layout will score better with an employer.
 *
 * The list comes from the server so a template added there appears here without
 * a front-end change.
 */
function TemplatePicker({ value, onChange }: {
  value: string;
  onChange: (id: string) => void;
}): React.ReactElement | null {
  const list = useAsync(() => api<TemplateList>('/api/resume/templates'), []);
  const templates = list.data?.templates ?? [];
  if (templates.length < 2) return null;

  const chosen = templates.find((t) => t.id === value) ?? templates[0];

  function pick(id: string): void {
    onChange(id);
    // A preference, not data. Losing it costs a click, so browser storage is
    // the right home for it and a refusal to store is not worth reporting.
    try { localStorage.setItem('landfall:template', id); } catch { /* private window */ }
  }

  return (
    <div style={{ marginTop: 14 }}>
      <span className="lbl">Layout</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {templates.map((t) => (
          <button
            key={t.id}
            className={t.id === value ? 'btn p' : 'btn'}
            aria-pressed={t.id === value}
            onClick={() => pick(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {chosen && <p className="sub" style={{ marginTop: 6 }}>{chosen.suits}</p>}
      <p className="sub">
        Every layout says exactly the same thing — same bullets, same roles, same order.
        Only the typesetting changes.
      </p>
    </div>
  );
}
