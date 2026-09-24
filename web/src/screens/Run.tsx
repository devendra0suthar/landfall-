import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { RunResponse, RunItem, GapReport, GapRow, SavedSearch } from '../api.js';

/**
 * The run — your next applications, already prepared.
 *
 * This exists because of a fair complaint: Landfall made you do everything one
 * job at a time. Search, open a posting, read a Kit, go back, search again —
 * while the products it gets compared to say "set your preferences and we apply
 * while you sleep".
 *
 * What people actually feel in that comparison is **batching**, not autonomy:
 * one decision covering many applications instead of one decision per
 * application. Batching we can do. Submitting we do not, and will not — the
 * submit button stays yours (rule 4). So this is the honest version: the top
 * matches you can actually take, every form already compiled, presented as a
 * list you work down rather than a search you keep repeating.
 *
 * It states what it could not prepare rather than quietly returning fewer rows.
 * A run of ten that hands back six without saying so is the same failure as a
 * Kit that presents an unread form as having no questions.
 */

export function Run(): React.ReactElement {
  const [size, setSize] = useState(10);
  const run = useAsync(() => api<RunResponse>(`/api/run?limit=${size}`), [size]);
  const d = run.data;
  const gaps = useAsync(() => api<GapReport>('/api/gaps'), []);
  const saved = useAsync(() => api<{ rows: SavedSearch[] }>('/api/searches'), []);

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Prepared for you</span>
          <h1>{d ? `Your next ${d.items.length} applications` : 'Your next applications'}</h1>
          <p className="sub">Each form is prepared from your own facts. You check it and submit — Landfall never does.</p>
        </div>
        <div className="filters">
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="How many">
            <option value={5}>5 at a time</option>
            <option value={10}>10 at a time</option>
            <option value={25}>25 at a time</option>
          </select>
        </div>
      </div>

      <div className="body">

        {/*
          * No `empty` here on purpose: State's generic "Nothing here yet" would
          * hide couldNotPrepare, and a run where all ten failed must still say
          * why. The empty case is handled below, with somewhere to go next.
          */}
        <State loading={run.loading} error={run.error} rows={5}>
          {d && (
            <>
              {/*
                * Instead of three tiles ending in "75 still open": the few
                * questions behind most of those 75. They repeat across
                * employers, so one answer here fills them on every form.
                */}
              {gaps.data && (
                <QuickAnswers
                  rows={groupQuick(gaps.data.rows.bankable.filter((g) => g.answer === null && !FOLLOW_UP.test(g.labelKey))).slice(0, 4)}
                  onSaved={() => { gaps.reload(); run.reload(); }}
                />
              )}

              {saved.data && <SavedSearches rows={saved.data.rows} onChange={saved.reload} />}

              {d.available > d.items.length && (
                <p className="sub">
                  {d.available.toLocaleString()} matching roles are waiting in total. Finish
                  these and the next ones move up.
                </p>
              )}

              {/*
                * Named, not silently dropped. A run of ten that returns six
                * without saying why teaches people the number means nothing.
                */}
              {d.couldNotPrepare.length > 0 && (
                <div className="note warn">
                  <span className="lbl">
                    {d.couldNotPrepare.length} could not be prepared
                  </span>
                  <p className="sub">
                    {[...new Set(d.couldNotPrepare.map((c) => c.reason))].join(' · ')}
                  </p>
                </div>
              )}

              {d.items.length === 0 && (
                <div className="note">
                  <span className="lbl">
                    {d.available === 0 ? 'Nothing left to prepare' : 'Nothing prepared this time'}
                  </span>
                  <p>
                    {d.available === 0
                      ? 'You have been through every role you are eligible for whose form we can read. '
                        + 'New postings arrive as boards are re-read — or widen the search yourself.'
                      : 'None of the top matches could be prepared — the reasons are above.'}
                  </p>
                  <p><a className="btn" href="#/jobs">Browse all jobs</a></p>
                </div>
              )}

              <div className="rows">
                {d.items.map((item, i) => (
                  <RunLine key={item.jobId} item={item} n={i + 1} onDone={run.reload} />
                ))}
              </div>
            </>
          )}
        </State>
      </div>
    </>
  );
}


/**
 * Record the candidate's own decision about one job (FR-22).
 *
 * This is what makes "finish these and the next ones move up" true: the run
 * skips APPLIED and SKIPPED, and without a way to reach either from here the
 * list handed back the same ten jobs forever. APPLIED is their claim that they
 * pressed submit — nothing here contacts the employer.
 */
async function mark(jobId: string, status: 'APPLIED' | 'SKIPPED'): Promise<void> {
  const created = await api<{ id: string }>('/api/applications', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
  await api(`/api/applications/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** One job in the run. Everything needed to act, nothing else. */
function RunLine({ item, n, onDone }: {
  item: RunItem; n: number; onDone: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(status: 'APPLIED' | 'SKIPPED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Any archive note ("nothing could be saved") is shown on the Tracker,
      // where the record lives; the status was recorded either way.
      await mark(item.jobId, status);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="row split" style={{ alignItems: 'flex-start' }}>
      <div style={{ minWidth: 0 }}>
        <strong>
          <span className="sub">{n}. </span>
          {item.title}
        </strong>
        <div className="sub">
          {item.company}
          {item.location ? ` · ${item.location}` : ''}
          {' · '}
          match {item.match}
        </div>
        <div className="sub" style={{ marginTop: 4 }}>
          <span className="chip ok">{item.prepared} ready</span>{' '}
          {item.yours > 0 && <><span className="chip">{item.yours} yours</span>{' '}</>}
          {item.open > 0 && <span className="chip warn">{item.open} open</span>}
          {item.fields !== null && (
            <span className="sub"> · {item.fields} questions on their form</span>
          )}
        </div>
      </div>
      {/*
        * One primary action per row. Four equal buttons made every row a
        * decision about which to press; the order of work is "open their form,
        * fill, submit, then say so", and the weights now read in that order.
        */}
      <div className="run-actions">
        <div className="run-go">
          <a className="btn p" href={item.url} target="_blank" rel="noreferrer">Their form ↗</a>
          <a className="btn" href={`#/kit/${item.jobId}`}>Open kit</a>
        </div>
        <div className="run-mark">
          <button className="btn linkish" disabled={busy} onClick={() => void act('APPLIED')}>
            I applied
          </button>
          <span aria-hidden="true">·</span>
          <button className="btn linkish quiet" disabled={busy} onClick={() => void act('SKIPPED')}>
            Skip
          </button>
        </div>
        {error && <span className="sub" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/**
 * One row per question as a person reads it. "How did you hear about this
 * job?" and "…this opportunity?" are separate keys in the index and were two
 * rows asking the same thing; grouped, one answer is saved to both.
 */
/**
 * "If you selected … above" only means something next to its parent question
 * on one form; asked on its own here it has no parent. The planner routes the
 * same shape to the candidate (plan.ts), so this matches its rule.
 */
const FOLLOW_UP = /^if (yes|no|you|applicable|selected|other)|^if you'?(re|ve)/;

interface QuickGroup { label: string; keys: string[]; jobCount: number }
function groupQuick(rows: GapRow[]): QuickGroup[] {
  const NOUN = /\b(this|the)\s+(job|opportunity|position|role|posting|vacancy)\b/g;
  const byStem = new Map<string, QuickGroup>();
  for (const g of rows) {
    const stem = g.labelKey.replace(NOUN, '').replace(/\s+/g, ' ').trim();
    const hit = byStem.get(stem);
    if (hit) { hit.keys.push(g.labelKey); hit.jobCount += g.jobCount; }
    else byStem.set(stem, { label: g.label, keys: [g.labelKey], jobCount: g.jobCount });
  }
  return [...byStem.values()].sort((a, b) => b.jobCount - a.jobCount);
}

/** Yes/no questions get two buttons; anything else a short text box. */
const YES_NO = /^(are|do|have|will|can|would|is|did)\s/i;

function QuickAnswers({ rows, onSaved }: { rows: QuickGroup[]; onSaved: () => void }): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div className="card flow quick">
      <header>
        <span className="lbl">Quick answers</span>
        <a className="sub" href="#/gaps">all questions →</a>
      </header>
      <p className="sub">Employers keep asking these. Answer once and every form that asks is filled.</p>
      <div className="rows">
        {rows.map((g) => <QuickRow key={g.keys[0]} g={g} onSaved={onSaved} />)}
      </div>
    </div>
  );
}

function QuickRow({ g, onSaved }: { g: QuickGroup; onSaved: () => void }): React.ReactElement {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(value: string): Promise<void> {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      // The same endpoint as Gaps and the Kit, which refuses consent and
      // demographic questions at the door — and those are never in the
      // "bankable" list this is drawn from.
      for (const key of g.keys) {
        await api(`/api/bank/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({ value: value.trim() }),
        });
      }
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="row split">
      <div style={{ minWidth: 0 }}>
        <strong>{g.label}</strong>
        <div className="sub">asked on {g.jobCount.toLocaleString()} forms</div>
      </div>
      {YES_NO.test(g.label) ? (
        <div className="quick-actions">
          <button className="btn" disabled={busy} onClick={() => void save('Yes')}>Yes</button>
          <button className="btn" disabled={busy} onClick={() => void save('No')}>No</button>
          {err && <span className="sub" role="alert">{err}</span>}
        </div>
      ) : (
        <form className="quick-actions" onSubmit={(e) => { e.preventDefault(); void save(text); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} aria-label={g.label} placeholder="Your answer" />
          <button className="btn p" disabled={busy || !text.trim()}>Save</button>
          {err && <span className="sub" role="alert">{err}</span>}
        </form>
      )}
    </div>
  );
}

/**
 * The alert, where people already look. The index refreshes daily; each saved
 * search here says how many open matches arrived since it was last opened.
 * Newest-news first, so the one with something to read leads.
 */
function SavedSearches({ rows, onChange }: { rows: SavedSearch[]; onChange: () => void }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="sub">
        Looking for something specific? <a href="#/ask">Ask for it in your own words</a> and save the
        search — new matches will show up here.
      </p>
    );
  }
  const sorted = [...rows].sort((a, b) => b.newCount - a.newCount);
  const fresh = rows.reduce((n, r) => n + r.newCount, 0);

  async function remove(id: string): Promise<void> {
    try { await api(`/api/searches/${encodeURIComponent(id)}`, { method: 'DELETE' }); } finally { onChange(); }
  }

  return (
    <div className="card flow">
      <header>
        <span className="lbl">Your saved searches</span>
        <span className="sub">{fresh > 0 ? `${fresh} new job${fresh === 1 ? '' : 's'} since you last looked` : 'nothing new yet — checked daily'}</span>
      </header>
      <div className="rows">
        {sorted.map((r) => (
          <div key={r.id} className="row split">
            <div style={{ minWidth: 0 }}>
              <strong>{r.label}</strong>
              <div className="sub">
                {r.newCount > 0 && <><span className="chip ok">{r.newCount} new</span>{' '}</>}
                {r.total.toLocaleString()} open now
              </div>
            </div>
            <div className="quick-actions">
              <a className={r.newCount > 0 ? 'btn p' : 'btn'} href={`#/ask/@${r.id}`}>
                {r.newCount > 0 ? 'See what’s new' : 'Open'}
              </a>
              <button className="btn linkish quiet" aria-label={`Remove saved search ${r.label}`} onClick={() => void remove(r.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
