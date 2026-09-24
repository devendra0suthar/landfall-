import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import type { AnswerBank, CandidateProfile } from '../plan/types.js';
import type { JobPosting, FormQuestion, FieldKind } from '../ingest/types.js';
import type { IndexedJob } from '../jobs/indexer.js';
import { extractFacts } from '../jobs/extract.js';
import { pathFor } from './resume-store.js';

/**
 * The bridge between rows and the planning modules.
 *
 * Phase 0's planner, tailor and answer bank all speak `CandidateProfile`,
 * `JobPosting` and `AnswerBank` — shapes proved against 541 postings. Rather
 * than rewrite them to take Prisma models (and re-open every question those
 * 541 postings already answered), the database is mapped onto those shapes
 * here, in one place. When the shapes disagree, this file is where it shows.
 */

export async function loadProfile(candidateId: string): Promise<CandidateProfile | null> {
  const row = await prisma.profile.findUnique({
    where: { candidateId },
    include: {
      roles: {
        orderBy: { position: 'asc' },
        include: { bullets: { orderBy: { position: 'asc' } } },
      },
    },
  });
  if (!row) return null;

  // A variant overrides only what is about *aim* — never contact details or
  // work history, which have exactly one home each (docs/REQUIREMENTS.md §5).
  const variant = await prisma.variant.findFirst({
    where: { candidateId, active: true },
  });

  const resume = await prisma.resumeFile.findFirst({
    where: { candidateId, active: true },
    orderBy: { uploadedAt: 'desc' },
  });

  // "Current company" is asked on ~650 indexed forms and nothing ever set it,
  // so it was always open even for someone whose confirmed history says where
  // they work. It is read from the one role they confirmed as ongoing — and
  // only when there is exactly one: two open roles, or none, is not a single
  // fact, and guessing the "main" employer would be answering for them.
  const ongoing = row.roles.filter((r) => !r.end);
  const currentCompany = ongoing.length === 1 ? ongoing[0]!.company : null;

  return {
    ...(currentCompany ? { currentCompany } : {}),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone ?? '',
    ...(row.location ? { location: row.location } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(row.country ? { country: row.country } : {}),
    ...(row.postalCode ? { postalCode: row.postalCode } : {}),
    ...(row.linkedin ? { linkedin: row.linkedin } : {}),
    ...(row.github ? { github: row.github } : {}),
    ...(row.website ? { website: row.website } : {}),
    ...(variant?.currentTitle ?? row.currentTitle
      ? { currentTitle: variant?.currentTitle ?? row.currentTitle ?? undefined }
      : {}),
    // The executor attaches a file, so the profile carries a path rather than
    // the storage key. Resolving it here keeps every other module unaware of
    // where résumés are kept.
    ...(resume && pathFor(resume.storageKey) ? { resumePath: pathFor(resume.storageKey)! } : {}),
    skills: variant && variant.skills.length > 0 ? variant.skills : row.skills,
    ...(row.yearsExperience !== null ? { yearsExperience: row.yearsExperience } : {}),
    experience: row.roles.map((r) => ({
      title: r.title,
      company: r.company,
      start: r.start,
      ...(r.end ? { end: r.end } : {}),
      ...(r.location ? { location: r.location } : {}),
      bullets: r.bullets.map((b) => b.text),
    })),
  };
}

export async function loadBank(candidateId: string): Promise<AnswerBank> {
  const rows = await prisma.bankAnswer.findMany({ where: { candidateId } });
  // `text` is the field the planner reads — not `value`. Getting this wrong
  // costs nothing loudly: every lookup still matches on labelKeys, so the bank
  // looks wired while resolving nothing, and the plan quietly routes every
  // banked question to the candidate instead.
  return { answers: rows.map((r) => ({ labelKeys: [r.labelKey], text: r.value })) };
}

/**
 * A stored job as the planner expects it.
 *
 * Returns null when we have never read the form: the planner's job is to
 * compile a *known* set of questions, and handing it an empty array would
 * produce a confident plan for a form nobody has seen (the unknown-versus-none
 * distinction the schema keeps).
 */
export async function loadPosting(jobId: string): Promise<JobPosting | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      board: { select: { slug: true } },
      questions: { orderBy: { position: 'asc' } },
    },
  });
  if (!job) return null;
  return postingFromRow(job);
}

/**
 * The same conversion for a row already loaded with its board and questions,
 * so a caller preparing many postings (the run) can fetch them in one query
 * rather than one per posting.
 */
export function postingFromRow(job: Prisma.JobGetPayload<{
  include: { board: { select: { slug: true } }; questions: true };
}>): JobPosting | null {
  if (!job.formFetchedAt) return null;

  const questions: FormQuestion[] = job.questions.map((q) => ({
    label: q.label,
    labelKey: q.labelKey,
    answerability: q.answerability as FormQuestion['answerability'],
    required: q.required,
    fields: [{
      name: q.fieldName,
      kind: q.kind as FieldKind,
      ...(q.options ? { options: q.options as never } : {}),
    }],
  }));

  return {
    vendor: 'greenhouse',
    boardToken: job.board.slug,
    vendorJobId: job.externalId,
    title: job.title,
    absoluteUrl: job.absoluteUrl,
    location: job.location,
    updatedAt: job.postedAt ? job.postedAt.toISOString() : null,
    questions,
  };
}

/**
 * A stored job as the tailor expects it.
 *
 * Tailoring needs only the posting's facts — which terms it asks for — so this
 * rebuilds them from the stored description rather than re-fetching. Available
 * for every job, form or no form: a résumé can be tailored to a posting whose
 * application form we cannot read.
 */
export async function loadIndexed(jobId: string): Promise<IndexedJob | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { board: { select: { slug: true } } },
  });
  return job ? toIndexed(job, job.board.slug) : null;
}

/** Exactly the columns `toIndexed` reads — nothing else is needed to score. */
export interface JobRowForScoring {
  id: string;
  externalId: string;
  company: string;
  title: string;
  absoluteUrl: string;
  location: string | null;
  postedAt: Date | null;
  description: string | null;
  skills: string[];
  requiredSkills: string[];
  formReadable: boolean;
}

/**
 * The same mapping, without a query.
 *
 * Pure so the list endpoint can score sixty postings out of one `findMany`
 * rather than sixty round trips.
 */
export function toIndexed(job: JobRowForScoring, boardSlug: string): IndexedJob {
  const facts = extractFacts(`${job.title}\n${job.description ?? ''}`, '');

  return {
    id: job.id,
    vendor: 'greenhouse',
    boardToken: boardSlug,
    vendorJobId: job.externalId,
    company: job.company,
    title: job.title,
    absoluteUrl: job.absoluteUrl,
    location: job.location,
    department: null,
    office: null,
    updatedAt: job.postedAt ? job.postedAt.toISOString() : null,
    firstPublished: job.postedAt ? job.postedAt.toISOString() : null,
    // The stored columns win over a re-extraction: they were computed from the
    // full description HTML at ingest, which is no longer here.
    facts: { ...facts, skills: job.skills, requiredSkills: job.requiredSkills },
    formReadable: job.formReadable,
  } as IndexedJob;
}
