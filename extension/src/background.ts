/**
 * The service worker.
 *
 * It exists for one reason: host permissions live here, so this is the only
 * place that may talk to the Landfall API. The content script runs on the
 * employer's origin and never gets the candidate's data except as the specific
 * plan for the posting in front of it.
 */

/**
 * Where Landfall lives, and who we are to it.
 *
 * Both were hardcoded: the API at 127.0.0.1:5175, and no credential at all.
 * That worked for exactly as long as the product had no accounts and ran only
 * on the machine it was built on. It now has both, so both are configuration:
 * the popup stores them, and nothing here assumes a developer's laptop.
 *
 * The credential is a bearer token rather than the session cookie. An
 * extension fetches from its own origin, so the cookie is cross-site and
 *  correctly refuses to send it — the fix is to carry a token
 * that was granted deliberately, not to weaken the cookie for every user.
 */
const DEFAULT_API = 'http://127.0.0.1:5175';

interface Settings { api: string; token: string | null }

async function settings(): Promise<Settings> {
  const got = await chrome.storage.local.get(['api', 'token']);
  return {
    api: (typeof got.api === 'string' && got.api.trim())
      ? got.api.trim().replace(/\/+$/, '')
      : DEFAULT_API,
    token: typeof got.token === 'string' && got.token ? got.token : null,
  };
}

/** Every call to Landfall goes through here, so the token cannot be forgotten. */
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const { api, token } = await settings();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${api}${path}`, { ...init, headers });
  if (res.status === 401) {
    // Said once, here, so three call sites do not each invent their own
    // wording for the one failure a candidate can actually fix.
    throw new Error('NOT_CONNECTED');
  }
  return res;
}

interface PlanResponse {
  formState: 'readable' | 'unknown';
  message?: string;
  actions?: Array<{
    label: string; labelKey: string; fieldName: string; required: boolean;
    source: string; value: string | null; reason: string | null;
  }>;
}

interface ResolveResponse {
  jobId: string;
  title: string;
  company: string;
  formState: 'readable' | 'not-published' | 'unknown';
}

/**
 * Which posting is the candidate looking at?
 *
 * The tab's URL answers it, so nobody has to carry an id between windows.
 */
async function resolveUrl(url: string): Promise<ResolveResponse> {
  const res = await call(`/api/jobs/resolve?url=${encodeURIComponent(url)}`);
  const body = await res.json() as ResolveResponse & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `the API returned ${res.status}`);
  return body;
}

async function planFor(jobId: string): Promise<PlanResponse> {
  const res = await call(`/api/jobs/${encodeURIComponent(jobId)}/plan`);
  if (!res.ok) throw new Error(`the API returned ${res.status}`);
  return res.json() as Promise<PlanResponse>;
}

/** The résumé bytes, so the content script can attach a real file. */
async function resume(): Promise<{ filename: string; contentType: string; base64: string } | null> {
  const res = await call(`/api/resume`);
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

chrome.runtime.onMessage.addListener((msg: { type: string; url?: string }, _sender, respond) => {
  if (msg.type === 'landfall:prepare' && msg.url) {
    void (async () => {
      try {
        const posting = await resolveUrl(msg.url!);
        const [plan, file] = await Promise.all([planFor(posting.jobId), resume()]);
        respond({ ok: true, posting, plan, resume: file });
      } catch (err) {
        // Three different failures used to arrive as one "failed to fetch",
        // which sends people to the wrong place. They are told apart here
        // because each has a different fix.
        const { api } = await settings();
        const message = (err as Error).message;
        respond({
          ok: false,
          error: message === 'NOT_CONNECTED'
            ? `Not connected to your Landfall account. Open ${api}, go to Résumé → `
              + 'Connect the extension, and paste the token into this popup.'
            : `Could not reach Landfall at ${api}. Is it running, and is the address `
              + `right in this popup? (${message})`,
          needsToken: message === 'NOT_CONNECTED',
        });
      }
    })();
    return true;
  }
  return undefined;
});
