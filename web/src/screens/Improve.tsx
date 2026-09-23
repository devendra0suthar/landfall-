import { useState } from 'react';
import { State, useAsync } from '../App.js';
import { api } from '../api.js';
import type { BulletsResponse, BulletRole, EditableBullet, Discarded, SuggestResponse, Suggestion } from '../api.js';

/**
 * AI rewording — proposals on the candidate's own lines, one decision each.
 *
 * The competitor this answers to rewrites bullets to insert the keywords a
 * posting asks for. That is the feature people mean when they ask for an "AI
 * résumé", and it is also the thing CLAUDE.md rule 1 forbids, so this screen is
 * built around the difference rather than apologising for it:
 *
 *   - every proposal sits **next to** the line it would replace, so the change
 *     is visible rather than discovered later in an interview;
 *   - nothing is applied in bulk. There is no "accept all", deliberately —
 *     a single button that rewrites a career is how someone ends up unable to
 *     answer a question about their own CV;
 *   - proposals that tried to add a number, a tool or a promotion are shown as
 *     a count, with the detail one click away. Reporting what the model tried
 *     to slip in is more honest than quietly dropping it, and it is the only
 *     place a drift in model behaviour would ever surface.
 */

export function Improve(): React.ReactElement {
  const bullets = useAsync(() => api<BulletsResponse>('/api/suggest/bullets'), []);
  const [result, setResult] = useState<SuggestResponse | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function suggest(role: BulletRole): Promise<void> {
    setWorking(role.id);
    setErr(null);
    try {
      const res = await api<SuggestResponse>('/api/suggest', {
        method: 'POST',
        body: JSON.stringify({ roleId: role.id }),
      });
      setResult(res);
      setDismissed(new Set());
    } catch (e) {
      setErr((e as Error).message);
    }
    setWorking(null);
  }

  async function accept(s: Suggestion): Promise<void> {
    setWorking(s.bulletId);
    setErr(null);
    try {
      await api(`/api/bullets/${encodeURIComponent(s.bulletId)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ text: s.proposal }),
      });
      setDismissed((d) => new Set(d).add(s.bulletId));
      bullets.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setWorking(null);
  }

  async function revert(b: EditableBullet): Promise<void> {
    setWorking(b.id);
    setErr(null);
    try {
      await api(`/api/bullets/${encodeURIComponent(b.id)}/revert`, { method: 'POST' });
      bullets.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
    setWorking(null);
  }

  const roles = bullets.data?.roles ?? [];
  const available = bullets.data?.available ?? false;
  const live = (result?.suggestions ?? []).filter((s) => !dismissed.has(s.bulletId));
  const byBullet = new Map(live.map((s) => [s.bulletId, s]));

  return (
    <div className="body">
      <div className="head">
        <div>
          <span className="lbl">Résumé</span>
          <h1>Improve the wording</h1>
        </div>
      </div>

      <div className="card flow">
        <p>
          Claude proposes a rewording of each line you wrote. It may cut filler, sharpen a
          verb or lead with the outcome. It may not add a number, a tool, a company or a
          claim of having led something — anything that does is thrown away before it
          reaches this screen, and counted below.
        </p>
        <p className="sub">
          Nothing changes until you accept it, one line at a time. Accepting makes the line
          yours: it is what goes on the CV, and you can put it back afterwards.
        </p>
      </div>

      {!available && !bullets.loading && (
        <div className="note warn">
          <span className="lbl">Suggestions are switched off</span>
          <p>
            This server has no model credentials, so nothing can be proposed. Set
            <span className="mono"> ANTHROPIC_API_KEY</span> on the API process to turn it on.
          </p>
          <p className="sub">
            Everything else in Landfall works without it — the fill plan, tailoring, the
            Kit and the letter are all deterministic and never call a model.
          </p>
        </div>
      )}

      {err && (
        <div className="note bad">
          <span className="lbl">That did not work</span>
          <p>{err}</p>
        </div>
      )}

      {result && result.discarded.length > 0 && <Refused discarded={result.discarded} />}

      <State loading={bullets.loading} error={bullets.error} empty={roles.length === 0} rows={5}>
        {roles.map((role) => (
          <div className="card flow" key={role.id}>
            <div className="row split">
              <div>
                <strong>{role.title}</strong>
                <span className="sub"> · {role.company}</span>
                <div className="sub mono">{role.start} – {role.end ?? 'Present'}</div>
              </div>
              <button
                className="btn p"
                disabled={!available || working !== null || role.bullets.length === 0}
                onClick={() => void suggest(role)}
              >
                {working === role.id ? 'Reading…' : 'Suggest rewordings'}
              </button>
            </div>

            <div className="rows">
              {role.bullets.map((b) => (
                <Line
                  key={b.id}
                  bullet={b}
                  suggestion={byBullet.get(b.id) ?? null}
                  busy={working === b.id}
                  onAccept={() => { const s = byBullet.get(b.id); if (s) void accept(s); }}
                  onDismiss={() => setDismissed((d) => new Set(d).add(b.id))}
                  onRevert={() => void revert(b)}
                />
              ))}
            </div>
          </div>
        ))}
      </State>
    </div>
  );
}

/** One bullet, and the decision attached to it if there is one. */
function Line({ bullet, suggestion, busy, onAccept, onDismiss, onRevert }: {
  bullet: EditableBullet;
  suggestion: Suggestion | null;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onRevert: () => void;
}): React.ReactElement {
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--rule)' }}>
      {/* The line as it stands. Struck through only while a replacement for it
          is on screen, so the comparison is unmistakable. */}
      <div className={suggestion ? 'bullet drop' : 'bullet'}>{bullet.text}</div>

      {suggestion && (
        <div style={{ marginTop: 8 }}>
          <div className="bullet">{suggestion.proposal}</div>
          <p className="sub" style={{ marginTop: 4 }}>{suggestion.rationale}</p>
          <div className="row split" style={{ marginTop: 8 }}>
            <span className="sub">Replace the line above with this one?</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="btn" disabled={busy} onClick={onDismiss}>Keep mine</button>
              <button className="btn p" disabled={busy} onClick={onAccept}>
                {busy ? 'Saving…' : 'Use this'}
              </button>
            </span>
          </div>
        </div>
      )}

      {!suggestion && bullet.originalText !== null && (
        <div className="row split" style={{ marginTop: 6 }}>
          <span className="sub">
            <span className="chip">reworded</span>{' '}
            You wrote: “{bullet.originalText}”
          </span>
          <button className="btn" disabled={busy} onClick={onRevert}>
            {busy ? 'Reverting…' : 'Put mine back'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What the verifier refused, and why.
 *
 * This panel is the product's argument, not an error log: it is the evidence
 * that the feature does not do the thing its competitors do. Kept collapsed
 * because the detail is only interesting to someone who wants to check.
 */
function Refused({ discarded }: { discarded: Discarded[] }): React.ReactElement {
  const reason: Record<string, string> = {
    'new-number': 'invented a number',
    'new-technology': 'added a technology you did not mention',
    'new-entity': 'added a name you did not mention',
    'escalation': 'claimed more credit than your line does',
    'dropped-number': 'dropped a number you had earned',
    'dropped-technology': 'dropped a technology you had named',
    'inflated': 'padded the line out',
    'empty': 'came back blank',
    'unchanged': 'was unchanged',
  };

  return (
    <div className="note">
      <span className="lbl">
        {discarded.length} {discarded.length === 1 ? 'proposal was' : 'proposals were'} thrown away
      </span>
      <p>
        These tried to say something your line does not. You are not being shown them as
        options, because a warning next to an accept button is a warning that gets clicked
        past.
      </p>
      <details>
        <summary className="sub">Show what they tried to add</summary>
        <div className="rows" style={{ marginTop: 8 }}>
          {discarded.map((d) => (
            <div key={d.bulletId + d.proposal} style={{ padding: '8px 0' }}>
              <div className="bullet drop">{d.proposal}</div>
              <p className="sub" style={{ marginTop: 4 }}>
                {[...new Set(d.objections.map((o) => reason[o.kind] ?? o.kind))].join('; ')}
                {' — '}
                <span className="mono">
                  {d.objections.map((o) => o.detail).filter(Boolean).join(', ')}
                </span>
              </p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
