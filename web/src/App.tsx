import { useEffect, useState } from 'react';
import { Jobs } from './screens/Jobs.js';
import { Prepare } from './screens/Prepare.js';
import { Tracker } from './screens/Tracker.js';
import { Profile } from './screens/Profile.js';
import { Gaps } from './screens/Gaps.js';
import { ParseReview } from './screens/ParseReview.js';

/**
 * The shell, and the router.
 *
 * Hash routing, by hand. The app has five screens and one nested route; a
 * router library would be more code to load than to write, and this keeps the
 * static build free of a dependency that only earns its place at ten screens.
 */

type Route =
  | { name: 'jobs' }
  | { name: 'prepare'; jobId: string }
  | { name: 'tracker'; appId?: string }
  | { name: 'gaps' }
  | { name: 'profile' }
  | { name: 'parse' };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, id] = path.split('/');
  if (head === 'prepare' && id) return { name: 'prepare', jobId: id };
  if (head === 'tracker') return id ? { name: 'tracker', appId: id } : { name: 'tracker' };
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
            href={route.name === 'prepare' ? `#/prepare/${route.jobId}` : '#/jobs'}
            className={route.name === 'prepare' ? 'on' : ''}
          >
            Prepare
          </a>
          <a href="#/tracker" className={route.name === 'tracker' ? 'on' : ''}>Tracker</a>
          <a href="#/gaps" className={route.name === 'gaps' ? 'on' : ''}>Gaps</a>
          <a href="#/profile" className={route.name === 'profile' ? 'on' : ''}>Profile</a>
        </nav>
        <div className="region" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="lbl">Your data lives in</span>
          <span className="mono" style={{ color: '#b8c7d4' }}>India · ap-south-1</span>
        </div>
      </aside>

      <main className="main">
        {route.name === 'jobs' && <Jobs />}
        {route.name === 'prepare' && <Prepare jobId={route.jobId} />}
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

export function State({ loading, error, empty, children }: {
  loading: boolean; error: string | null; empty?: boolean; children: React.ReactNode;
}): React.ReactElement {
  if (loading) return <p className="empty">Loading…</p>;
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
