import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';

/**
 * Targeting variants — one set of facts, aimed different ways.
 *
 * A variant overrides only what is genuinely about *aim*: how you present for
 * this kind of work, and what you claim to bring to it.
 *
 *   overridable          one home each, never duplicated
 *   ─────────────        ─────────────────────────────────
 *   currentTitle         name, email, phone, address
 *   skills               work history and the bullets themselves
 *
 * The alternative — a second full profile per target role — stores the same
 * fact twice, and two places that can disagree eventually do. Copy a profile to
 * retarget it and your phone number lives in three files; change two of them
 * and the third quietly submits a number you stopped answering a year ago.
 *
 * Bullet selection is deliberately not a variant concern either: tailoring
 * already picks bullets per posting from evidence in the posting, and doing it
 * again per variant would be two mechanisms competing to answer one question.
 */

async function currentCandidateId(): Promise<string | null> {
  const c = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
  return c?.id ?? null;
}

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  currentTitle: z.string().trim().max(120).nullish(),
  skills: z.array(z.string().trim().min(1)).max(80).optional(),
}).strict();

export async function registerVariantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/variants', async (_req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const [variants, profile] = await Promise.all([
      prisma.variant.findMany({ where: { candidateId }, orderBy: { name: 'asc' } }),
      prisma.profile.findUnique({
        where: { candidateId },
        select: { currentTitle: true, skills: true },
      }),
    ]);

    return {
      // What applies when no variant is active — shown so the candidate can see
      // exactly what a variant is changing, rather than guessing.
      base: { currentTitle: profile?.currentTitle ?? null, skills: profile?.skills ?? [] },
      active: variants.find((v) => v.active)?.name ?? null,
      variants: variants.map((v) => ({
        id: v.id, name: v.name, currentTitle: v.currentTitle, skills: v.skills, active: v.active,
      })),
    };
  });

  app.post('/api/variants', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return reply.code(400).send({
        error: i?.path.length ? `${i.path.join('.')}: ${i.message}` : (i?.message ?? 'bad body'),
        ...(i?.code === 'unrecognized_keys'
          ? {
            hint: 'A variant overrides aim only — currentTitle and skills. Contact details '
              + 'and work history have one home each, on the profile.',
          }
          : {}),
      });
    }
    const b = parsed.data;

    const row = await prisma.variant.upsert({
      where: { candidateId_name: { candidateId, name: b.name } },
      create: {
        candidateId,
        name: b.name,
        currentTitle: b.currentTitle ?? null,
        skills: (b.skills ?? []).map((s) => s.toLowerCase()),
      },
      update: {
        currentTitle: b.currentTitle ?? null,
        ...(b.skills ? { skills: b.skills.map((s) => s.toLowerCase()) } : {}),
      },
    });

    return reply.code(201).send({ id: row.id, name: row.name, active: row.active });
  });

  /**
   * Aim at one variant, or at nothing.
   *
   * Exactly one can be active. Selecting is a single transaction rather than
   * clear-then-set, because a half-applied switch leaves the candidate aimed at
   * nothing while the UI says otherwise.
   */
  app.post('/api/variants/select', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const parsed = z.object({ name: z.string().trim().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'name is required (null to clear)' });
    const name = parsed.data.name;

    if (name !== null) {
      const exists = await prisma.variant.findUnique({
        where: { candidateId_name: { candidateId, name } },
      });
      if (!exists) return reply.code(404).send({ error: `no variant called "${name}"` });
    }

    await prisma.$transaction([
      prisma.variant.updateMany({ where: { candidateId }, data: { active: false } }),
      ...(name === null
        ? []
        : [prisma.variant.update({
          where: { candidateId_name: { candidateId, name } },
          data: { active: true },
        })]),
    ]);

    return {
      ok: true,
      active: name,
      note: name === null
        ? 'Aiming as your profile says. Match scores recompute on the next request.'
        : `Aiming as "${name}". Your contact details and work history are untouched — `
          + 'only the title you present and the skills you claim change.',
    };
  });

  app.delete('/api/variants/:name', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const name = decodeURIComponent((req.params as { name: string }).name);
    await prisma.variant.deleteMany({ where: { candidateId, name } });
    return { ok: true };
  });
}
