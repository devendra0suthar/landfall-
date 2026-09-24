import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { loadProfile, toIndexed } from '../profile/load.js';
import { rankedJobIds } from '../jobs/ranking.js';
import { scoreJob } from '../score/score.js';
import { chipsFor, parseAsk, withoutPart, type AskFilters } from '../ask/parse.js';
import { matchingIds } from '../ask/search.js';

/**
 * POST /api/ask — one turn of "Ask Landfall".
 *
 * The client sends what the person typed and the filters the last turn ended
 * with; the reply is the new filters, how each part was read, the total, and
 * the best matches. Conversation state lives with the client, so a turn is
 * one request with no session to go stale, and removing a chip is just a turn
 * with no text.
 *
 * Every row comes out of the same index, ranked by the same score, as the Jobs
 * screen — the chat is another way in, not another source of truth.
 */

export const Filters = z.object({
  words: z.array(z.string().max(40)).max(12),
  skills: z.array(z.string().max(40)).max(12),
  place: z.object({ label: z.string().max(40), terms: z.array(z.string().max(40)).max(10) }).nullable(),
  workplace: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  level: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'manager']).nullable(),
  company: z.string().max(80).nullable(),
  days: z.number().int().positive().max(365).nullable(),
}).strict();

const Body = z.object({
  text: z.string().trim().max(300).optional(),
  filters: Filters.nullable().optional(),
  /** Opening a saved search: postings first seen after this are marked new. */
  newSince: z.string().datetime().optional(),
}).strict();

/** Company names change only on ingest; no need to ask on every turn. */
let companies: { at: number; names: string[] } | null = null;
async function companyNames(): Promise<string[]> {
  if (companies && Date.now() - companies.at < 10 * 60_000) return companies.names;
  const rows = await prisma.job.findMany({ where: { closedAt: null }, distinct: ['company'], select: { company: true } });
  companies = { at: Date.now(), names: rows.map((r) => r.company) };
  return companies.names;
}

const SHOW = 8;

export async function registerAskRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/ask', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const body = Body.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0]?.message ?? 'bad request' });

    const previous = (body.data.filters ?? null) as AskFilters | null;
    const parsed = body.data.text
      ? parseAsk(body.data.text, previous, { companies: await companyNames() })
      : { filters: previous ?? parseAsk('', null, { companies: [] }).filters, notes: [], ignored: [], reset: false };
    const f = parsed.filters;

    const profile = await loadProfile(candidateId);
    const found = await matchingIds(f, profile);
    const total = found.ids.length;
    const matchWhere: Prisma.JobWhereInput = { id: { in: found.ids } };

    let ids: string[] = [];
    if (total > 0 && profile) {
      const stamp = (await prisma.profile.findUnique({ where: { candidateId }, select: { updatedAt: true } }))
        ?.updatedAt.toISOString() ?? '';
      ids = (await rankedJobIds(candidateId, profile, stamp, matchWhere)).ids.slice(0, SHOW);
    } else if (total > 0) {
      ids = (await prisma.job.findMany({ where: matchWhere, orderBy: { postedAt: 'desc' }, take: SHOW, select: { id: true } }))
        .map((r) => r.id);
    }

    /**
     * Nothing matched: say which single part is in the way. Four empty
     * answers in a row, with nothing to do but guess, was the first real
     * conversation. Dropping each understood part in turn and counting is at
     * most seven cheap queries, and only on an empty answer.
     */
    // The role is the last thing to suggest dropping: "try without 'data
    // engineer'" answers a different question. Any other part that unblocks
    // the search wins over it, however many roles the role-less search has.
    type Loosen = { key: string; label: string; total: number };
    let loosen: Loosen | null = null;
    if (total === 0) {
      let roleless: Loosen | null = null;
      for (const chip of chipsFor(f)) {
        const n = (await matchingIds(withoutPart(f, chip.key), profile)).ids.length;
        if (n === 0) continue;
        if (chip.key === 'words') { roleless = { key: chip.key, label: chip.label, total: n }; continue; }
        if (!loosen || n > loosen.total) loosen = { key: chip.key, label: chip.label, total: n };
      }
      loosen ??= roleless;
    }

    const newSince = body.data.newSince ? new Date(body.data.newSince) : null;
    // New ones first when opening a saved search: they are why it was opened.
    if (newSince && total > 0) {
      const fresh = (await prisma.job.findMany({
        where: { id: { in: found.ids }, firstSeenAt: { gt: newSince } },
        select: { id: true },
      })).map((r) => r.id);
      const freshSet = new Set(fresh);
      const ranked = profile
        ? (await rankedJobIds(candidateId, profile, (await prisma.profile.findUnique({ where: { candidateId }, select: { updatedAt: true } }))?.updatedAt.toISOString() ?? '', matchWhere)).ids
        : ids;
      ids = [...ranked.filter((id) => freshSet.has(id)), ...ranked.filter((id) => !freshSet.has(id))].slice(0, SHOW);
    }

    const rows = await prisma.job.findMany({
      where: { id: { in: ids } },
      include: { board: { select: { slug: true } }, _count: { select: { questions: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const items = ids.flatMap((id) => {
      const j = byId.get(id);
      if (!j) return [];
      return [{
        jobId: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        url: j.absoluteUrl,
        posted: j.postedAt?.toISOString() ?? null,
        // The same score the Jobs screen shows, from the same function.
        match: profile ? scoreJob(toIndexed(j, j.board.slug), null, profile).match.score : null,
        formReadable: j.formFetchedAt !== null && j.formReadable,
        questions: j.formFetchedAt ? j._count.questions : null,
        isNew: newSince !== null && j.firstSeenAt > newSince,
      }];
    });

    return {
      filters: f,
      chips: chipsFor(f),
      notes: parsed.notes,
      reset: parsed.reset,
      // A message that changed nothing ("please show me some jobs") is told
      // so, rather than silently re-answered as if it had been understood.
      unchanged: body.data.text !== undefined && !parsed.reset
        && JSON.stringify(previous) === JSON.stringify(f),
      eligibilityApplied: found.eligibilityApplied,
      titleMatch: found.titleMatch,
      loosen,
      total,
      items,
    };
  });
}
