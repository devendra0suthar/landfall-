import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireCandidate } from '../auth/session.js';
import { analyseResume } from '../analyze/analyze.js';
import { extractFacts } from '../jobs/extract.js';
import { tailor } from '../resume/tailor.js';
import { loadProfile } from '../profile/load.js';
import type { IndexedJob } from '../jobs/indexer.js';

/**
 * Analysis against any job description, pasted from anywhere.
 *
 * The limitation this removes: every other screen in Landfall works only on
 * postings in our own index. A candidate who found a role on LinkedIn, or was
 * sent one by a recruiter, or is looking at an employer's own careers page,
 * could not use the product at all — which is most of how people actually find
 * jobs. Pasting the description routes it through exactly the same extractor,
 * scorer and tailor as an indexed posting, so the answer is the same answer.
 *
 * Nothing is stored. A pasted description is not a posting we ingested, we make
 * no claim to have read the employer's form, and adding it to the index would
 * put an unverified row next to 2,400 verified ones.
 */

const Body = z.object({
  /** The job description, pasted. */
  jobDescription: z.string().trim().min(40).max(40_000).optional(),
  /** Optional — improves level and workplace detection, which read the title. */
  title: z.string().trim().max(300).optional(),
});

export async function registerAnalyzeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/analyze', async (req, reply) => {
    const parsed = Body.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'a job description needs at least 40 characters',
        detail: parsed.error.issues[0]?.message,
      });
    }
    const { jobDescription, title } = parsed.data;

    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;
    const profile = await loadProfile(candidateId);
    if (!profile) return reply.code(409).send({ error: 'no candidate profile yet' });

    // No description is a valid request: it scores the résumé on its own terms,
    // which is what a candidate wants before they have a specific job in mind.
    // The keyword category reports itself as unjudgeable rather than scoring 0.
    const facts = jobDescription
      ? extractFacts(`${title ?? ''}\n${jobDescription}`, jobDescription)
      : null;

    const analysis = analyseResume(profile, facts, title ?? null);

    // Tailoring needs a posting shape. Built here rather than stored — see the
    // note above about not putting unverified rows in the index.
    const tailored = facts
      ? tailor(profile, {
        facts: { requiredSkills: facts.requiredSkills, skills: facts.skills },
      } as Pick<IndexedJob, 'facts'>)
      : null;

    return {
      analysis,
      /** What the extractor understood, so a bad paste is visible as one. */
      readJob: facts
        ? {
          title: title ?? null,
          skills: facts.skills,
          requiredSkills: facts.requiredSkills,
          requirementsFound: facts.requirementsFound,
          level: facts.level,
          workplace: facts.workplace,
          years: facts.years,
          characters: facts.descriptionChars,
        }
        : null,
      tailored: tailored
        ? {
          integrityOk: tailored.integrity.allVerbatim,
          bulletsKept: tailored.bulletsKept,
          bulletsAvailable: tailored.bulletsAvailable,
          roles: tailored.roles,
          text: tailored.text,
        }
        : null,
    };
  });
}
