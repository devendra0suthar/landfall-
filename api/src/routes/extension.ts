import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from '../lib/zip.js';

/**
 * GET /api/extension/download — the autofill extension, ready to install.
 *
 * The extension is the whole of Landfall's "fill the form for me", and until
 * this existed a real user had no way to get it: it is not in the Chrome Web
 * Store and the site offered no download, so the feature lived only on a
 * developer's laptop.
 *
 * Built per request from extension/dist with THIS site's address baked in —
 * as the default the extension talks to, and as a granted host permission —
 * so installing it needs no typed address and no permission prompt; the
 * candidate only pastes their connection code. The developer-only localhost
 * permissions are dropped from the manifest a user installs.
 *
 * Public: it contains no candidate data — the same bytes for everyone on a
 * given site. The connection code, which is personal, is minted separately
 * and behind fresh auth (POST /api/auth/extension).
 */

const DIST = resolve(process.env.EXTENSION_DIST
  ?? join(dirname(fileURLToPath(import.meta.url)), '../../../extension/dist'));

/** What the extension was built to talk to; replaced with the real origin. */
const BUILT_DEFAULT = 'http://127.0.0.1:5175';

/**
 * The origin to bake in, or null if it is not one we should hand out.
 * https anywhere; http only for a machine talking to itself.
 */
export function originFor(proto: string, host: string): string | null {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  if (proto === 'https') return `https://${h}`;
  if (proto === 'http' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h)) return `http://${h}`;
  return null;
}

/** The manifest a user installs: this site's origin in, localhost out. */
export function manifestFor(raw: string, origin: string): string {
  const m = JSON.parse(raw) as { host_permissions?: string[] };
  const local = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;
  const keepLocal = origin.startsWith('http://');
  m.host_permissions = [...new Set([
    ...(m.host_permissions ?? []).filter((p) => keepLocal || !local.test(p)),
    `${origin}/*`,
  ])];
  return JSON.stringify(m, null, 2);
}

function requestOrigin(req: FastifyRequest): string | null {
  // With TRUST_PROXY set, req.protocol reads x-forwarded-proto — Render
  // terminates TLS, so without that this would always say http.
  return originFor(req.protocol, req.host);
}

export async function registerExtensionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/extension/download', async (req, reply) => {
    const origin = requestOrigin(req);
    if (!origin) return reply.code(400).send({ error: 'the extension can only be served over https' });

    let names: string[];
    try {
      names = (await readdir(DIST)).filter((n) => !n.startsWith('.'));
    } catch {
      return reply.code(503).send({ error: 'the extension has not been built on this server' });
    }

    const files = await Promise.all(names.map(async (name) => {
      let text = await readFile(join(DIST, name), 'utf8');
      if (name === 'manifest.json') text = manifestFor(text, origin);
      else if (name.endsWith('.js')) text = text.split(BUILT_DEFAULT).join(origin);
      // One folder inside the zip, so unzipping gives the thing to pick in
      // "Load unpacked" rather than loose files on the desktop.
      return { name: `landfall-extension/${name}`, data: Buffer.from(text, 'utf8') };
    }));

    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', 'attachment; filename="landfall-extension.zip"')
      .header('cache-control', 'no-store')
      .send(zip(files));
  });
}
