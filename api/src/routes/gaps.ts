import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { gapReport } from '../plan/gaps.js';
import { loadBank, loadProfile } from '../profile/load.js';

/**
 * The answer bank, and what is still missing from it.
 *
 * Answering one recurring question resolves it on every form that asks it, so
 * the endpoint reports reach — not a percentage. "Answer this and 41 forms
 * stop asking" is actionable; "your profile is 63% complete" is not.
 */

export async function registerGapRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/gaps', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const [profile, bank] = await Promise.all([loadProfile(candidateId), loadBank(candidateId)]);
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    return gapReport(profile, bank);
  });

  /**
   * Store one reusable answer.
   *
   * Refuses the questions that are the candidate's alone. A consent or
   * demographic answer must never end up here, and the cheapest place to
   * enforce that is the door — not every reader downstream.
   */
  app.put('/api/bank/:labelKey', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const labelKey = decodeURIComponent((req.params as { labelKey: string }).labelKey);
    const body = z.object({ value: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'value is required' });

    const { isHumanOnly } = await import('../plan/plan.js');
    if (isHumanOnly(labelKey)) {
      return reply.code(422).send({
        error: 'this question is yours to answer on the employer\'s own form. '
          + 'Consent, attestations and demographic questions are never stored '
          + 'or auto-filled — answering one on your behalf would be a statement '
          + 'you did not make.',
      });
    }

    const row = await prisma.bankAnswer.upsert({
      where: { candidateId_labelKey: { candidateId, labelKey } },
      create: { candidateId, labelKey, value: body.data.value },
      update: { value: body.data.value },
    });

    // How much this one answer just unlocked — the point of the bank.
    const unlocked = await prisma.question.count({ where: { labelKey } });

    return { ok: true, labelKey: row.labelKey, value: row.value, unlocked };
  });

  app.delete('/api/bank/:labelKey', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const labelKey = decodeURIComponent((req.params as { labelKey: string }).labelKey);
    await prisma.bankAnswer.deleteMany({ where: { candidateId, labelKey } });
    return { ok: true };
  });
}
