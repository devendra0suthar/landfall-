import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';

/**
 * The verified facts, as the candidate sees them.
 *
 * Read-only for now: editing arrives with the parse-and-correct flow, where a
 * field's provenance (typed by them, or extracted and confirmed) matters as
 * much as its value.
 */

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profile', async (_req, reply) => {
    const candidate = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!candidate) return reply.code(404).send({ error: 'no candidate yet' });

    const [profile, resume, bank, variants] = await Promise.all([
      prisma.profile.findUnique({
        where: { candidateId: candidate.id },
        include: {
          roles: {
            orderBy: { position: 'asc' },
            include: { bullets: { orderBy: { position: 'asc' } } },
          },
        },
      }),
      prisma.resumeFile.findFirst({
        where: { candidateId: candidate.id, active: true },
        orderBy: { uploadedAt: 'desc' },
      }),
      prisma.bankAnswer.findMany({ where: { candidateId: candidate.id }, orderBy: { labelKey: 'asc' } }),
      prisma.variant.findMany({ where: { candidateId: candidate.id } }),
    ]);

    if (!profile) return reply.code(404).send({ error: 'no profile yet — run pnpm seed' });

    return {
      candidate: { email: candidate.email, region: candidate.region },
      profile: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        email: profile.email,
        phone: profile.phone,
        location: profile.location,
        country: profile.country,
        linkedin: profile.linkedin,
        currentTitle: profile.currentTitle,
        skills: profile.skills,
        yearsExperience: profile.yearsExperience,
        roles: profile.roles.map((r) => ({
          id: r.id,
          title: r.title,
          company: r.company,
          start: r.start,
          end: r.end,
          location: r.location,
          bullets: r.bullets.map((b) => b.text),
        })),
      },
      // Null, not an empty object: no résumé on file is a different state from
      // a résumé whose bytes went missing, and the UI says which.
      resume: resume
        ? {
          id: resume.id, filename: resume.filename, bytes: resume.bytes,
          sha256: resume.sha256, uploadedAt: resume.uploadedAt,
        }
        : null,
      bank: bank.map((b) => ({ labelKey: b.labelKey, value: b.value })),
      variants: variants.map((v) => ({ name: v.name, active: v.active })),
    };
  });
}
