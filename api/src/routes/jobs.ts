import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { loadBank, loadPosting, loadProfile, toIndexed } from '../profile/load.js';
import { scoreJob } from '../score/score.js';
import { compilePlan } from '../plan/plan.js';
import { parsePostingUrl } from '../ingest/resolve.js';

/**
 * Reading the index.
 *
 * Two numbers travel with every posting and are never combined: `match` is an
 * inference about the job, `readiness` is how much of its form we can fill.
 * Averaging them would hide exactly the distinction a candidate needs
 * (docs/REQUIREMENTS.md FR-8).
 */

const Query = z.object({
  country: z.string().trim().min(1).optional(),
  remote: z.enum(['true', 'false']).optional(),
  postedWithinDays: z.coerce.number().int().positive().max(365).optional(),
  formReadable: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/jobs', async (req, reply) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad query' });
    }
    const q = parsed.data;

    const since = q.postedWithinDays
      ? new Date(Date.now() - q.postedWithinDays * 86_400_000)
      : undefined;

    const candidate = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
    const profile = candidate ? await loadProfile(candidate.id) : null;

    const jobs = await prisma.job.findMany({
      where: {
        ...(q.country ? { country: q.country } : {}),
        ...(q.remote ? { remote: q.remote === 'true' } : {}),
        ...(q.formReadable ? { formReadable: q.formReadable === 'true' } : {}),
        ...(since ? { postedAt: { gte: since } } : {}),
        board: { disabled: false },
      },
      orderBy: [{ postedAt: 'desc' }, { fetchedAt: 'desc' }],
      take: q.limit,
      include: {
        board: { select: { vendor: true, slug: true } },
        _count: { select: { questions: true } },
      },
    });

    return {
      count: jobs.length,
      // Match needs a profile to compare against. With none, every row says so
      // rather than showing a zero that reads like "bad fit".
      scored: profile !== null,
      rows: jobs.map((j) => {
        const match = profile
          ? scoreJob(toIndexed(j, j.board.slug), null, profile).match
          : null;
        return ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          country: j.country,
          remote: j.remote,
          remoteScope: j.remoteScope,
          vendor: j.board.vendor,
          url: j.absoluteUrl,
          postedAt: j.postedAt,
          skills: j.skills,
          requiredSkills: j.requiredSkills,
          // Three states, not two: a number once we have read the form, 0 when
          // the vendor published none, and null when we have not looked yet.
          questionCount: j.formFetchedAt ? j._count.questions : null,
          formState: j.formFetchedAt ? (j.formReadable ? 'readable' : 'not-published') : 'unknown',
          // Two scores, never combined (FR-8). Readiness is not computed here:
          // it needs the form compiled, which is a per-posting cost, so the
          // list carries match and the detail view carries both.
          match: match ? { score: match.score, confidence: match.confidence } : null,
        });
      }),
    };
  });

  /**
   * Which indexed posting is this page?
   *
   * Registered before /api/jobs/:id so "resolve" is never read as an id. The
   * extension calls this with the tab's URL, which removes the one step a
   * candidate should never have to do: find an internal id in one window and
   * type it into another.
   */
  app.get('/api/jobs/resolve', async (req, reply) => {
    const url = String((req.query as { url?: string }).url ?? '');
    const ref = parsePostingUrl(url);
    if (!ref) {
      return reply.code(422).send({
        error: 'that does not look like a job posting Landfall can read',
        url,
      });
    }

    const job = await prisma.job.findFirst({
      where: {
        externalId: ref.vendorJobId,
        board: { slug: ref.boardToken, vendor: 'GREENHOUSE' },
      },
      select: { id: true, title: true, company: true, formFetchedAt: true, formReadable: true },
    });

    if (!job) {
      // Parsed fine, simply not indexed here. A different answer from "we
      // cannot read this URL", and the candidate can act on it.
      return reply.code(404).send({
        error: 'Landfall has not indexed this posting yet',
        ...ref,
      });
    }

    return {
      ...ref,
      jobId: job.id,
      title: job.title,
      company: job.company,
      formState: job.formFetchedAt ? (job.formReadable ? 'readable' : 'not-published') : 'unknown',
    };
  });

  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        board: { select: { vendor: true, slug: true, submitAllowed: true } },
        questions: { orderBy: { position: 'asc' } },
      },
    });
    if (!job) return reply.code(404).send({ error: 'no such job' });

    const candidate = await prisma.candidate.findFirst({ orderBy: { createdAt: 'asc' } });
    const profile = candidate ? await loadProfile(candidate.id) : null;

    // Readiness needs the form compiled; match does not. Computing the plan
    // here is what makes the detail view able to show both.
    let score = null;
    if (profile && candidate) {
      const [posting, bank] = await Promise.all([loadPosting(id), loadBank(candidate.id)]);
      const plan = posting ? compilePlan(posting, profile, bank) : null;
      score = scoreJob(toIndexed(job, job.board.slug), plan, profile);
    }

    return {
      score: score
        ? {
          match: {
            score: score.match.score,
            confidence: score.match.confidence,
            signals: score.match.signals,
            haveSkills: score.match.haveSkills,
            missingSkills: score.match.missingSkills,
            basis: score.match.basis,
          },
          readiness: score.readiness,
        }
        : null,
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        country: job.country,
        remote: job.remote,
        remoteScope: job.remoteScope,
        url: job.absoluteUrl,
        postedAt: job.postedAt,
        description: job.description,
        skills: job.skills,
        requiredSkills: job.requiredSkills,
        vendor: job.board.vendor,
        formReadable: job.formReadable,
        // Tier C is allowlisted and ships empty, so this is false everywhere
        // until somebody deliberately changes it (§3.4).
        submitAllowed: job.board.submitAllowed,
      },
      questions: job.questions.map((q) => ({
        id: q.id,
        label: q.label,
        fieldName: q.fieldName,
        kind: q.kind,
        required: q.required,
        options: q.options,
      })),
    };
  });
}
