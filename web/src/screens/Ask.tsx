import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import type { AskFilters, AskReply, SavedSearch } from '../api.js';

/**
 * Ask Landfall — job search as a conversation.
 *
 * There was no search before this: nothing anyone typed was read. Now you say
 * what you want in your own words, the jobs arrive in the reply, and the next
 * message narrows it ("only this week", "at databricks") or starts again.
 *
 * Three things make it trustworthy rather than merely chatty:
 *  - every job shown comes from the index, ranked by the same score as Jobs;
 *  - how each message was read is shown as chips, and × removes a part;
 *  - an empty answer names the one part in the way, as a button.
 *
 * The conversation lives in this tab (sessionStorage), so a reload keeps it
 * and nothing about it is stored on the server.
 */

interface Turn {
  me?: string;
  reply?: AskReply;
  /** A chip removed or a suggestion taken, shown as a quiet system line. */
  did?: string;
  error?: string;
}

const KEY = 'landfall:ask';
const EXAMPLES = [
  'remote data engineer jobs in Bangalore',
  'senior roles at Databricks posted this week',
  'python backend engineer in London',
  'product manager, hybrid, India',
];

function load(): Turn[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as Turn[]; } catch { return []; }
}
function save(turns: Turn[]): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30))); } catch { /* private mode: fine */ }
}

/** Same rule as the server's withoutPart — removing a chip is a turn with no text. */
function withoutPart(f: AskFilters, key: string): AskFilters {
  if (key.startsWith('skill:')) return { ...f, skills: f.skills.filter((s) => `skill:${s}` !== key) };
  return { ...f, ...(key === 'words' ? { words: [] } : { [key]: null }) } as AskFilters;
}

export function Ask({ initial }: { initial?: string }): React.ReactElement {
  const [turns, setTurns] = useState<Turn[]>(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const last = [...turns].reverse().find((t) => t.reply)?.reply ?? null;

  useEffect(() => { save(turns); end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns]);

  async function send(body: { text?: string; filters?: AskFilters | null; newSince?: string }, shown: Turn): Promise<void> {
    setBusy(true);
    setTurns((t) => [...t, shown]);
    try {
      const reply = await api<AskReply>('/api/ask', { method: 'POST', body: JSON.stringify(body) });
      setTurns((t) => [...t, { reply }]);
    } catch (e) {
      setTurns((t) => [...t, { error: (e as Error).message }]);
    }
    setBusy(false);
  }

  function ask(q: string): void {
    const clean = q.trim();
    if (!clean || busy) return;
    setText('');
    void send({ text: clean, filters: last?.filters ?? null }, { me: clean });
  }

  /**
   * Opening a saved search (#/ask/@<id>, from Apply): its filters are the turn,
   * the jobs that arrived since it was last opened come first and are marked,
   * and it is marked seen so the count on Apply goes back to zero.
   */
  async function openSaved(id: string): Promise<void> {
    try {
      const list = await api<{ rows: SavedSearch[] }>('/api/searches');
      const saved = list.rows.find((r) => r.id === id);
      if (!saved) { setTurns((t) => [...t, { error: 'that saved search no longer exists' }]); return; }
      await send(
        { filters: saved.filters, newSince: saved.lastSeenAt },
        { did: saved.newCount > 0 ? `Opened “${saved.label}” — ${saved.newCount} new since you last looked` : `Opened “${saved.label}”` },
      );
      await api(`/api/searches/${encodeURIComponent(id)}/seen`, { method: 'POST' });
    } catch (e) {
      setTurns((t) => [...t, { error: (e as Error).message }]);
    }
  }

  // Arriving from the search bar on Jobs (#/ask/<text>) asks straight away;
  // #/ask/@<id> opens a saved search instead.
  useEffect(() => {
    if (initial && !started.current) {
      started.current = true;
      if (initial.startsWith('@')) void openSaved(initial.slice(1));
      else ask(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Ask Landfall</span>
          <h1>What kind of job are you looking for?</h1>
          <p className="sub">Just say it the way you would to a friend. I only ever show real, open jobs.</p>
        </div>
        {turns.length > 0 && (
          <button className="btn" onClick={() => setTurns([])}>New conversation</button>
        )}
      </div>

      <div className="body chat">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p className="sub">Not sure how to put it? Tap one of these to start:</p>
            <div className="chat-examples">
              {EXAMPLES.map((e) => <button key={e} className="btn" onClick={() => ask(e)}>{e}</button>)}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          t.me ? <div key={i} className="msg me">{t.me}</div>
            : t.did ? <div key={i} className="msg did">{t.did}</div>
              : t.error ? <div key={i} className="msg bot" role="alert"><p>Sorry — I couldn’t search just now ({t.error}). Please try again.</p></div>
                : t.reply ? (
                  <Answer
                    key={i}
                    r={t.reply}
                    live={t.reply === last}
                    first={turns.findIndex((x) => x.reply) === i}
                    onRemove={(key, label) => void send({ filters: withoutPart(t.reply!.filters, key) }, { did: `Removed “${label}”` })}
                  />
                ) : null
        ))}
        {busy && <div className="msg bot" aria-live="polite"><p className="sub">Searching open jobs…</p></div>}
        <div ref={end} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={last ? 'Narrow it down — “only this week”, “at Stripe”… or ask something new' : 'e.g. remote data engineer jobs in Bangalore'}
          aria-label="Ask for jobs"
          maxLength={300}
          autoFocus
        />
        <button className="btn p" disabled={busy || !text.trim()}>Ask</button>
      </form>
    </>
  );
}

/**
 * The request said back in plain English: "senior remote software engineer
 * roles in Bengaluru at Stripe, posted in the last 7 days".
 *
 * The reply used to be "53 open roles match." — correct and cold. Repeating
 * what was asked is what makes it read as understood, and it is the check a
 * person needs: if the sentence is wrong, the search is wrong.
 */
function describe(f: AskFilters, n: number): string {
  const LEVEL: Record<string, string> = {
    intern: 'intern', junior: 'junior', mid: 'mid-level', senior: 'senior', staff: 'staff', manager: 'manager',
  };
  const adjectives = [
    f.level ? LEVEL[f.level] : null,
    f.workplace ? (f.workplace === 'onsite' ? 'on-site' : f.workplace) : null,
  ].filter(Boolean).join(' ');
  const noun = n === 1 ? 'role' : 'roles';
  const role = f.words.length ? `${f.words.join(' ')} ${noun}` : noun;
  const skills = f.skills.length ? ` using ${f.skills.join(' and ')}` : '';
  const place = f.place ? ` in ${f.place.label}` : '';
  const company = f.company ? ` at ${f.company.replace(/,?\s*Inc\.?$|\s*Job Board$/, '')}` : '';
  const when = f.days ? (f.days === 1 ? ', posted today' : `, posted in the last ${f.days} days`) : '';
  return `${adjectives ? `${adjectives} ` : ''}${role}${skills}${place}${company}${when}`;
}

function Reply({ r, first, live }: { r: AskReply; first: boolean; live: boolean }): React.ReactElement {
  const fresh = r.reset ? 'New search. ' : '';

  if (r.unchanged) {
    return (
      <p>
        I didn’t pick out anything new there, so this is the same search again. Try a role, a
        city, “remote”, or “this week”.
      </p>
    );
  }

  if (r.chips.length === 0) {
    return <p>{fresh}Here are the best of the <strong>{r.total.toLocaleString()}</strong> open roles for you.</p>;
  }

  if (r.total === 0) {
    return (
      <p>
        {fresh}I couldn’t find any <strong>{describe(r.filters, 0)}</strong> open right now.{' '}
        {r.loosen ? (live ? 'One change would help:' : '') : 'Try fewer details, or start a new search.'}
      </p>
    );
  }

  const top = r.items[0]?.match ?? null;
  const shown = r.items.length;
  const fresh_ = r.items.filter((i) => i.isNew).length;
  // Opened from a saved search: the new ones lead, so "the top one fits you
  // best" would be untrue — say what the order actually is.
  if (fresh_ > 0) {
    return (
      <p>
        I found <strong>{r.total.toLocaleString()} {describe(r.filters, r.total)}</strong>.{' '}
        <strong>{fresh_} {fresh_ === 1 ? 'is' : 'are'} new</strong> since you last looked — shown first,
        then your best fits.
      </p>
    );
  }
  return (
    <>
      <p>
        {fresh}I found <strong>{r.total.toLocaleString()} {describe(r.filters, r.total)}</strong>.
        {r.total > shown
          ? ` Here are the ${shown} that fit you best${top !== null ? ` — the top one is a ${top}/100 match` : ''}.`
          : top !== null && r.total > 1 ? ` Best fit first — the top one is a ${top}/100 match.` : ''}
      </p>
      {r.titleMatch === 'words' && (
        <p className="sub">
          None have exactly “{r.filters.words.join(' ')}” in the title, so these have all of those words.
        </p>
      )}
      {first && (
        <p className="sub">You can narrow it down — try “only this week”, “hybrid” or “at Stripe”.</p>
      )}
    </>
  );
}

function Answer({ r, live, first, onRemove }: {
  r: AskReply; live: boolean; first: boolean; onRemove: (key: string, label: string) => void;
}): React.ReactElement {
  return (
    <div className="msg bot">
      <Reply r={r} first={first} live={live} />

      {r.chips.length > 0 && (
        <div className="chat-chips" aria-label="How I read that">
          {r.chips.map((c) => (
            <span key={c.key} className="chip x">
              {c.label}
              {live && (
                <button aria-label={`Remove ${c.label}`} onClick={() => onRemove(c.key, c.label)}>×</button>
              )}
            </span>
          ))}
          {r.eligibilityApplied && <span className="chip">only roles you can take</span>}
        </div>
      )}

      {r.notes.map((n) => <p key={n} className="sub">{n}</p>)}

      {live && r.chips.length > 0 && <SaveSearch filters={r.filters} />}

      {r.loosen && live && (
        <button className="btn" onClick={() => onRemove(r.loosen!.key, r.loosen!.label)}>
          Drop {r.loosen.label} → {r.loosen.total.toLocaleString()} role{r.loosen.total === 1 ? '' : 's'}
        </button>
      )}

      {r.items.length > 0 && (
        <div className="chat-jobs">
          {r.items.map((j) => (
            <div key={j.jobId} className="chat-job">
              <div style={{ minWidth: 0 }}>
                <strong>{j.isNew && <span className="chip ok new-badge">New</span>}{j.title}</strong>
                <div className="sub">
                  {j.company}{j.location ? ` · ${j.location}` : ''}{j.match !== null ? ` · ${j.match}/100 match` : ''}
                </div>
              </div>
              <div className="chat-job-actions">
                {j.formReadable && <a className="btn p" href={`#/kit/${j.jobId}`}>Prepare</a>}
                <a className="btn" href={j.url} target="_blank" rel="noreferrer">Posting ↗</a>
              </div>
            </div>
          ))}
          {r.total > r.items.length && (
            <p className="sub">Showing the best {r.items.length} of {r.total.toLocaleString()}. Narrow it down to see others.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Keep this search, and hear about what arrives. The index refreshes daily; a
 * saved search shows on Apply with the number of new matches since it was
 * last opened. Saved the way the chat said it back, so the list reads.
 */
function SaveSearch({ filters }: { filters: AskFilters }): React.ReactElement {
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'already'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    setState('busy');
    setErr(null);
    try {
      const r = await api<{ already: boolean }>('/api/searches', {
        method: 'POST',
        body: JSON.stringify({ label: describe(filters, 2), filters }),
      });
      setState(r.already ? 'already' : 'saved');
    } catch (e) {
      setErr((e as Error).message);
      setState('idle');
    }
  }

  if (state === 'saved' || state === 'already') {
    return (
      <p className="sub">
        {state === 'saved' ? 'Saved.' : 'You already saved this one.'} New matches will show on{' '}
        <a href="#/run">Apply</a> as they arrive.
      </p>
    );
  }
  return (
    <p>
      <button className="btn" disabled={state === 'busy'} onClick={() => void save()}>
        Save this search — tell me when new ones arrive
      </button>
      {err && <span className="sub" role="alert"> {err}</span>}
    </p>
  );
}
