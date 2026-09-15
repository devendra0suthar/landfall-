import Fastify from 'fastify';
import { prisma } from './lib/db.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerPrepareRoutes } from './routes/prepare.js';
import { registerResumeRoutes } from './routes/resume.js';
import { registerApplicationRoutes } from './routes/applications.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerGapRoutes } from './routes/gaps.js';
import { registerProfileEditRoutes } from './routes/profile-edit.js';
import { registerParseRoutes } from './routes/parse.js';

/**
 * The API.
 *
 * Regional by deployment: this process, its database and its object storage
 * all live in one region, and a candidate's requests never leave it
 * (docs/REQUIREMENTS.md NFR-4). The front end is static and global; nothing
 * here renders HTML.
 */

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

app.get('/api/health', async () => {
  const jobs = await prisma.job.count();
  return { ok: true, jobs, region: process.env.LANDFALL_REGION ?? 'ap-south-1' };
});

await registerJobRoutes(app);
await registerPrepareRoutes(app);
await registerResumeRoutes(app);
await registerApplicationRoutes(app);
await registerProfileRoutes(app);
await registerGapRoutes(app);
await registerProfileEditRoutes(app);
await registerParseRoutes(app);

const port = Number(process.env.PORT ?? 5175);

try {
  await app.listen({ port, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
