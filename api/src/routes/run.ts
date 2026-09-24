import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { loadBank, loadPosting, loadProfile } from '../profile/load.js';
import { compilePlan } from '../plan/plan.js';
import { eligibilityWhere } from '../jobs/eligibility.js';
import { rankedJobIds } from '../jobs/ranking.js';
import { scoreJob } from '../score/score.js';
import { toIndexed } from '../profile/load.js';
import { runRow } from '../run/run.js';

/**
 * A worklist: your best matches, all prepared, in one pass.
 *
 * The complaint this answers is that Landfall made you do everything one job at
 * a time — open a posting, read a Kit, go back, pick another — while the
 * products it is compared to say "set your preferences and we apply while you
 * sleep". The difference people actually feel there is **batching**, not
 * autonomy: one decision covering many applications instead of one decision per
 * application.
 *
 * Batching is available to us. Submitting is not, and stays not (CLAUDE.md
 * rule 4) — our servers never file an application. So this prepares a run:
 * the top matches you can actually take, each with its form already compiled,
 * so what is left is a list you work down rather than a search you repeat.
 *
 * **It reports what it could not prepare.** A run of ten that silently returns
 * six is the same failure as a Kit that presents an unread form as having no
 * questions (rule 7): the number on screen has to mean what it says.
 */

const Query = z.object({
  limit: z.coerce.number().int().positive().max(25).default(10),
  /** Only postings whose form we can actually fill. On by default. */
  fillable: z.enum(['true', 'false']).optional(),
}).strict();

export interface RunItem {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  match: number;
  /** Answers we can put on the form from facts they confirmed. */
  prepared: number;
  /** Questions only they may answer — consent, attestation, demographics. */
  yours: number;
  /** Asked, and we have nothing for it yet. */
  open: number;
  /** Fields on the employer's form, or null when we have not read it. */
  fields: number | null;
  /** Whether they have already marked this one as applied. */
  applied: boolean;
}

export async function registerRunRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/run', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;

    const parsed = Query.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad query' });
    }
    const { limit } = parsed.data;
    const fillable = parsed.data.fillable !== 'false';

    const profile = await loadProfile(candidateId);
    if (!profile) {
      return reply.code(409).send({
        error: 'no profile yet — upload a résumé, or add your work history by hand',
      });
    }

    const stamp = (await prisma.profile.findUnique({
      where: { candidateId },
      select: { updatedAt: true },
    }))?.updatedAt.toISOString() ?? '';

    const where = {
      ...eligibilityWhere(profile),
      ...(fillable ? { formReadable: true } : {}),
      board: { disabled: false },
    };

    const { ids } = await rankedJobIds(candidateId, profile, stamp, where);

    // Jobs already marked applied are skipped rather than filtered on screen:
    // a worklist that keeps handing back work you finished is not a worklist.
    const done = new Set(
      (await prisma.application.findMany({
        where: { candidateId, status: { in: ['APPLIED', 'SKIPPED'] } },
        select: { jobId: true },
      })).map((a) => a.jobId),
    );

    const take = ids.filter((id) => !done.has(id)).slice(0, limit);
    const bank = await loadBank(candidateId);
    // The same question the Kit asks, so a résumé field with nothing behind it
    // is open here too rather than counted as prepared.
    const hasAttachment = (await prisma.resumeFile.count({
      where: { candidateId, active: true },
    })) > 0;

    const items: RunItem[] = [];
    const couldNotPrepare: Array<{ jobId: string; reason: string }> = [];

    for (const id of take) {
      const job = await prisma.job.findUnique({
        where: { id },
        include: { board: { select: { slug: true } } },
      });
      if (!job) { couldNotPrepare.push({ jobId: id, reason: 'no longer indexed' }); continue; }

      const posting = await loadPosting(id);
      const plan = posting ? compilePlan(posting, profile, bank) : null;

      // The same buckets the Kit uses, from the same function — a run that
      // disagreed with the Kit it links to would be worse than no run at all.
      const row = runRow({
        job,
        plan,
        questions: posting?.questions?.length ?? 0,
        hasAttachment,
      });
      if (!row.ok || !plan) {
        couldNotPrepare.push({ jobId: id, reason: row.ok ? 'no longer indexed' : row.reason });
        continue;
      }

      items.push({
        jobId: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.absoluteUrl,
        // Recomputed rather than carried out of the ranking: it is 0.01ms a row
        // now that the facts are columns, and one source for the number means
        // the run and the list cannot disagree about it.
        match: scoreJob(toIndexed(job as never, job.board.slug), plan, profile).match.score,
        ...row.counts,
        applied: false,
      });
    }

    return reply.send({
      items,
      /** Named, not silently dropped. See the header comment. */
      couldNotPrepare,
      requested: limit,
      /** How many eligible, fillable, not-yet-applied postings exist in total. */
      available: ids.filter((id) => !done.has(id)).length,
      totals: {
        prepared: items.reduce((n, i) => n + i.prepared, 0),
        yours: items.reduce((n, i) => n + i.yours, 0),
        open: items.reduce((n, i) => n + i.open, 0),
      },
    });
  });
}
