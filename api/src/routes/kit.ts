import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { compilePlan } from '../plan/plan.js';
import { buildKit } from '../kit/kit.js';
import { tailor } from '../resume/tailor.js';
import { buildStarter } from '../compose/letter.js';
import { loadBank, loadIndexed, loadPosting, loadProfile } from '../profile/load.js';

/**
 * Said to a person, not a developer.
 *
 * This used to read "run pnpm seed". That was harmless while the only
 * account was the seeded one on a laptop; the moment sign-up existed it
 * became the first thing a real candidate saw, telling them to run a build
 * command. An empty profile is the normal state of a new account, not a
 * fault, and the message says what to do about it.
 */
const NO_PROFILE = 'no profile yet — upload a résumé, or add your work history by hand';

export async function registerKitRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/jobs/:id/kit', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        absoluteUrl: true,
        formFetchedAt: true,
        formReadable: true,
      },
    });
    if (!job) return reply.code(404).send({ error: 'no such job' });

    const [indexed, profile, bank, posting] = await Promise.all([
      loadIndexed(id),
      loadProfile(candidateId),
      loadBank(candidateId),
      // Returns null when this vendor published no form. That is the FR-43
      // path, and it is a normal outcome rather than an error — a Kit still
      // ships, it just says plainly that these are not this employer's
      // questions.
      loadPosting(id),
    ]);

    if (!profile) return reply.code(409).send({ error: NO_PROFILE });
    if (!indexed) return reply.code(404).send({ error: 'no such job' });

    const plan = posting ? compilePlan(posting, profile, bank) : null;

    // Null, not zero, when we have no form to count. The Kit renders "unknown"
    // from this, and a 0 here would render as "this form asks nothing".
    const formFields = posting ? (posting.questions ?? []).length : null;

    const attached = await prisma.resumeFile.findFirst({
      where: { candidateId, active: true },
      orderBy: { uploadedAt: 'desc' },
      select: { filename: true },
    });

    const kit = buildKit({
      job,
      plan,
      formFields,
      tailored: tailor(profile, indexed),
      starter: buildStarter(
        {
          boardToken: indexed.boardToken,
          company: indexed.company,
          title: indexed.title,
          location: indexed.location,
          absoluteUrl: indexed.absoluteUrl,
          // The same evidence split the scorer uses, so the letter and the
          // match score never disagree about what the employer asked for.
          asks: indexed.facts.requiredSkills.length > 0
            ? indexed.facts.requiredSkills
            : indexed.facts.skills,
        },
        profile,
      ),
      bank,
      attachedFilename: attached?.filename ?? null,
    });

    return kit;
  });
}
