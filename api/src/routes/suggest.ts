import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { modelConfigured, isAuthFailure } from '../lib/claude.js';
import { suggestRewordings } from '../suggest/suggest.js';
import { verifyRewording } from '../suggest/verify.js';

/**
 * Proposed rewordings, and the candidate's decision on each one.
 *
 *   POST /api/suggest            the model proposes. Writes nothing.
 *   POST /api/bullets/:id/accept the candidate accepts one. Writes.
 *   POST /api/bullets/:id/revert the candidate changes their mind. Writes.
 *
 * Accepting re-runs the verifier on the way in. The front end already filtered
 * to proposals that passed, so this is not defence against the candidate — it
 * is defence against a client bug or a hand-rolled request quietly putting an
 * embellished line into a CV through an endpoint whose whole name promises it
 * came from a checked suggestion. A candidate who wants to write something the
 * verifier would refuse is free to: that is `PUT /api/profile`, where the words
 * are theirs and no AI provenance is recorded.
 */

/** Said the same way wherever it is said, so one fix changes one string. */
const NO_CREDENTIALS = 'no model credentials configured on this server';
const CREDENTIALS_HINT = 'Set ANTHROPIC_API_KEY on the API process. Everything else in '
  + 'Landfall works without it; only rewording suggestions need a model.';

const SuggestBody = z.object({
  /** Limit to one role. Omitted means every bullet on the profile. */
  roleId: z.string().trim().min(1).optional(),
  bulletIds: z.array(z.string().trim().min(1)).max(40).optional(),
}).strict();

const AcceptBody = z.object({
  text: z.string().trim().min(1),
}).strict();

export async function registerSuggestRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/suggest/status', async () => ({
    available: modelConfigured(),
    // Said plainly so the screen can explain itself rather than showing a
    // button that silently does nothing.
    reason: modelConfigured() ? null : NO_CREDENTIALS,
  }));

  /**
   * The candidate's bullets, with their ids and their rewording history.
   *
   * `GET /api/profile` returns bullets as bare strings, and every other screen
   * relies on that shape. Rather than widen it — and touch the editor, the Kit
   * and the parse review to do it — this endpoint serves the one screen that
   * needs to address a bullet individually.
   */
  app.get('/api/suggest/bullets', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const roles = await prisma.role.findMany({
      where: { profile: { candidateId } },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        title: true,
        company: true,
        start: true,
        end: true,
        bullets: {
          orderBy: { position: 'asc' },
          select: { id: true, text: true, originalText: true, acceptedAt: true },
        },
      },
    });

    return reply.send({
      available: modelConfigured(),
      roles,
      bulletCount: roles.reduce((n, r) => n + r.bullets.length, 0),
    });
  });

  app.post('/api/suggest', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const parsed = SuggestBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad body' });
    }
    if (!modelConfigured()) {
      return reply.code(503).send({ error: NO_CREDENTIALS, hint: CREDENTIALS_HINT });
    }

    const { roleId, bulletIds } = parsed.data;
    const bullets = await prisma.bullet.findMany({
      where: {
        // Scoped through the role and profile, so a bullet id belonging to
        // someone else finds nothing rather than being reworded.
        role: { profile: { candidateId }, ...(roleId ? { id: roleId } : {}) },
        ...(bulletIds ? { id: { in: bulletIds } } : {}),
      },
      orderBy: [{ role: { position: 'asc' } }, { position: 'asc' }],
      select: { id: true, text: true },
      take: 40,
    });

    if (bullets.length === 0) {
      return reply.send({ suggestions: [], discarded: [], model: null, bulletsConsidered: 0 });
    }

    try {
      const result = await suggestRewordings(bullets);
      return reply.send({ ...result, bulletsConsidered: bullets.length });
    } catch (err) {
      req.log.error({ err }, 'suggestion request failed');
      // A missing credential is a configuration problem that will never fix
      // itself, and saying "could not be reached" invites someone to retry
      // forever. The two failures get different words and different codes.
      if (isAuthFailure(err)) {
        return reply.code(503).send({ error: NO_CREDENTIALS, hint: CREDENTIALS_HINT });
      }
      return reply.code(502).send({ error: 'the model could not be reached' });
    }
  });

  app.post('/api/bullets/:id/accept', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const { id } = req.params as { id: string };
    const parsed = AcceptBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad body' });
    }

    const bullet = await prisma.bullet.findFirst({
      where: { id, role: { profile: { candidateId } } },
      select: { id: true, text: true, originalText: true },
    });
    if (!bullet) return reply.code(404).send({ error: 'no such bullet' });

    const verdict = verifyRewording(bullet.text, parsed.data.text);
    if (!verdict.ok) {
      return reply.code(422).send({
        error: 'that rewording introduces something the original does not say',
        objections: verdict.objections,
      });
    }

    const saved = await prisma.bullet.update({
      where: { id: bullet.id },
      data: {
        text: parsed.data.text,
        // Only the first acceptance records an original. A second rewording of
        // an already-reworded line still reverts to what the candidate wrote,
        // not to the previous machine wording.
        originalText: bullet.originalText ?? bullet.text,
        acceptedAt: new Date(),
      },
      select: { id: true, text: true, originalText: true, acceptedAt: true },
    });
    return reply.send(saved);
  });

  app.post('/api/bullets/:id/revert', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const { id } = req.params as { id: string };
    const bullet = await prisma.bullet.findFirst({
      where: { id, role: { profile: { candidateId } } },
      select: { id: true, originalText: true },
    });
    if (!bullet) return reply.code(404).send({ error: 'no such bullet' });
    if (bullet.originalText === null) {
      return reply.code(409).send({ error: 'this line has not been reworded' });
    }

    const saved = await prisma.bullet.update({
      where: { id: bullet.id },
      data: { text: bullet.originalText, originalText: null, acceptedAt: null },
      select: { id: true, text: true, originalText: true, acceptedAt: true },
    });
    return reply.send(saved);
  });
}
