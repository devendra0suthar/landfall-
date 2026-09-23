import { Component, useCallback, useEffect, useState } from 'react';
import { Jobs } from './screens/Jobs.js';
import { Kit } from './screens/Kit.js';
import { Resume } from './screens/Resume.js';
import { Improve } from './screens/Improve.js';
import { Analyze } from './screens/Analyze.js';
import { Tracker } from './screens/Tracker.js';
import { Profile } from './screens/Profile.js';
import { Gaps } from './screens/Gaps.js';
import { ParseReview } from './screens/ParseReview.js';
import { Aim } from './Aim.js';
import { SignIn, ReauthPrompt } from './screens/SignIn.js';
import { Welcome } from './screens/Welcome.js';
import { api, REAUTH, SIGNED_OUT } from './api.js';
import type { Me } from './api.js';

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
  | { name: 'welcome' }
  | { name: 'kit'; jobId: string }
  | { name: 'resume' }
  | { name: 'improve' }
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
  if (head === 'welcome') return { name: 'welcome' };
  if (head === 'resume') return { name: 'resume' };
  if (head === 'improve') return { name: 'improve' };
  if (head === 'analyze') return { name: 'analyze' };
  if (head === 'gaps') return { name: 'gaps' };
  if (head === 'parse') return { name: 'parse' };
  if (head === 'profile') return { name: 'profile' };
  return { name: 'jobs' };
}

export function App(): React.ReactElement {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [reauth, setReauth] = useState(false);

  // Who is asking — answered once, before anything else renders. A screen that
  // starts loading data it is not allowed to see just produces a flash of
  // content followed by a row of 401s.
  const check = useCallback(async (): Promise<void> => {
    try {
      setMe(await api<Me>('/api/auth/me'));
    } catch {
      // The API being down is not the same as being signed out, but from here
      // they look identical and both end at the same screen.
      setMe({ candidate: null });
    }
    setChecked(true);
  }, []);

  useEffect(() => { void check(); }, [check]);

  useEffect(() => {
    const out = (): void => setMe({ candidate: null });
    const again = (): void => setReauth(true);
    window.addEventListener(SIGNED_OUT, out);
    window.addEventListener(REAUTH, again);
    return () => {
      window.removeEventListener(SIGNED_OUT, out);
      window.removeEventListener(REAUTH, again);
    };
  }, []);

  useEffect(() => {
    const onHash = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function signOut(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe({ candidate: null });
  }

  // A blank frame beats a flash of the app followed by the sign-in screen.
  if (!checked) return <div className="gate" aria-busy="true" />;
  if (!me?.candidate) return <SignIn onSignedIn={(m) => { setMe(m); void check(); }} />;

  // A new account would otherwise land on the job list, where every match score
  // is blank because there is nothing to score against — which reads as broken
  // rather than empty. Only the default route is redirected, so every screen
  // stays reachable from the nav and from a link.
  const view: Route = route.name === 'jobs' && !me.candidate.hasProfile
    ? { name: 'welcome' }
    : route;

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
          <a href="#/improve" className={route.name === 'improve' ? 'on' : ''}>Improve</a>
          <a href="#/analyze" className={route.name === 'analyze' ? 'on' : ''}>Analysis</a>
          <a href="#/tracker" className={route.name === 'tracker' ? 'on' : ''}>Tracker</a>
          <a href="#/gaps" className={route.name === 'gaps' ? 'on' : ''}>Gaps</a>
          <a href="#/profile" className={route.name === 'profile' ? 'on' : ''}>Profile</a>
        </nav>
        <div className="region" style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Aim />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="lbl">Signed in as</span>
            <span className="mono" style={{ color: 'var(--nav-fg-dim)', overflowWrap: 'anywhere' }}>
              {me.candidate.email}
            </span>
            <button className="btn linkish navlink" onClick={() => void signOut()}>Sign out</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="lbl">Your data lives in</span>
            <span className="mono" style={{ color: "var(--nav-fg-dim)" }}>India · ap-south-1</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <Boundary key={view.name}>
        {view.name === 'welcome' && <Welcome email={me.candidate.email} />}
        {view.name === 'jobs' && <Jobs />}
        {view.name === 'kit' && <Kit jobId={view.jobId} />}
        {view.name === 'resume' && <Resume />}
        {view.name === 'improve' && <Improve />}
        {view.name === 'analyze' && <Analyze />}
        {view.name === 'tracker' && <Tracker appId={view.appId} />}
        {view.name === 'gaps' && <Gaps />}
        {view.name === 'profile' && <Profile />}
        {view.name === 'parse' && <ParseReview />}
        </Boundary>
      </main>
      {reauth && (
        <ReauthPrompt onDone={() => { setReauth(false); void check(); }} onCancel={() => setReauth(false)} />
      )}
    </div>
  );
}

/**
 * One screen crashing must not take the shell with it.
 *
 * Without this a single render error unmounts everything and leaves a white
 * page with the explanation only in the console — indistinguishable, to the
 * person looking at it, from the app having failed to load at all. Keyed on
 * the route so navigating away clears the error rather than sticking.
 */
class Boundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="note bad">
        <span className="lbl">This screen stopped working</span>
        <p>The rest of the app is fine — try another screen, or reload this one.</p>
        <p className="sub mono">{this.state.error.message}</p>
      </div>
    );
  }
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
