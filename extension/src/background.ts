/**
 * The service worker.
 *
 * It exists for one reason: host permissions live here, so this is the only
 * place that may talk to the Landfall API. The content script runs on the
 * employer's origin and never gets the candidate's data except as the specific
 * plan for the posting in front of it.
 */

const API = 'http://127.0.0.1:5175';

interface PlanResponse {
  formState: 'readable' | 'unknown';
  message?: string;
  actions?: Array<{
    label: string; labelKey: string; fieldName: string; required: boolean;
    source: string; value: string | null; reason: string | null;
  }>;
}

async function planFor(jobId: string): Promise<PlanResponse> {
  const res = await fetch(`${API}/api/jobs/${encodeURIComponent(jobId)}/plan`);
  if (!res.ok) throw new Error(`the API returned ${res.status}`);
  return res.json() as Promise<PlanResponse>;
}

/** The résumé bytes, so the content script can attach a real file. */
async function resume(): Promise<{ filename: string; contentType: string; base64: string } | null> {
  const res = await fetch(`${API}/api/resume`);
  if (!res.ok) return null;
  const blob = await res.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  const disposition = res.headers.get('content-disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  return {
    filename: named ?? 'resume.pdf',
    contentType: res.headers.get('content-type') ?? 'application/pdf',
    base64: btoa(bin),
  };
}

chrome.runtime.onMessage.addListener((msg: { type: string; jobId?: string }, _sender, respond) => {
  if (msg.type === 'landfall:prepare' && msg.jobId) {
    void (async () => {
      try {
        const [plan, file] = await Promise.all([planFor(msg.jobId!), resume()]);
        respond({ ok: true, plan, resume: file });
      } catch (err) {
        // Named plainly: the commonest cause is that the API is not running,
        // and "failed to fetch" sends people to the wrong place entirely.
        respond({
          ok: false,
          error: `Could not reach Landfall at ${API}. Is the API running? (${(err as Error).message})`,
        });
      }
    })();
    return true;
  }
  return undefined;
});
