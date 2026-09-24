import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { loadProfile } from '../profile/load.js';
import { matchingIds } from '../ask/search.js';
import type { AskFilters } from '../ask/parse.js';
import { Filters } from './ask.js';

/**
 * Saved searches — "tell me what's new".
 *
 * The index refreshes itself daily now, which is only worth something if the
 * candidate hears about what arrived. There is no mail sender, so the alert
 * lives where they already look: each saved search carries a count of open
 * postings that match it and entered the index since they last opened it.
 *
 * "New" means first seen by us after `lastSeenAt` (Job.firstSeenAt, which a
 * refresh never rewrites) — not the employer's posted date, which is often
 * older than the day we found it and would make a real new arrival invisible.
 */

/** JSON with keys in a fixed order, so equal values compare equal as text. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Enough for anyone's real searches; stops the list becoming a second index. */
const MAX_SAVED = 20;

const Save = z.object({
  label: z.string().trim().min(1).max(160),
  filters: Filters,
}).strict();

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/searches', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const [saved, profile] = await Promise.all([
      prisma.savedSearch.findMany({ where: { candidateId }, orderBy: { createdAt: 'desc' } }),
      loadProfile(candidateId),
    ]);

    const rows = await Promise.all(saved.map(async (s) => {
      const { ids } = await matchingIds(s.filters as unknown as AskFilters, profile);
      const fresh = ids.length === 0 ? 0 : await prisma.job.count({
        where: { id: { in: ids }, firstSeenAt: { gt: s.lastSeenAt } },
      });
      return { id: s.id, label: s.label, filters: s.filters, total: ids.length, newCount: fresh, lastSeenAt: s.lastSeenAt };
    }));

    return { rows };
  });

  app.post('/api/searches', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const body = Save.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'bad request' });

    // Saving the same search twice is one saved search. Compared by canonical
    // form: Postgres reorders the keys of stored JSON, so a plain
    // JSON.stringify comparison never matched and every save made a copy.
    const same = (await prisma.savedSearch.findMany({ where: { candidateId } }))
      .find((s) => canonical(s.filters) === canonical(body.data.filters));
    if (same) return { id: same.id, label: same.label, already: true };

    const count = await prisma.savedSearch.count({ where: { candidateId } });
    if (count >= MAX_SAVED) {
      return reply.code(409).send({ error: `You can keep up to ${MAX_SAVED} searches — remove one first.` });
    }

    const row = await prisma.savedSearch.create({
      data: { candidateId, label: body.data.label, filters: body.data.filters as Prisma.InputJsonValue },
    });
    return reply.code(201).send({ id: row.id, label: row.label, already: false });
  });

  /** Opened: everything matching it now counts as seen. */
  app.post('/api/searches/:id/seen', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;
    const { id } = req.params as { id: string };
    const r = await prisma.savedSearch.updateMany({ where: { id, candidateId }, data: { lastSeenAt: new Date() } });
    if (r.count === 0) return reply.code(404).send({ error: 'no such saved search' });
    return { ok: true };
  });

  app.delete('/api/searches/:id', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;
    const { id } = req.params as { id: string };
    const r = await prisma.savedSearch.deleteMany({ where: { id, candidateId } });
    if (r.count === 0) return reply.code(404).send({ error: 'no such saved search' });
    return { ok: true };
  });
}
