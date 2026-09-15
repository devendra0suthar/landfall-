import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Polite HTTP client for public ATS endpoints.
 *
 * Three properties that matter for this workload:
 *  - a global concurrency gate, so a 500-board harvest doesn't open 500 sockets
 *  - a minimum interval between requests to the same host (Greenhouse publishes
 *    no rate limit, so we invent a conservative one rather than find theirs)
 *  - a disk cache, because re-running the analysis shouldn't re-hit anyone's API
 */

import { CACHE_DIR } from './paths.js';

export interface FetchOptions {
  /** Skip the cache and force a live request. */
  fresh?: boolean;
  /** POST body — Workday's CXS endpoints need this; Greenhouse doesn't. */
  body?: unknown;
  timeoutMs?: number;
  /**
   * Return the body as text instead of parsing it as JSON.
   *
   * For endpoints that are known not to serve JSON — an apply SPA, a bot-wall
   * challenge page. Without this, `res.json()` throws, the throw is treated as
   * a transport failure, and the request is retried three times with backoff:
   * a page we already know isn't JSON gets hit three times per run, which is
   * the opposite of the politeness this client exists to enforce.
   */
  raw?: boolean;
  /**
   * Accept header, default `application/json`.
   *
   * Some vendors content-negotiate the same URL: SmartRecruiters' apply page
   * serves the job ad as JSON to this client and the SPA to a browser, and
   * the two answer the schema question differently. Asking for the other
   * representation is negotiation, not impersonation — the User-Agent stays
   * honest, so a bot wall still recognises us and is still obeyed.
   */
  accept?: string;
}

export interface FetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  fromCache: boolean;
  error?: string;
}

class Gate {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const gate = new Gate(4);
const lastHitByHost = new Map<string, number>();
/**
 * Who to contact about this traffic.
 *
 * A real address here is the difference between a polite crawler and an
 * anonymous one, and anonymous high-volume traffic is exactly what gets an IP
 * range blocked. It is read from the environment rather than hardcoded so the
 * address belongs to whoever is actually running it — the previous value was
 * one person's personal email, which a public repo would have published and a
 * deployment would have attributed every stranger's request to.
 *
 * Unset is honest too: it says there is no contact, rather than naming someone
 * who is not responsible.
 */
const CONTACT = (process.env.LANDFALL_CONTACT ?? '').trim();
const USER_AGENT = CONTACT
  ? `landfall/0.1 (+contact: ${CONTACT})`
  : 'landfall/0.1 (+contact: unset — set LANDFALL_CONTACT)';

const MIN_INTERVAL_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Everything that changes the RESPONSE is part of the key, not just the URL.
 *
 * `raw` and `accept` both do. The same URL fetched as text and as JSON
 * produces two different cached shapes — a string and an object — and without
 * this the second caller silently gets the first caller's shape.
 * SmartRecruiters' apply URL content-negotiates and is fetched both ways in
 * one run, so this collided the first time it was exercised.
 */
function cachePath(url: string, opts: FetchOptions = {}): string {
  const key = createHash('sha256')
    .update(
      url
      + (opts.body ? JSON.stringify(opts.body) : '')
      + (opts.raw ? '#raw' : '')
      + (opts.accept ? `#accept=${opts.accept}` : ''),
    )
    .digest('hex');
  // Shard by first two chars so no single directory holds 100k files.
  return join(CACHE_DIR, key.slice(0, 2), `${key}.json`);
}

async function readCache<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function writeCache(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data), 'utf8');
}

async function throttle(host: string): Promise<void> {
  const last = lastHitByHost.get(host) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastHitByHost.set(host, Date.now());
}

/**
 * Fetch JSON with cache, throttle and bounded retry.
 * Retries only on 429 / 5xx / network error, with exponential backoff and
 * respect for Retry-After. A 404 is an answer, not a failure to retry.
 */
export async function fetchJson<T>(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult<T>> {
  const path = cachePath(url, opts);

  if (!opts.fresh) {
    const hit = await readCache<FetchResult<T>>(path);
    if (hit) return { ...hit, fromCache: true };
  }

  const host = new URL(url).host;
  const maxAttempts = 3;
  let lastError = '';
  let lastStatus = 0;

  await gate.acquire();
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await throttle(host);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25_000);

      try {
        const res = await fetch(url, {
          method: opts.body ? 'POST' : 'GET',
          headers: {
            accept: opts.accept ?? 'application/json',
            'user-agent': USER_AGENT,
            ...(opts.body ? { 'content-type': 'application/json' } : {}),
          },
          ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
          signal: controller.signal,
        });
        clearTimeout(timer);
        lastStatus = res.status;

        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 800 * 2 ** (attempt - 1);
          lastError = `HTTP ${res.status}`;
          if (attempt < maxAttempts) {
            await sleep(backoff);
            continue;
          }
          break;
        }

        if (!res.ok) {
          const result: FetchResult<T> = {
            ok: false, status: res.status, data: null, fromCache: false,
            error: `HTTP ${res.status}`,
          };
          await writeCache(path, result); // negative caching: 404s are stable
          return result;
        }

        const data = (opts.raw ? await res.text() : await res.json()) as T;
        const result: FetchResult<T> = { ok: true, status: res.status, data, fromCache: false };
        await writeCache(path, result);
        return result;
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) await sleep(800 * 2 ** (attempt - 1));
      }
    }
  } finally {
    gate.release();
  }

  return { ok: false, status: lastStatus, data: null, fromCache: false, error: lastError };
}

/** Run tasks with bounded concurrency, reporting progress. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let done = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
      done++;
      onProgress?.(done, items.length);
    }
  });

  await Promise.all(workers);
  return results;
}
