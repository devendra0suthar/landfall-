import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { RunResponse, RunItem } from '../api.js';

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

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Prepared for you</span>
          <h1>{d ? `Your next ${d.items.length} applications` : 'Your next applications'}</h1>
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
        <div className="card flow">
          <p>
            Your best matches that you are eligible for and whose form Landfall can
            read — each one already compiled from your own facts. Work down the list:
            open the form, let the extension fill it, check it, and press their submit
            button yourself.
          </p>
          <p className="sub">
            Landfall never submits. That is the line, and it is why this prepares
            applications rather than firing them off while you sleep.
          </p>
        </div>

        {/*
          * No `empty` here on purpose: State's generic "Nothing here yet" would
          * hide couldNotPrepare, and a run where all ten failed must still say
          * why. The empty case is handled below, with somewhere to go next.
          */}
        <State loading={run.loading} error={run.error} rows={5}>
          {d && (
            <>
              {d.items.length > 0 && (
                <div className="grid">
                  <Stat n={d.totals.prepared} k="answers ready across this run" tone="ok" />
                  <Stat n={d.totals.yours} k="questions only you may answer" />
                  <Stat n={d.totals.open} k="still open — no answer on file yet" tone="warn" />
                </div>
              )}

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

function Stat({ n, k, tone }: { n: number; k: string; tone?: string }): React.ReactElement {
  return (
    <div className="stat">
      <strong className={tone ? `chip ${tone}` : undefined}>{n.toLocaleString()}</strong>
      <span className="sub">{k}</span>
    </div>
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
            <span className="sub"> of {item.fields} fields on their form</span>
          )}
        </div>
      </div>
      <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <a className="btn" href={`#/kit/${item.jobId}`}>Open kit</a>
        <a className="btn p" href={item.url} target="_blank" rel="noreferrer">Their form ↗</a>
        <button className="btn" disabled={busy} onClick={() => void act('APPLIED')}>
          I applied
        </button>
        <button className="btn" disabled={busy} onClick={() => void act('SKIPPED')}>
          Skip
        </button>
        {error && <span className="sub" role="alert">{error}</span>}
      </span>
    </div>
  );
}
