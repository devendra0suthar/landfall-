import { useEffect, useState } from 'react';
import { Jobs } from './screens/Jobs.js';
import { Kit } from './screens/Kit.js';
import { Resume } from './screens/Resume.js';
import { Analyze } from './screens/Analyze.js';
import { Tracker } from './screens/Tracker.js';
import { Profile } from './screens/Profile.js';
import { Gaps } from './screens/Gaps.js';
import { ParseReview } from './screens/ParseReview.js';
import { Aim } from './Aim.js';

/**
 * The shell, and the router.
 *
 * Hash routing, by hand. The app has seven screens and two nested routes; a
 * router library would be more code to load than to write, and this keeps the
 * static build free of a dependency that only earns its place at ten screens.
 *
 * `kit` is the apply view. `prepare` was folded into it — the two rendered the
 * same deliverable and had begun to disagree about how to report a form we
 * could not read. `#/prepare/:id` still resolves, to `kit`, because links to it
 * exist in the tracker and in people's history.
 */

type Route =
  | { name: 'jobs' }
  | { name: 'kit'; jobId: string }
  | { name: 'resume' }
  | { name: 'analyze' }
  | { name: 'tracker'; appId?: string }
  | { name: 'gaps' }
  | { name: 'profile' }
  | { name: 'parse' };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, id] = path.split('/');
  if (head === 'kit' && id) return { name: 'kit', jobId: id };
  // Old links keep working rather than dumping someone on the job list with no
  // explanation of why the page they bookmarked is gone.
  if (head === 'prepare' && id) return { name: 'kit', jobId: id };
  if (head === 'tracker') return id ? { name: 'tracker', appId: id } : { name: 'tracker' };
  if (head === 'resume') return { name: 'resume' };
  if (head === 'analyze') return { name: 'analyze' };
  if (head === 'gaps') return { name: 'gaps' };
  if (head === 'parse') return { name: 'parse' };
  if (head === 'profile') return { name: 'profile' };
  return { name: 'jobs' };
}

export function App(): React.ReactElement {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onHash = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="shell">
      <aside className="side">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="wordmark">Landfall</span>
          <div className="ticks" aria-hidden="true" />
        </div>
        <nav className="nav">
          <a href="#/jobs" className={route.name === 'jobs' ? 'on' : ''}>Jobs</a>
          <a
            href={route.name === 'kit' ? `#/kit/${route.jobId}` : '#/jobs'}
            className={route.name === 'kit' ? 'on' : ''}
          >
            Kit
          </a>
          <a href="#/resume" className={route.name === 'resume' ? 'on' : ''}>Résumé</a>
          <a href="#/analyze" className={route.name === 'analyze' ? 'on' : ''}>Analysis</a>
          <a href="#/tracker" className={route.name === 'tracker' ? 'on' : ''}>Tracker</a>
          <a href="#/gaps" className={route.name === 'gaps' ? 'on' : ''}>Gaps</a>
          <a href="#/profile" className={route.name === 'profile' ? 'on' : ''}>Profile</a>
        </nav>
        <div className="region" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Aim />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="lbl">Your data lives in</span>
            <span className="mono" style={{ color: "var(--nav-fg-dim)" }}>India · ap-south-1</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {route.name === 'jobs' && <Jobs />}
        {route.name === 'kit' && <Kit jobId={route.jobId} />}
        {route.name === 'resume' && <Resume />}
        {route.name === 'analyze' && <Analyze />}
        {route.name === 'tracker' && <Tracker appId={route.appId} />}
        {route.name === 'gaps' && <Gaps />}
        {route.name === 'profile' && <Profile />}
        {route.name === 'parse' && <ParseReview />}
      </main>
    </div>
  );
}

/**
 * Loading, failed and empty are three different states, and the UI says which.
 *
 * A spinner that never resolves and an empty list look identical to a user,
 * which is how "the API is down" gets read as "there are no jobs".
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null; error: string | null; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e: Error) => { if (live) { setError(e.message); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: () => setNonce((n) => n + 1) };
}

export function State({ loading, error, empty, rows = 4, children }: {
  loading: boolean; error: string | null; empty?: boolean;
  /** How many placeholder rows to stand in for what is coming. */
  rows?: number;
  children: React.ReactNode;
}): React.ReactElement {
  if (loading) {
    // Shaped like the rows it replaces, so the layout does not jump when the
    // data lands, and so the wait tells you what is arriving.
    return (
      <div className="skeleton" aria-busy="true" aria-live="polite">
        <span className="lbl" style={{ position: 'absolute', left: -9999 }}>Loading</span>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i}>
            <span className="ln w2" />
            <span className="ln w1" />
          </div>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="note bad">
        <span className="lbl">Could not load this</span>
        <p>{error}</p>
        <p className="sub">The API runs on :5175 — check it is up.</p>
      </div>
    );
  }
  if (empty) return <p className="empty">Nothing here yet.</p>;
  return <>{children}</>;
}
