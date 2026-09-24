import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import type { AskFilters, AskReply } from '../api.js';

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

  async function send(body: { text?: string; filters?: AskFilters | null }, shown: Turn): Promise<void> {
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

  // Arriving from the search bar on Jobs (#/ask/<text>) asks straight away.
  useEffect(() => {
    if (initial && !started.current) { started.current = true; ask(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <>
      <div className="head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="lbl">Ask Landfall</span>
          <h1>Tell me what you’re looking for</h1>
          <p className="sub">In your own words. Every job shown is a real, open posting.</p>
        </div>
        {turns.length > 0 && (
          <button className="btn" onClick={() => setTurns([])}>New conversation</button>
        )}
      </div>

      <div className="body chat">
        {turns.length === 0 && (
          <div className="chat-empty">
            <p className="sub">Try one of these, or type your own:</p>
            <div className="chat-examples">
              {EXAMPLES.map((e) => <button key={e} className="btn" onClick={() => ask(e)}>{e}</button>)}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          t.me ? <div key={i} className="msg me">{t.me}</div>
            : t.did ? <div key={i} className="msg did">{t.did}</div>
              : t.error ? <div key={i} className="msg bot" role="alert"><p>Something went wrong: {t.error}</p></div>
                : t.reply ? (
                  <Answer
                    key={i}
                    r={t.reply}
                    live={t.reply === last}
                    onRemove={(key, label) => void send({ filters: withoutPart(t.reply!.filters, key) }, { did: `Removed “${label}”` })}
                  />
                ) : null
        ))}
        {busy && <div className="msg bot" aria-live="polite"><p className="sub">Looking…</p></div>}
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

function sentence(r: AskReply): string {
  if (r.unchanged) return 'I didn’t catch anything new in that — here’s the same search.';
  if (r.chips.length === 0) return `Here are the best of ${r.total.toLocaleString()} open roles.`;
  if (r.total === 0) return 'Nothing open matches all of that.';
  const n = `${r.total.toLocaleString()} open role${r.total === 1 ? '' : 's'} match${r.total === 1 ? 'es' : ''}`;
  return r.titleMatch === 'words' ? `${n} — no title has those exact words together, so these have all of them.` : `${n}.`;
}

function Answer({ r, live, onRemove }: {
  r: AskReply; live: boolean; onRemove: (key: string, label: string) => void;
}): React.ReactElement {
  return (
    <div className="msg bot">
      <p>{r.reset ? 'Starting fresh. ' : ''}{sentence(r)}</p>

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

      {r.loosen && live && (
        <button className="btn" onClick={() => onRemove(r.loosen!.key, r.loosen!.label)}>
          Try without {r.loosen.label} → {r.loosen.total.toLocaleString()} role{r.loosen.total === 1 ? '' : 's'}
        </button>
      )}

      {r.items.length > 0 && (
        <div className="chat-jobs">
          {r.items.map((j) => (
            <div key={j.jobId} className="chat-job">
              <div style={{ minWidth: 0 }}>
                <strong>{j.title}</strong>
                <div className="sub">
                  {j.company}{j.location ? ` · ${j.location}` : ''}{j.match !== null ? ` · match ${j.match}` : ''}
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
