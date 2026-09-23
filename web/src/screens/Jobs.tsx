import { useEffect, useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { JobRow, ResumeList } from '../api.js';

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
 * and the kit screen carries the number.
 */

export function Jobs(): React.ReactElement {
  const [country, setCountry] = useState('');
  const [days, setDays] = useState('');
  const [formOnly, setFormOnly] = useState(false);
  // On by default. The measured alternative is a candidate in India scrolling
  // past 1,155 roles that name a country they are not in — and autofilling one
  // of those is faster waste, not less waste.
  const [eligibleOnly, setEligibleOnly] = useState(true);

  const PAGE = 60;
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<JobRow[]>([]);

  const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (country) q.set('country', country);
  if (days) q.set('postedWithinDays', days);
  if (formOnly) q.set('formReadable', 'true');
  if (eligibleOnly) q.set('eligible', 'true');

  const { data, error, loading } = useAsync(
    () => api<{
      count: number; total: number; offset: number; hasMore: boolean;
      scored: boolean; eligibilityApplied: boolean; rows: JobRow[];
    }>(`/api/jobs?${q.toString()}`),
    [country, days, formOnly, eligibleOnly, offset],
  );

  // A filter change is a new result set, not more of the old one.
  useEffect(() => { setOffset(0); setLoaded([]); }, [country, days, formOnly, eligibleOnly]);

  useEffect(() => {
    if (!data) return;
    setLoaded((prev) => (data.offset === 0 ? data.rows : [...prev, ...data.rows]));
  }, [data]);

  /**
   * Whether there is a résumé at all.
   *
   * Asked here, on the first screen anyone sees, because the alternative is
   * what this product shipped with: a candidate browses and prepares
   * applications for days without ever being told that the one field every form
   * asks for is empty. A banner on the list is the cheapest possible fix.
   */
  const resumes = useAsync(() => api<ResumeList>('/api/resumes'), []);
  const noResume = resumes.data !== null && resumes.data.count === 0;

  /**
   * Sorting by match is only meaningful once there is a profile to match
   * against. Without one the API sends null and the column says so.
   *
   * Sorted over everything loaded so far, not per page: sorting each page
   * separately would put a 70 from page two below a 20 from page one, which
   * looks like the ranking is broken.
   */
  const rows = [...loaded].sort((x, y) => (y.match?.score ?? 0) - (x.match?.score ?? 0));

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Live index</span>
          {/* The total matching the filter, not the size of the page. The old
              header read "60 open roles" whether the filter matched 60 or 2,400. */}
          <h1>{data ? `${data.total.toLocaleString()} open roles` : 'Jobs'}</h1>
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
          <label className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={eligibleOnly}
              onChange={(e) => setEligibleOnly(e.target.checked)}
            />
            Only roles I can take
          </label>
        </div>
      </div>

      <div className="body">
        {noResume && (
          <div className="note warn">
            <span className="lbl">Start with your résumé</span>
            <p>
              There is no résumé on file. Every form in the sample asks for one, so until you
              upload it the attachment field on every application stays empty — and the match
              scores below are based only on skills typed in by hand.
            </p>
            <p className="sub">
              Uploading also lets Landfall read your roles, dates and bullets into your profile,
              which is what every tailored résumé is then selected from.
            </p>
            <a className="btn p" href="#/resume">Upload my résumé →</a>
          </div>
        )}

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
          {/* Only the first page gets the skeleton. Once rows are on screen a
              "load more" must not blank them out and move everything. */}
          <State
            loading={loading && rows.length === 0}
            error={error}
            empty={!loading && rows.length === 0}
            rows={8}
          >
            <div className="rows">
              {rows.map((r) => <JobLine key={r.id} job={r} />)}
            </div>
          </State>
        </div>

        {/*
          * A filter that quietly does nothing is worse than no filter: the
          * candidate believes they are seeing only roles they can take. The
          * server reports whether it had a country to work from, and this says
          * so when it did not.
          */}
        {data && eligibleOnly && !data.eligibilityApplied && (
          <div className="note warn">
            <span className="lbl">Showing every role, including ones you may not be eligible for</span>
            <p>
              Filtering by eligibility needs a country on your profile — without one
              there is no basis for hiding anything.{' '}
              <a href="#/profile">Add your country</a>.
            </p>
          </div>
        )}

        {data && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'center' }}>
            <span className="sub">
              Showing {rows.length.toLocaleString()} of {data.total.toLocaleString()}
              {eligibleOnly && data.eligibilityApplied ? ' you can take' : ''}
            </span>
            {data.hasMore && (
              <button
                className="btn"
                disabled={loading}
                onClick={() => setOffset(rows.length)}
              >
                {loading ? 'Loading…' : `Load ${Math.min(PAGE, data.total - rows.length)} more`}
              </button>
            )}
          </div>
        )}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {job.match ? (
          <>
            <span className="num" style={{
              letterSpacing: "-0.035em", fontWeight: 700,
              fontSize: '1.3rem', lineHeight: 1,
              color: job.match.score >= 60 ? 'var(--good)' : job.match.score >= 35 ? 'var(--warn)' : 'var(--ink-muted)',
            }}>
              {job.match.score}
            </span>
            {/* Redundant encoding, not a replacement: two bar lengths compare
                at a glance down a long list where two numbers do not, and the
                number stays for anyone the colour or length fails. */}
            <span
              className={`meter ${job.match.score >= 60 ? 'good' : job.match.score >= 35 ? 'warn' : 'low'}`}
              role="img"
              aria-label={`match ${job.match.score} of 100`}
            >
              <span style={{ width: `${Math.max(2, Math.min(100, job.match.score))}%` }} />
            </span>
            <span className="lbl">{job.match.confidence} confidence</span>
          </>
        ) : (
          <span className="lbl">no profile to match</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{form}</div>
      <a className="btn p" href={`#/kit/${job.id}`} style={{ textDecoration: 'none' }}>
        Get the kit
      </a>
    </div>
  );
}
