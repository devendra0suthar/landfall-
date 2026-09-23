import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireFreshAuth } from '../auth/session.js';
import { deleteStored, readStored } from '../profile/resume-store.js';
import { forgetArchive, readArchive } from '../record/archive.js';

/**
 * Taking everything, and leaving.
 *
 * FR-25 and FR-26 say a candidate can export their data and delete their
 * account, and §8 says these are product features rather than support tickets.
 * That distinction is the whole point: a right you have to ask a human to
 * exercise is a right with a queue in front of it.
 *
 * Erasure wins over immutability here. The sent-record archive is written once
 * and never rewritten — but it exists for the candidate's own memory of what
 * they sent, it is not a compliance record we are obliged to keep, and there is
 * no lawful basis for holding a CV after they withdraw. So it goes with them.
 */

/**
 * Export and erasure both move or destroy the whole record, which makes them
 * the two clearest cases of FR-27's "data leaves or changes" — so both ask for
 * a recent password proof rather than only a live session.
 */
async function freshCandidate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; email: string } | null> {
  const candidateId = await requireFreshAuth(req, reply);
  if (!candidateId) return null;
  return prisma.candidate.findUnique({ where: { id: candidateId }, select: { id: true, email: true } });
}

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Everything held, in one machine-readable document.
   *
   * Files ride along base64-encoded rather than as links: an export that points
   * at endpoints needing this account to still exist is not portable, and the
   * first thing someone does after exporting is often delete.
   */
  app.get('/api/export', async (req, reply) => {
    const who = await freshCandidate(req, reply);
    if (!who) return reply;

    const candidate = await prisma.candidate.findUnique({
      where: { id: who.id },
      include: {
        profile: { include: { roles: { include: { bullets: true } } } },
        resumes: true,
        bankAnswers: true,
        variants: true,
        applications: { include: { job: true, sent: true } },
      },
    });
    if (!candidate) return reply.code(404).send({ error: 'no candidate yet' });

    const resumes = await Promise.all(candidate.resumes.map(async (r) => ({
      filename: r.filename,
      contentType: r.contentType,
      bytes: r.bytes,
      sha256: r.sha256,
      uploadedAt: r.uploadedAt,
      active: r.active,
      // Null rather than absent when the bytes have gone: an export that
      // silently omits a file the record claims exists is a quiet lie.
      base64: (await readStored(r.storageKey))?.toString('base64') ?? null,
    })));

    const applications = await Promise.all(candidate.applications.map(async (a) => ({
      status: a.status,
      notes: a.notes,
      drafts: a.drafts,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      job: {
        title: a.job.title,
        company: a.job.company,
        location: a.job.location,
        url: a.job.absoluteUrl,
      },
      sent: a.sent
        ? {
          sentAt: a.sent.sentAt,
          filename: a.sent.filename,
          sha256: a.sent.sha256,
          bytes: a.sent.bytes,
          bullets: a.sent.bullets,
          variant: a.sent.variant,
          tailored: a.sent.tailored,
          expiresAt: a.sent.expiresAt,
          base64: (await readArchive(a.sent.storageKey))?.toString('base64') ?? null,
        }
        : null,
    })));

    return reply
      .header('content-disposition', 'attachment; filename="landfall-export.json"')
      .send({
        exportedAt: new Date().toISOString(),
        format: 'landfall-export/1',
        candidate: { email: candidate.email, region: candidate.region, createdAt: candidate.createdAt },
        profile: candidate.profile
          ? {
            firstName: candidate.profile.firstName,
            lastName: candidate.profile.lastName,
            email: candidate.profile.email,
            phone: candidate.profile.phone,
            location: candidate.profile.location,
            city: candidate.profile.city,
            country: candidate.profile.country,
            postalCode: candidate.profile.postalCode,
            linkedin: candidate.profile.linkedin,
            github: candidate.profile.github,
            website: candidate.profile.website,
            currentTitle: candidate.profile.currentTitle,
            skills: candidate.profile.skills,
            yearsExperience: candidate.profile.yearsExperience,
            roles: candidate.profile.roles
              .sort((a, b) => a.position - b.position)
              .map((r) => ({
                title: r.title,
                company: r.company,
                start: r.start,
                end: r.end,
                location: r.location,
                bullets: r.bullets.sort((a, b) => a.position - b.position).map((x) => x.text),
              })),
          }
          : null,
        resumes,
        applications,
        savedAnswers: candidate.bankAnswers.map((b) => ({ question: b.labelKey, answer: b.value })),
        variants: candidate.variants.map((v) => ({
          name: v.name, currentTitle: v.currentTitle, skills: v.skills, active: v.active,
        })),
        // Said in the document itself, because an export is read long after the
        // page that produced it is gone.
        notIncluded: [
          'Nothing about consent, demographics, health or attestations — Landfall never '
          + 'stored an answer to any of those, so there is none to export.',
          'Job postings and their form schemas are public employer data, not yours; they '
          + 'are not part of your record.',
        ],
      });
  });

  /**
   * Delete the account, the files, and the archives.
   *
   * Requires the account's own email in the body. Not security — anyone with
   * this session could type it — but a deliberate gesture: the one irreversible
   * action in the product should not be reachable by a mistimed click.
   */
  app.delete('/api/account', async (req, reply) => {
    const candidate = await freshCandidate(req, reply);
    if (!candidate) return reply;

    const parsed = z.object({ confirmEmail: z.string().trim() }).safeParse(req.body);
    if (!parsed.success || parsed.data.confirmEmail.toLowerCase() !== candidate.email.toLowerCase()) {
      return reply.code(400).send({
        error: 'to delete everything, send confirmEmail with this account\'s email address',
        expected: candidate.email,
      });
    }

    // Collect storage keys BEFORE the cascade removes the rows that name them.
    // Deleting the rows first would orphan every file with no way left to find
    // it — which is how "we deleted your data" becomes untrue on disk.
    const [resumes, sent] = await Promise.all([
      prisma.resumeFile.findMany({ where: { candidateId: candidate.id }, select: { storageKey: true } }),
      prisma.sentRecord.findMany({
        where: { application: { candidateId: candidate.id } },
        select: { storageKey: true },
      }),
    ]);

    await prisma.candidate.delete({ where: { id: candidate.id } });

    // Reference-counted, because storage is content-addressed: two candidates
    // who uploaded identical bytes share one file, and one leaving must not
    // delete the other's résumé.
    let filesDeleted = 0;
    for (const key of new Set(resumes.map((r) => r.storageKey))) {
      const stillUsed = await prisma.resumeFile.count({ where: { storageKey: key } });
      if (stillUsed === 0) {
        await deleteStored(key);
        filesDeleted += 1;
      }
    }
    let archivesDeleted = 0;
    for (const key of new Set(sent.map((s) => s.storageKey))) {
      if (await forgetArchive(key)) archivesDeleted += 1;
    }

    return {
      ok: true,
      deleted: {
        candidate: candidate.email,
        resumeFiles: filesDeleted,
        sentArchives: archivesDeleted,
      },
      note: 'Gone, including the archived documents. Applications you sent to employers are '
        + 'with those employers — we can delete our record of them, not theirs.',
    };
  });
}
