import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { readStored } from '../profile/resume-store.js';
import { UnreadableResume, extractResumeText, parseResume } from '../profile/parse.js';

/**
 * Read the uploaded résumé and propose a profile.
 *
 * Proposes. Nothing here is written: the response is a draft with a confidence
 * on every field, and it becomes fact only when the candidate confirms it
 * through PUT /api/profile. That separation is the whole design — a parser
 * that writes directly is a parser deciding what is true about someone.
 */

export async function registerParseRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/resume/parse', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const resume = await prisma.resumeFile.findFirst({
      where: { candidateId: candidateId, active: true },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!resume) return reply.code(404).send({ error: 'no résumé on file to read' });

    const bytes = await readStored(resume.storageKey);
    if (!bytes) return reply.code(410).send({ error: 'the stored file is gone — upload it again' });

    let text: string;
    try {
      text = await extractResumeText(bytes, resume.filename);
    } catch (err) {
      if (err instanceof UnreadableResume) {
        // Not a server error: an image-only PDF is a perfectly normal file that
        // simply has no text layer. The candidate is told what to do instead.
        return reply.code(422).send({ error: err.message, readable: false });
      }
      throw err;
    }

    const parsed = parseResume(text);

    return {
      source: { filename: resume.filename, bytes: resume.bytes, sha256: resume.sha256 },
      parsed,
      // Said plainly on every response, because a parse result that looks
      // authoritative is the failure this endpoint is designed against.
      note: 'Nothing here has been saved. Check each field — especially the flagged ones — '
        + 'and confirm it before any of it becomes part of your profile.',
    };
  });
}
