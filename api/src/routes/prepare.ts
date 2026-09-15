import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/db.js';
import { compilePlan } from '../plan/plan.js';
import { tailor } from '../resume/tailor.js';
import { renderResume, resumeFilename } from '../resume/document.js';
import { loadBank, loadIndexed, loadPosting, loadProfile } from '../profile/load.js';
import { buildStarter } from '../compose/letter.js';

/**
 * Preparing one application.
 *
 * Three things a candidate needs before they open an employer's form: what we
 * can fill, what the résumé will say, and what only they can answer. Each is
 * computed from stored facts with no model and no browser.
 */

/** The single-candidate stand-in until accounts exist (FR-24). */
async function currentCandidateId(): Promise<string | null> {
  const c = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
  return c?.id ?? null;
}

export async function registerPrepareRoutes(app: FastifyInstance): Promise<void> {
  /** The fill plan: every action, with the source of its value recorded. */
  app.get('/api/jobs/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate profile yet' });

    const [posting, profile, bank] = await Promise.all([
      loadPosting(id), loadProfile(candidateId), loadBank(candidateId),
    ]);
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    if (!posting) {
      const job = await prisma.job.findUnique({ where: { id }, select: { formFetchedAt: true } });
      if (!job) return reply.code(404).send({ error: 'no such job' });
      // Not an error and not an empty plan: this vendor's form has not been
      // read, so there is nothing to pre-resolve and the candidate fills it on
      // the employer's site. Saying "0 fields" would be a lie about the form.
      return reply.code(200).send({
        formState: 'unknown',
        message: 'This posting publishes no form schema, so there is nothing to plan '
          + 'in advance. Everything else — match, tailoring, tracking — still works.',
      });
    }

    const plan = compilePlan(posting, profile, bank);

    // The planner deliberately drops optional profile questions the candidate
    // has left blank — "Address Line 2 (Optional)" is not a backlog item when
    // you are measuring coverage. For a candidate looking at their own answer
    // sheet it is different: a field they never see is a field they cannot
    // decide about. So the form's size and the plan's size are reported
    // separately, and the difference is named rather than absorbed.
    const formFields = (posting.questions ?? []).length;

    // A file action's value is a server path. The candidate needs to know which
    // document is going, not where it sits on our disk, so the filename is
    // substituted and the path never leaves the process.
    const attached = await prisma.resumeFile.findFirst({
      where: { candidateId, active: true },
      orderBy: { uploadedAt: 'desc' },
      select: { filename: true },
    });
    const bySource: Record<string, number> = {};
    for (const a of plan.actions) bySource[a.source] = (bySource[a.source] ?? 0) + 1;

    const deterministic = (bySource.profile ?? 0) + (bySource.bank ?? 0) + (bySource.file ?? 0);

    return {
      formState: 'readable',
      executable: plan.executable,
      counts: {
        formFields,
        planned: plan.actions.length,
        skippedOptionalBlank: formFields - plan.actions.length,
        deterministic,
        // Reported separately, never summed into "resolved": these are the
        // 17.7% only the candidate may answer, and the 8.4% that needs prose.
        needsWriting: plan.needsGeneration.length,
        needsCandidate: plan.needsUser.length,
        unresolved: plan.blockingUnresolved.length,
        bySource,
      },
      actions: plan.actions.map((a) => ({
        label: a.questionLabel,
        labelKey: a.labelKey,
        fieldName: a.fieldName,
        required: a.required,
        source: a.source,
        value: a.source === 'profile' || a.source === 'bank'
          ? a.value
          : a.source === 'file'
            ? (attached?.filename ?? null)
            : null,
        reason: a.reason ?? null,
      })),
    };
  });

  /** The tailored résumé, with its working shown. */
  app.get('/api/jobs/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate profile yet' });

    const [job, profile] = await Promise.all([loadIndexed(id), loadProfile(candidateId)]);
    if (!job) return reply.code(404).send({ error: 'no such job' });
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    const t = tailor(profile, job);
    return {
      integrity: t.integrity,
      bulletsKept: t.bulletsKept,
      bulletsAvailable: t.bulletsAvailable,
      coverage: t.coverage,
      roles: t.roles,
      text: t.text,
    };
  });

  /**
   * A starter for the one field a plan cannot resolve: prose.
   *
   * Verified facts, assembled into sentences, with a bracketed prompt wherever
   * only the candidate can supply the answer. It is deliberately unfinished —
   * a complete letter would be this app writing a claim on their behalf, which
   * is the one thing it does not do (FR-13, CLAUDE.md rule 1).
   */
  app.get('/api/jobs/:id/letter', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate profile yet' });

    const [job, profile] = await Promise.all([loadIndexed(id), loadProfile(candidateId)]);
    if (!job) return reply.code(404).send({ error: 'no such job' });
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    const starter = buildStarter(
      {
        boardToken: job.boardToken,
        company: job.company,
        title: job.title,
        location: job.location,
        absoluteUrl: job.absoluteUrl,
        // Requirements-section terms when the posting states requirements, the
        // whole posting when it does not — the same evidence split the scorer
        // uses, so the letter and the match score never disagree about what
        // the employer asked for.
        asks: job.facts.requiredSkills.length > 0 ? job.facts.requiredSkills : job.facts.skills,
      },
      profile,
    );

    return {
      starter,
      // Counted separately so the UI can be honest about the split: this many
      // sentences rest on facts they verified, and this many gaps are theirs
      // to close. A single "80% done" would flatter both numbers.
      grounded: starter.facts.length,
      yours: starter.placeholders.length,
    };
  });

  /** The same résumé as the PDF that would actually be attached. */
  app.get('/api/jobs/:id/resume.pdf', async (req, reply) => {
    const { id } = req.params as { id: string };
    const candidateId = await currentCandidateId();
    if (!candidateId) return reply.code(409).send({ error: 'no candidate profile yet' });

    const [job, profile] = await Promise.all([loadIndexed(id), loadProfile(candidateId)]);
    if (!job) return reply.code(404).send({ error: 'no such job' });
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    const t = tailor(profile, job);
    if (!t.integrity.allVerbatim) {
      // Refuse rather than attach. Every line is supposed to be the candidate's
      // own; if that stopped being true, the bug ships inside a document filed
      // in their name (CLAUDE.md rule 1).
      return reply.code(409).send({
        error: 'integrity check failed — refusing to render',
        notFound: t.integrity.notFound,
      });
    }

    const pdf = renderResume(t, profile);
    return reply
      .code(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${resumeFilename(profile, job.company)}"`)
      .header('cache-control', 'no-store')
      .send(pdf);
  });
}
