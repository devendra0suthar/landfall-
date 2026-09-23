import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { sessionFromRequest } from '../auth/session.js';
import { eligibilityWhere } from '../jobs/eligibility.js';
import { rankedJobIds } from '../jobs/ranking.js';
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
  /**
   * Hide postings that demonstrably exclude this candidate — remote roles
   * scoped to a country they are not in, and on-site roles somewhere else.
   * Needs a signed-in profile with a country; without one it does nothing,
   * because there is no basis on which to hide anything.
   */
  eligible: z.enum(['true', 'false']).optional(),
  /**
   * How to order the page. 'match' needs a profile to compare against, so it
   * falls back to 'recent' without one rather than pretending to rank.
   */
  sort: z.enum(['match', 'recent']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  /**
   * Where to start. The index is bigger than one page and was previously
   * unreachable past the first 200 rows — with no way to page, "260 open roles"
   * was a number you could read but not get to.
   */
  offset: z.coerce.number().int().min(0).default(0),
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

    // Browsing needs no account (FR-24). Match scores need a profile, so a
    // signed-out visitor gets the index with `match: null` rather than a 401.
    const session = await sessionFromRequest(req);
    const profile = session ? await loadProfile(session.candidateId) : null;

    // The profile's own timestamp, which is what makes caching a ranking safe:
    // editing a profile is the only thing that can change a score, and it moves
    // this value, so a stale ranking cannot be served — only evicted.
    const profileStamp = session
      ? (await prisma.profile.findUnique({
        where: { candidateId: session.candidateId },
        select: { updatedAt: true },
      }))?.updatedAt.toISOString() ?? null
      : null;

    // Eligibility can only be applied against a profile with a country on it.
    // Asking for it without one is not an error — it simply has no basis, and
    // `eligibilityApplied` in the reply says so rather than letting the screen
    // claim a filter that did nothing.
    const eligibility = q.eligible === 'true' && profile ? eligibilityWhere(profile) : {};
    const eligibilityApplied = Object.keys(eligibility).length > 0;

    const where = {
      ...(q.country ? { country: q.country } : {}),
      ...(q.remote ? { remote: q.remote === 'true' } : {}),
      ...(q.formReadable ? { formReadable: q.formReadable === 'true' } : {}),
      ...(since ? { postedAt: { gte: since } } : {}),
      ...eligibility,
      board: { disabled: false },
    };

    // Counted separately from the page, because `count` used to be
    // `jobs.length` — the size of the page, not of the result. A filter that
    // matched 900 roles and a filter that matched 50 both reported "50" at the
    // default limit, so the number on screen told a candidate nothing about
    // how much they had not seen.
    // Best fit first when there is a profile to fit against. Sorting by date is
    // the right default for an anonymous visitor and the wrong one for everyone
    // else: with 2,563 eligible postings and a 60-row page, a newest-first list
    // buries every good match, and the client re-sorting the rows it happens to
    // have loaded cannot fix that.
    const wantMatch = (q.sort ?? (profile ? 'match' : 'recent')) === 'match' && profile !== null;

    const rowInclude = {
      board: { select: { vendor: true, slug: true } },
      _count: { select: { questions: true } },
    };

    let total: number;
    let jobs: Awaited<ReturnType<typeof prisma.job.findMany<{ include: typeof rowInclude }>>>;

    if (wantMatch && profile) {
      // The ranking is computed once per profile and filter, then paged. See
      // jobs/ranking.ts for why it cannot be an ORDER BY.
      const ranked = await rankedJobIds(
        session!.candidateId,
        profile,
        profileStamp ?? '',
        where,
      );
      total = ranked.length;
      const pageIds = ranked.slice(q.offset, q.offset + q.limit);
      const rows = pageIds.length === 0 ? [] : await prisma.job.findMany({
        where: { id: { in: pageIds } },
        include: rowInclude,
      });
      // `IN` returns rows in whatever order it likes, so the ranking is
      // reapplied here — otherwise the page is sorted and its contents are not.
      const byId = new Map(rows.map((r) => [r.id, r]));
      jobs = pageIds.map((id) => byId.get(id)).filter((r): r is typeof rows[number] => r !== undefined);
    } else {
      [total, jobs] = await Promise.all([
        prisma.job.count({ where }),
        prisma.job.findMany({
          where,
          orderBy: [{ postedAt: 'desc' }, { fetchedAt: 'desc' }],
          skip: q.offset,
          take: q.limit,
          include: rowInclude,
        }),
      ]);
    }

    return {
      /** Rows on this page. */
      count: jobs.length,
      /** Rows matching the filter, of which this page is a slice. */
      total,
      offset: q.offset,
      limit: q.limit,
      hasMore: q.offset + jobs.length < total,
      // Match needs a profile to compare against. With none, every row says so
      // rather than showing a zero that reads like "bad fit".
      scored: profile !== null,
      /** 'match' or 'recent' — so the screen can say how the list is ordered. */
      sortedBy: wantMatch ? 'match' : 'recent',
      /**
       * Whether the eligibility filter actually did anything. Asking for it
       * with no country on the profile is a no-op, and a screen that showed
       * the toggle as on while every ineligible role stayed in the list would
       * be lying about what it had filtered.
       */
      eligibilityApplied,
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

    // Browsing needs no account (FR-24). Match scores need a profile, so a
    // signed-out visitor gets the index with `match: null` rather than a 401.
    const session = await sessionFromRequest(req);
    const profile = session ? await loadProfile(session.candidateId) : null;

    // Readiness needs the form compiled; match does not. Computing the plan
    // here is what makes the detail view able to show both.
    let score = null;
    if (profile && session) {
      const [posting, bank] = await Promise.all([loadPosting(id), loadBank(session.candidateId)]);
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
