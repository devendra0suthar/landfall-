import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import {
  MAX_BYTES, ResumeRejected, deleteStored, readStored, storeResume,
} from '../profile/resume-store.js';

/**
 * The résumé file a candidate attaches.
 *
 * Every form in the sample asks for one, so this is the single highest-leverage
 * field there is: without it the file action on every plan resolves to
 * `unresolved` and readiness stops short no matter how complete the profile is.
 */

async function currentCandidateId(): Promise<string | null> {
  const c = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
  return c?.id ?? null;
}

export async function registerResumeRoutes(app: FastifyInstance): Promise<void> {
  // A résumé arrives as bytes, not JSON. Fastify parses application/json by
  // default and would choke on the first byte of a PDF.
  app.addContentTypeParser(
    ['application/pdf', 'application/octet-stream', 'application/msword', 'text/plain',
      'text/markdown', 'application/rtf', 'text/rtf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    { parseAs: 'buffer', bodyLimit: MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  /** Upload, and make it the one that gets attached. */
  app.post('/api/resume', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const name = String((req.query as { filename?: string }).filename ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'filename query parameter is required' });

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      return reply.code(415).send({
        error: 'send the file itself as the request body, with its content type',
      });
    }

    let stored;
    try {
      stored = await storeResume(body, name);
    } catch (err) {
      if (err instanceof ResumeRejected) return reply.code(400).send({ error: err.message });
      throw err;
    }

    // Exactly one active résumé per candidate (FR-4). Superseded files stay on
    // disk and in the table: an application sent last week must still be able
    // to name the document that went with it.
    const row = await prisma.$transaction(async (tx) => {
      await tx.resumeFile.updateMany({ where: { candidateId, active: true }, data: { active: false } });
      return tx.resumeFile.create({
        data: {
          candidateId,
          filename: name,
          contentType: req.headers['content-type'] ?? 'application/octet-stream',
          bytes: stored.bytes,
          sha256: stored.sha256,
          storageKey: stored.storageKey,
          active: true,
        },
      });
    });

    return {
      ok: true,
      resume: {
        id: row.id, filename: row.filename, bytes: row.bytes,
        sha256: row.sha256, uploadedAt: row.uploadedAt, active: true,
      },
    };
  });

  /** What is on file, newest first. */
  app.get('/api/resumes', async (_req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const rows = await prisma.resumeFile.findMany({
      where: { candidateId },
      orderBy: { uploadedAt: 'desc' },
    });

    return {
      count: rows.length,
      rows: rows.map((r) => ({
        id: r.id, filename: r.filename, bytes: r.bytes, sha256: r.sha256,
        uploadedAt: r.uploadedAt, active: r.active,
      })),
    };
  });

  /** The active file itself, so a candidate can check what we would attach. */
  app.get('/api/resume', async (_req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const row = await prisma.resumeFile.findFirst({
      where: { candidateId, active: true },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!row) return reply.code(404).send({ error: 'no résumé on file' });

    const bytes = await readStored(row.storageKey);
    if (!bytes) {
      // The row says a file exists and the disk disagrees. Say so plainly
      // rather than 404ing as though nothing was ever uploaded.
      return reply.code(410).send({
        error: 'the stored file is gone — upload it again',
        filename: row.filename,
      });
    }

    return reply
      .code(200)
      .header('content-type', row.contentType)
      .header('content-disposition', `inline; filename="${row.filename.replace(/"/g, '')}"`)
      .header('cache-control', 'no-store')
      .send(bytes);
  });

  /**
   * Stop attaching a résumé.
   *
   * Deletes the bytes only when no other row still points at them — uploads are
   * content-addressed, so two rows can share one file, and one candidate
   * removing theirs must not delete an application's archived attachment.
   */
  app.delete('/api/resume/:id', async (req, reply) => {
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate yet' });

    const { id } = req.params as { id: string };
    const row = await prisma.resumeFile.findFirst({ where: { id, candidateId } });
    if (!row) return reply.code(404).send({ error: 'no such résumé' });

    await prisma.resumeFile.delete({ where: { id: row.id } });

    const stillReferenced = await prisma.resumeFile.count({
      where: { storageKey: row.storageKey },
    });
    if (stillReferenced === 0) await deleteStored(row.storageKey);

    return { ok: true, deletedBytes: stillReferenced === 0 };
  });
}
