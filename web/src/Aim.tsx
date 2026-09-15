import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * What you are aiming as, and the switch for it.
 *
 * Lives in the sidebar because it colours everything on every screen: match
 * scores, the tailored résumé's ordering, the letter starter's overlap. A
 * control that changes every number on the page belongs where the page's
 * identity is, not buried in settings.
 *
 * It names what a variant does not touch, every time. The whole reason this is
 * an override rather than a second profile is that contact details and work
 * history have one home each — and a candidate should be able to switch aim
 * without wondering whether their phone number just changed with it.
 */

interface VariantList {
  base: { currentTitle: string | null; skills: string[] };
  active: string | null;
  variants: Array<{ id: string; name: string; currentTitle: string | null; skills: string[]; active: boolean }>;
}

export function Aim(): React.ReactElement | null {
  const [data, setData] = useState<VariantList | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<VariantList>('/api/variants')
      .then((d) => { if (live) setData(d); })
      .catch(() => { /* the sidebar is not the place to report an outage */ });
    return () => { live = false; };
  }, []);

  async function select(name: string | null): Promise<void> {
    setBusy(true);
    try {
      await api('/api/variants/select', { method: 'POST', body: JSON.stringify({ name }) });
      const next = await api<VariantList>('/api/variants');
      setData(next);
      // Every score on the page was computed against the old aim. Reloading is
      // the honest option: silently leaving stale numbers on screen after the
      // candidate deliberately changed what they are aiming at is worse than a
      // flicker.
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  if (!data || data.variants.length === 0) return null;

  const active = data.variants.find((v) => v.active) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="lbl">Aiming as</span>
      <select
        value={active?.name ?? ''}
        disabled={busy}
        onChange={(e) => void select(e.target.value === '' ? null : e.target.value)}
        style={{
          fontFamily: 'inherit', fontSize: '0.85rem', padding: '5px 7px',
          border: '1px solid #35485a', borderRadius: 4,
          background: '#17242f', color: '#e8eef4',
        }}
      >
        <option value="">Your profile, as written</option>
        {data.variants.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
      </select>
      <span className="mono" style={{ fontSize: 10, color: '#63788c', lineHeight: 1.5 }}>
        {active
          ? `${active.skills.length} skills claimed · your name, contact details and work history are unchanged`
          : `${data.base.skills.length} skills from your profile`}
      </span>
    </div>
  );
}
