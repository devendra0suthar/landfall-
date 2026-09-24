import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { prisma } from './lib/db.js';
import { checkStateDirWritable } from './lib/state-check.js';
import { registerAuthRoutes, registerGoogleRoutes } from './routes/auth.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerPrepareRoutes, registerTemplateRoutes } from './routes/prepare.js';
import { registerKitRoutes } from './routes/kit.js';
import { registerAnalyzeRoutes } from './routes/analyze.js';
import { registerResumeRoutes } from './routes/resume.js';
import { registerApplicationRoutes } from './routes/applications.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerGapRoutes } from './routes/gaps.js';
import { registerProfileEditRoutes } from './routes/profile-edit.js';
import { registerParseRoutes } from './routes/parse.js';
import { registerVariantRoutes } from './routes/variants.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerSuggestRoutes } from './routes/suggest.js';
import { scheduleIndexRefresh } from './ingest/refresh.js';
import { registerRunRoutes } from './routes/run.js';
import { registerAskRoutes } from './routes/ask.js';
import { registerSearchRoutes } from './routes/searches.js';
import { registerExtensionRoutes } from './routes/extension.js';

/**
 * The API, and in production the front end too.
 *
 * Regional by deployment: this process, its database and its object storage
 * all live in one region, and a candidate's requests never leave it
 * (docs/REQUIREMENTS.md NFR-4). Nothing here renders HTML — `web/dist` is a
 * static build served as files.
 *
 * **One origin, deliberately.** §9 commits the front end to relative paths, so
 * which region a candidate reaches is decided by where they loaded the page
 * and never by an origin compiled into the bundle. Serving the built front end
 * from this same process is what keeps that true in production; splitting them
 * across two hosts would require a hardcoded API origin and CORS, which
 * contradicts the architecture rather than merely complicating it.
 */

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // Render, Railway and Fly all terminate TLS at a proxy. Without this, every
  // request looks like it came from the proxy's IP — which makes the rate
  // limiter below a single shared bucket for the whole internet.
  trustProxy: process.env.TRUST_PROXY === 'true',
});

await app.register(cookie);

/**
 * A ceiling on the whole API, and a much lower one on the doors.
 *
 * The global limit is about cost and noise. The limit on `/api/auth/*` is the
 * thing that makes the constant-time login and the silence about which emails
 * exist worth anything at all: without it, an attacker simply asks a million
 * times. `/api/suggest` gets its own because it spends money per call.
 */
await app.register(rateLimit, {
  global: true,
  max: Number(process.env.RATE_LIMIT_MAX ?? 600),
  timeWindow: '1 minute',
  // Fastify's default keys on IP; behind a proxy that is only meaningful with
  // trustProxy set, which is why the two are configured together.
  allowList: () => process.env.RATE_LIMIT_DISABLED === 'true',
});

await app.register(async (scope) => {
  await scope.register(rateLimit, { max: 10, timeWindow: '1 minute' });
  await registerAuthRoutes(scope);
});

await app.register(async (scope) => {
  await scope.register(rateLimit, { max: 20, timeWindow: '1 minute' });
  await registerSuggestRoutes(scope);
});

// Registered outside the 10/min auth limit on purpose: the callback is one hop
// in a redirect chain the candidate did not time, and throttling it would fail
// real sign-ins while stopping nothing — there is no password here to guess.
await registerGoogleRoutes(app);

app.get('/api/health', async () => {
  const [jobs, open, oldest] = await Promise.all([
    prisma.job.count(),
    prisma.job.count({ where: { closedAt: null } }),
    prisma.board.findFirst({ where: { disabled: false }, orderBy: { lastFetchedAt: 'asc' }, select: { lastFetchedAt: true } }),
  ]);
  return {
    ok: true,
    jobs,
    open,
    // How stale the index is, from outside. Production once sat on its
    // day-one data with nothing showing it; this is the number to watch.
    indexedAt: oldest?.lastFetchedAt?.toISOString() ?? null,
    region: process.env.LANDFALL_REGION ?? 'ap-south-1',
  };
});

await registerJobRoutes(app);
await registerPrepareRoutes(app);
await registerTemplateRoutes(app);
await registerKitRoutes(app);
await registerRunRoutes(app);
await registerAskRoutes(app);
await registerSearchRoutes(app);
await registerExtensionRoutes(app);
await registerAnalyzeRoutes(app);
await registerResumeRoutes(app);
await registerApplicationRoutes(app);
await registerProfileRoutes(app);
await registerGapRoutes(app);
await registerProfileEditRoutes(app);
await registerParseRoutes(app);
await registerVariantRoutes(app);
await registerAccountRoutes(app);

/**
 * The built front end, when there is one.
 *
 * Absent in development — Vite serves it on :5174 and proxies `/api` here — so
 * this is conditional rather than required. A missing `web/dist` in production
 * is a broken deploy, and it says so in the log rather than 404ing every page
 * with no explanation.
 */
const webDist = resolve(
  process.env.WEB_DIST ?? join(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
);

if (existsSync(join(webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: webDist });
  // Hash routing means every real route is `/`, but a stray deep link should
  // land on the app rather than on a 404 from the file server.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no such endpoint' });
    return reply.sendFile('index.html');
  });
  app.log.info({ webDist }, 'serving the front end from this process');
} else if (process.env.NODE_ENV === 'production') {
  app.log.error({ webDist }, 'no web/dist — run `pnpm --filter ./web build` before starting');
}

// Before listening, not after: a service that cannot store a résumé is broken
// whether or not anyone has tried yet, and the log is where that belongs.
await checkStateDirWritable(app.log);

const port = Number(process.env.PORT ?? 5175);
// Loopback on a laptop; every container needs 0.0.0.0 or nothing outside it
// can connect, and that failure looks like a hung deploy rather than a config
// error. The default stays the safe one.
const host = process.env.HOST ?? '127.0.0.1';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Keeps the job index fresh when INDEX_REFRESH_HOURS is set (see refresh.ts).
// Off by default, so a laptop dev server never starts crawling on its own.
scheduleIndexRefresh((line) => app.log.info({ refresh: true }, line));
