import type { FastifyInstance } from 'fastify';
import { ApplicationStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { captureSend, forgetArchive, readArchive } from '../record/archive.js';

/**
 * The tracker.
 *
 * APPLIED means the candidate told us they applied. Landfall never submits, so
 * it can only record what they say happened — and the record says `submitted`,
 * never `confirmed`, until an employer's own reply says otherwise (FR-22).
 */

async function currentCandidateId(): Promise<string | null> {
  const c = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
  return c?.id ?? null;
}

const Patch = z.object({
  status: z.nativeEnum(ApplicationStatus).optional(),
  notes: z.string().max(4000).optional(),
  drafts: z.record(z.string(), z.string()).optional(),
});

/** Default window before an application counts as gone quiet (FR-23). */
const FOLLOW_UP_DAYS = 14;

export async function registerApplicationRoutes(app: FastifyInstance): Promise<void> {
  /** Save a posting into the pipeline. */
  app.post('/api/applications', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const body = z.object({ jobId: z.string().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'jobId is required' });

    const job = await prisma.job.findUnique({ where: { id: body.data.jobId } });
    if (!job) return reply.code(404).send({ error: 'no such job' });

    const row = await prisma.application.upsert({
      where: { candidateId_jobId: { candidateId, jobId: job.id } },
      create: { candidateId, jobId: job.id, status: ApplicationStatus.SAVED },
      update: {},
    });

    return reply.code(201).send({ id: row.id, status: row.status });
  });

  app.get('/api/applications', async (_req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const [rows, counts] = await Promise.all([
      prisma.application.findMany({
        where: { candidateId },
        orderBy: { updatedAt: 'desc' },
        include: {
          job: { select: { title: true, company: true, location: true, absoluteUrl: true } },
          sent: { select: { sentAt: true, filename: true, sha256: true, tailored: true } },
        },
      }),
      prisma.application.groupBy({
        by: ['status'],
        where: { candidateId },
        _count: true,
      }),
    ]);

    const quietSince = Date.now() - FOLLOW_UP_DAYS * 86_400_000;

    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        title: r.job.title,
        company: r.job.company,
        location: r.job.location,
        url: r.job.absoluteUrl,
        updatedAt: r.updatedAt,
        sent: r.sent
          ? {
            sentAt: r.sent.sentAt,
            filename: r.sent.filename,
            sha256: r.sent.sha256,
            tailored: r.sent.tailored,
          }
          : null,
        // Only an applied job can go quiet, and only when nothing has moved.
        quiet: r.status === ApplicationStatus.APPLIED
          && r.sent !== null
          && r.sent.sentAt.getTime() < quietSince,
      })),
    };
  });

  app.get('/api/applications/:id', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const { id } = req.params as { id: string };
    const row = await prisma.application.findFirst({
      where: { id, candidateId },
      include: { job: true, sent: true },
    });
    if (!row) return reply.code(404).send({ error: 'no such application' });

    return {
      id: row.id,
      status: row.status,
      notes: row.notes,
      drafts: row.drafts,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      job: {
        id: row.job.id, title: row.job.title, company: row.job.company,
        location: row.job.location, url: row.job.absoluteUrl,
      },
      sent: row.sent
        ? {
          sentAt: row.sent.sentAt,
          filename: row.sent.filename,
          sha256: row.sent.sha256,
          bytes: row.sent.bytes,
          bullets: row.sent.bullets,
          variant: row.sent.variant,
          tailored: row.sent.tailored,
          expiresAt: row.sent.expiresAt,
          // Deliberate: submitted is what we know. Only the employer's own
          // reply can make it confirmed, and we have not had one.
          verified: 'not-attempted',
        }
        : null,
    };
  });

  /**
   * Move an application, and freeze what was sent on the way into APPLIED.
   *
   * The capture happens exactly once. An application that is already APPLIED,
   * or that has been APPLIED before and come back, keeps the record it has —
   * re-marking is not re-sending.
   */
  app.patch('/api/applications/:id', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const { id } = req.params as { id: string };
    const parsed = Patch.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad body' });
    }

    const existing = await prisma.application.findFirst({
      where: { id, candidateId },
      include: { sent: { select: { id: true } } },
    });
    if (!existing) return reply.code(404).send({ error: 'no such application' });

    const becomingApplied = parsed.data.status === ApplicationStatus.APPLIED
      && existing.status !== ApplicationStatus.APPLIED;

    let captured = null;
    let captureNote: string | null = null;
    if (becomingApplied && !existing.sent) {
      try {
        captured = await captureSend(candidateId, existing.jobId);
        if (!captured) {
          captureNote = 'nothing was archived: no résumé on file and nothing to tailor';
        }
      } catch (err) {
        // Losing the archive for one application is bad. Refusing to let a
        // candidate mark a job applied because a file could not be written is
        // worse — the status is theirs, not ours.
        captureNote = 'the document could not be archived; the status was still recorded';
        req.log.error({ err }, 'captureSend failed');
      }
    }

    const updated = await prisma.application.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.drafts !== undefined
          ? { drafts: parsed.data.drafts as Prisma.InputJsonValue }
          : {}),
        ...(captured
          ? {
            sent: {
              create: {
                filename: captured.filename,
                sha256: captured.sha256,
                bytes: captured.bytes,
                bullets: captured.bullets,
                variant: captured.variant,
                tailored: captured.tailored,
                storageKey: captured.storageKey,
                expiresAt: captured.expiresAt,
              },
            },
          }
          : {}),
      },
      include: { sent: true },
    });

    return {
      ok: true,
      status: updated.status,
      ...(captureNote ? { note: captureNote } : {}),
      sent: updated.sent
        ? {
          sentAt: updated.sent.sentAt,
          filename: updated.sent.filename,
          sha256: updated.sent.sha256,
          bytes: updated.sent.bytes,
          bulletCount: updated.sent.bullets.length,
          tailored: updated.sent.tailored,
          // Written once. Re-marking this application will not replace it.
          frozen: true,
        }
        : null,
    };
  });

  /** The document as it was sent — not as it would be rendered now. */
  app.get('/api/applications/:id/sent', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const { id } = req.params as { id: string };
    const row = await prisma.application.findFirst({
      where: { id, candidateId },
      include: { sent: true },
    });
    if (!row?.sent) {
      return reply.code(404).send({
        error: 'nothing archived for this application — it was either never marked '
          + 'applied, or nothing could be archived at the time',
      });
    }

    const bytes = await readArchive(row.sent.storageKey);
    if (!bytes) {
      // The record says a document was sent; if the bytes have since gone, the
      // honest answer is "gone" — never a freshly rendered substitute, which
      // would be a different document and would defeat the point entirely.
      return reply.code(410).send({ error: 'the archived file is no longer on disk' });
    }

    return reply
      .code(200)
      .header('content-type', row.sent.filename.endsWith('.pdf')
        ? 'application/pdf' : 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${row.sent.filename}"`)
      .header('cache-control', 'no-store')
      .send(bytes);
  });

  /** Applied, and nothing has moved since. */
  app.get('/api/followups', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const days = Number((req.query as { days?: string }).days ?? FOLLOW_UP_DAYS);
    const before = new Date(Date.now() - days * 86_400_000);

    const rows = await prisma.application.findMany({
      where: {
        candidateId,
        status: ApplicationStatus.APPLIED,
        sent: { sentAt: { lt: before } },
      },
      include: {
        job: { select: { title: true, company: true } },
        sent: { select: { sentAt: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });

    return {
      afterDays: days,
      rows: rows.map((r) => ({
        id: r.id,
        title: r.job.title,
        company: r.job.company,
        sentAt: r.sent?.sentAt ?? null,
        daysQuiet: r.sent
          ? Math.floor((Date.now() - r.sent.sentAt.getTime()) / 86_400_000)
          : null,
      })),
    };
  });

  /**
   * Forget an application.
   *
   * The archive goes with it. It serves the candidate's own memory of what
   * they sent — it is not a record we are obliged to keep, and there is no
   * lawful basis for holding a CV after they withdraw (§8).
   */
  app.delete('/api/applications/:id', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const { id } = req.params as { id: string };
    const row = await prisma.application.findFirst({
      where: { id, candidateId },
      include: { sent: { select: { storageKey: true } } },
    });
    if (!row) return reply.code(404).send({ error: 'no such application' });

    const key = row.sent?.storageKey;
    await prisma.application.delete({ where: { id: row.id } });

    // The row cascades; the bytes do not. Deleting one without the other
    // leaves the candidate's document on our disk after they asked us to
    // forget it, which is the part that actually matters.
    const bytesDeleted = key ? await forgetArchive(key) : false;

    return { ok: true, bytesDeleted };
  });
}
