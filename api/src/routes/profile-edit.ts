import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireFreshAuth } from '../auth/session.js';

/**
 * Editing the verified facts.
 *
 * Every downstream number rests on these — match, readiness, the tailored
 * résumé, the fill plan — so this endpoint is deliberately strict about two
 * things:
 *
 *   1. The three fields the schema marks required really are required. An
 *      earlier version of this product accepted any JSON object and replaced
 *      the whole profile with it, so a wrapped body or a typo in a script took
 *      the candidate's name, contact details and entire work history with it.
 *      There was no undo.
 *   2. Unknown keys are refused, not ignored. A misspelled field that silently
 *      does nothing is how someone spends an afternoon wondering why their
 *      phone number will not save.
 */

const Role = z.object({
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  start: z.string().trim().min(1),
  end: z.string().trim().nullish(),
  location: z.string().trim().nullish(),
  bullets: z.array(z.string().trim().min(1)).max(40),
}).strict();

const Body = z.object({
  firstName: z.string().trim().min(1, 'first name is required'),
  lastName: z.string().trim().min(1, 'last name is required'),
  email: z.string().trim().email('a valid email is required'),
  phone: z.string().trim().nullish(),
  location: z.string().trim().nullish(),
  city: z.string().trim().nullish(),
  country: z.string().trim().nullish(),
  postalCode: z.string().trim().nullish(),
  linkedin: z.string().trim().nullish(),
  github: z.string().trim().nullish(),
  website: z.string().trim().nullish(),
  currentTitle: z.string().trim().nullish(),
  // Lowercased on the way in: the extractor's vocabulary is lowercase, and a
  // "Python" that never matches "python" is a skill the candidate thinks they
  // claimed.
  skills: z.array(z.string().trim().min(1)).max(80).optional(),
  yearsExperience: z.number().int().min(0).max(70).nullish(),
  experience: z.array(Role).max(20).optional(),
}).strict();

const nullable = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

export async function registerProfileEditRoutes(app: FastifyInstance): Promise<void> {
  app.put('/api/profile', async (req, reply) => {
    // The profile is the thing every document is built from, so editing it is
    // one of the points FR-27 asks for a recent password proof.
    const candidateId = await requireFreshAuth(req, reply);
    if (!candidateId) return reply;

    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join('.') ?? '';
      return reply.code(400).send({
        error: where ? `${where}: ${issue?.message}` : (issue?.message ?? 'bad body'),
        ...(issue?.code === 'unrecognized_keys'
          ? {
            hint: 'Unknown fields are refused rather than ignored, so a typo cannot '
              + 'silently do nothing. If you meant to send the whole profile, send the '
              + 'object itself — not a wrapper around it.',
          }
          : {}),
      });
    }
    const b = parsed.data;

    const saved = await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.upsert({
        where: { candidateId: candidateId },
        create: {
          candidateId: candidateId,
          firstName: b.firstName,
          lastName: b.lastName,
          email: b.email,
          phone: nullable(b.phone),
          location: nullable(b.location),
          city: nullable(b.city),
          country: nullable(b.country),
          postalCode: nullable(b.postalCode),
          linkedin: nullable(b.linkedin),
          github: nullable(b.github),
          website: nullable(b.website),
          currentTitle: nullable(b.currentTitle),
          skills: (b.skills ?? []).map((s) => s.toLowerCase()),
          yearsExperience: b.yearsExperience ?? null,
        },
        update: {
          firstName: b.firstName,
          lastName: b.lastName,
          email: b.email,
          phone: nullable(b.phone),
          location: nullable(b.location),
          city: nullable(b.city),
          country: nullable(b.country),
          postalCode: nullable(b.postalCode),
          linkedin: nullable(b.linkedin),
          github: nullable(b.github),
          website: nullable(b.website),
          currentTitle: nullable(b.currentTitle),
          ...(b.skills ? { skills: b.skills.map((s) => s.toLowerCase()) } : {}),
          yearsExperience: b.yearsExperience ?? null,
        },
      });

      // Experience is replaced wholesale when sent, and left alone when not.
      // Merging roles by position would silently reattach bullets to the wrong
      // job when someone reorders their history — and a bullet under the wrong
      // employer is a false claim, not a display bug.
      if (b.experience) {
        await tx.role.deleteMany({ where: { profileId: profile.id } });
        for (const [i, r] of b.experience.entries()) {
          await tx.role.create({
            data: {
              profileId: profile.id,
              title: r.title,
              company: r.company,
              start: r.start,
              end: nullable(r.end),
              location: nullable(r.location),
              position: i,
              bullets: { create: r.bullets.map((text, j) => ({ text, position: j })) },
            },
          });
        }
      }

      return profile;
    });

    // Nothing is cached, so every score is recomputed on the next request.
    // Saying so is the honest version of "changes applied".
    return {
      ok: true,
      updatedAt: saved.updatedAt,
      note: 'Match scores, readiness and every tailored résumé are recomputed from these '
        + 'facts on the next request. Applications you have already sent are unchanged — '
        + 'their record was frozen when you sent them.',
    };
  });
}
