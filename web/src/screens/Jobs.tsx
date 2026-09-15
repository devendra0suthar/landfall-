import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { JobRow } from '../api.js';

/**
 * The index.
 *
 * Two numbers travel with every posting and are never combined: match is an
 * inference about the job, readiness is how much of its form we can fill.
 * Averaging them would hide the distinction a candidate needs (FR-8).
 *
 * Sorted by match, because that is the question a candidate is actually asking
 * of a list this long. Readiness is not computed per row — it needs the form
 * compiled, which is a per-posting cost — so the list carries the form's state
 * and the prepare screen carries the number.
 */

export function Jobs(): React.ReactElement {
  const [country, setCountry] = useState('');
  const [days, setDays] = useState('');
  const [formOnly, setFormOnly] = useState(false);

  const q = new URLSearchParams({ limit: '60' });
  if (country) q.set('country', country);
  if (days) q.set('postedWithinDays', days);
  if (formOnly) q.set('formReadable', 'true');

  const { data, error, loading } = useAsync(
    () => api<{ count: number; scored: boolean; rows: JobRow[] }>(`/api/jobs?${q.toString()}`),
    [country, days, formOnly],
  );

  // Sorting by match is only meaningful once there is a profile to match
  // against. Without one the API sends null and the column says so.
  const rows = [...(data?.rows ?? [])].sort((x, y) => (y.match?.score ?? 0) - (x.match?.score ?? 0));

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Live index</span>
          <h1>{data ? `${data.count} open roles` : 'Jobs'}</h1>
        </div>
        <div className="filters">
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country">
            <option value="">Any country</option>
            <option>India</option>
            <option>Germany</option>
            <option>United States</option>
            <option>United Kingdom</option>
            <option>Singapore</option>
          </select>
          <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Posted within">
            <option value="">Any age</option>
            <option value="7">Posted in 7d</option>
            <option value="30">Posted in 30d</option>
            <option value="90">Posted in 90d</option>
          </select>
          <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={formOnly}
              onChange={(e) => setFormOnly(e.target.checked)}
            />
            Form readable only
          </label>
        </div>
      </div>

      <div className="body">
        <div className="note">
          <span className="lbl">Two scores, never averaged</span>
          <p className="sub">
            <strong>Match</strong> is what we infer about the role from the posting.{' '}
            <strong>Readiness</strong> is how much of its form we can fill from your own facts.
            A role can be a perfect fit and still a long evening of typing, which is exactly
            why these stay apart.
          </p>
        </div>

        <div className="card">
          <header>
            <span className="lbl">Role · sorted by match</span>
            <span className="lbl">Match · form</span>
          </header>
          <State loading={loading} error={error} empty={data?.rows.length === 0}>
            <div className="rows">
              {rows.map((r) => <JobLine key={r.id} job={r} />)}
            </div>
          </State>
        </div>
      </div>
    </>
  );
}

function JobLine({ job }: { job: JobRow }): React.ReactElement {
  const form = {
    readable: <span className="chip ok">{job.questionCount} questions</span>,
    'not-published': <span className="chip warn">publishes no form</span>,
    unknown: <span className="chip">form not read yet</span>,
  }[job.formState];

  return (
    <div className="row">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span className="t">{job.title}</span>
        <span className="m">
          {job.company}
          {job.location ? ` · ${job.location}` : ''}
          {job.remoteScope ? ` · remote: ${job.remoteScope}` : ''}
        </span>
        {job.skills.length > 0 && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
            {job.skills.slice(0, 6).join(' · ')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {job.match ? (
          <>
            <span style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
              fontSize: '1.3rem', lineHeight: 1,
              color: job.match.score >= 60 ? 'var(--good)' : job.match.score >= 35 ? 'var(--warn)' : 'var(--ink-muted)',
            }}>
              {job.match.score}
            </span>
            <span className="lbl">{job.match.confidence} confidence</span>
          </>
        ) : (
          <span className="lbl">no profile to match</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{form}</div>
      <a className="btn p" href={`#/prepare/${job.id}`} style={{ textDecoration: 'none' }}>
        Prepare
      </a>
    </div>
  );
}
