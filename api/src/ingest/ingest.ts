import { Vendor } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { extractFacts, htmlToText, remoteScopeOf } from '../jobs/extract.js';
import { fetchForm, listJobsChecked, probeBoard } from './greenhouse.js';
import type { JobPosting } from './types.js';

/**
 * Pull one employer's board into the index.
 *
 * Greenhouse is the whole of v0 because it is the only vendor that publishes a
 * complete form schema without auth and without a browser — 541 of 541 in the
 * Phase 0 sample. Everything here assumes that; the runtime-discovery path for
 * Workday and friends is a different engine, not a flag on this one
 * (docs/REQUIREMENTS.md §2).
 */

export interface IngestResult {
  board: string;
  ok: boolean;
  status: number;
  jobsSeen: number;
  jobsWritten: number;
  formsRead: number;
  questionsWritten: number;
  /** Postings no longer on the board, marked closed by this pass. */
  jobsClosed: number;
  skipped: string[];
}

/** How many postings we pull form schemas for in one pass. */
const FORM_BATCH = 25;

export async function ingestBoard(
  boardToken: string,
  opts: { forms?: number } = {},
): Promise<IngestResult> {
  const probe = await probeBoard(boardToken);
  const result: IngestResult = {
    board: boardToken,
    ok: probe.ok,
    status: probe.status,
    jobsSeen: 0,
    jobsWritten: 0,
    jobsClosed: 0,
    formsRead: 0,
    questionsWritten: 0,
    skipped: [],
  };
  if (!probe.ok) return result;

  const board = await prisma.board.upsert({
    where: { vendor_slug: { vendor: Vendor.GREENHOUSE, slug: boardToken } },
    create: { vendor: Vendor.GREENHOUSE, slug: boardToken, name: boardToken },
    update: { lastFetchedAt: new Date() },
  });

  // A disabled destination stops being fetched at all. This is the switch that
  // answers an employer asking us to stop (FR-36), so it is checked before any
  // further request — not just before submitting.
  if (board.disabled) {
    result.skipped.push('board is disabled');
    return result;
  }

  const { reached, postings } = await listJobsChecked(boardToken);
  result.jobsSeen = postings.length;

  const wanted = postings.slice(0, opts.forms ?? FORM_BATCH);

  for (const posting of postings) {
    const withForm = wanted.includes(posting) ? await fetchForm(posting) : posting;
    const written = await writeJob(board.id, withForm);
    result.jobsWritten += 1;
    if (written.formRead) {
      result.formsRead += 1;
      result.questionsWritten += written.questionCount;
    }
  }

  // Postings the employer has taken down. Marked, never deleted: applications
  // point at them, and a job that reappears is simply reopened by writeJob.
  const close = postingsToClose(reached, postings.map((p) => p.vendorJobId));
  if (close.act) {
    const closed = await prisma.job.updateMany({
      where: { boardId: board.id, closedAt: null, externalId: { notIn: close.stillListed } },
      data: { closedAt: new Date() },
    });
    result.jobsClosed = closed.count;
  } else {
    result.skipped.push(close.why);
  }

  await prisma.board.update({
    where: { id: board.id },
    data: { lastFetchedAt: new Date() },
  });

  return result;
}

/**
 * Whether this pass may close anything, and against which list.
 *
 * Only when the board was actually reached AND returned postings. An empty
 * listing from a board that had hundreds yesterday is far more likely a
 * vendor hiccup than an employer closing every role at once — and wrongly
 * closing them hides real openings, which is worse than leaving a closed one
 * visible for another day. Timid on purpose, like the eligibility filter.
 */
export function postingsToClose(
  reached: boolean,
  listedIds: string[],
): { act: true; stillListed: string[] } | { act: false; why: string } {
  if (!reached) return { act: false, why: 'board unreachable — nothing closed' };
  if (listedIds.length === 0) return { act: false, why: 'listing came back empty — nothing closed' };
  return { act: true, stillListed: listedIds };
}

async function writeJob(
  boardId: string,
  posting: JobPosting,
): Promise<{ formRead: boolean; questionCount: number }> {
  const html = posting.content ?? '';
  const body = htmlToText(html);
  const facts = extractFacts(`${posting.title}\n${body}`, html);
  const location = posting.location ?? null;

  const job = await prisma.job.upsert({
    where: { boardId_externalId: { boardId, externalId: posting.vendorJobId } },
    create: {
      boardId,
      externalId: posting.vendorJobId,
      title: posting.title,
      // The board token is a slug ("addepar1"); the employer has an actual
      // name and the vendor publishes it. A candidate should never see a slug
      // on a résumé filename or in a letter salutation.
      company: posting.companyName ?? posting.boardToken,
      location,
      country: countryOf(location),
      remote: facts.workplace === 'remote',
      remoteScope: location ? remoteScopeOf(location, body) : null,
      absoluteUrl: posting.absoluteUrl,
      postedAt: posting.updatedAt ? new Date(posting.updatedAt) : null,
      description: facts.summary,
      skills: facts.skills,
      requiredSkills: facts.requiredSkills,
      // Kept so ranking never has to re-parse the description: 98% of the cost
      // of ordering the index was re-deriving exactly these three values.
      level: facts.level,
      workplace: facts.workplace,
      yearsRequired: facts.years,
      formReadable: Array.isArray(posting.questions),
      formFetchedAt: Array.isArray(posting.questions) ? new Date() : null,
    },
    update: {
      // Listed again, so open again — a posting that was briefly delisted
      // (an edit, a re-post) must not stay hidden forever.
      closedAt: null,
      title: posting.title,
      company: posting.companyName ?? posting.boardToken,
      location,
      country: countryOf(location),
      remote: facts.workplace === 'remote',
      remoteScope: location ? remoteScopeOf(location, body) : null,
      postedAt: posting.updatedAt ? new Date(posting.updatedAt) : null,
      description: facts.summary,
      skills: facts.skills,
      requiredSkills: facts.requiredSkills,
      // Kept so ranking never has to re-parse the description: 98% of the cost
      // of ordering the index was re-deriving exactly these three values.
      level: facts.level,
      workplace: facts.workplace,
      yearsRequired: facts.years,
      // Never downgrade a form we have already read back to 'unknown'
      // because this pass did not re-fetch it.
      ...(Array.isArray(posting.questions)
        ? { formReadable: true, formFetchedAt: new Date() }
        : {}),
      fetchedAt: new Date(),
    },
  });

  if (!Array.isArray(posting.questions)) return { formRead: false, questionCount: 0 };

  const questionCount = await storeQuestions(job.id, posting.questions);
  return { formRead: true, questionCount };
}

/**
 * Replace a posting's stored form schema.
 *
 * Wholesale rather than merged: a question the employer removed must disappear
 * here too, or a plan compiled tomorrow fills a field that no longer exists.
 *
 * Exported so the backfill writes forms through exactly this path. Two copies
 * of "how a question is stored" would drift, and the drift would show up as a
 * plan that fills one posting correctly and its neighbour wrongly.
 */
export async function storeQuestions(
  jobId: string,
  questions: NonNullable<JobPosting['questions']>,
): Promise<number> {
  await prisma.question.deleteMany({ where: { jobId } });
  await prisma.question.createMany({
    data: questions.map((q, i) => ({
      jobId,
      fieldName: q.fields[0]?.name ?? q.label,
      label: q.label,
      labelKey: q.labelKey,
      kind: q.fields[0]?.kind ?? 'unknown',
      required: q.required,
      answerability: q.answerability,
      options: (q.fields[0]?.options ?? null) as never,
      position: i,
    })),
  });
  return questions.length;
}

/**
 * Country from a free-text location string.
 *
 * Deliberately crude and deliberately nullable: a wrong country is worse than
 * no country, because §6 FR-9 filters on it and a candidate who cannot work in
 * the US must not be shown a US role because we guessed. Unrecognised stays
 * null and the posting simply does not match a country filter.
 */
function countryOf(location: string | null): string | null {
  if (!location) return null;
  const l = location.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\b(india|bengaluru|bangalore|mumbai|delhi|hyderabad|pune|chennai|jodhpur)\b/, 'India'],
    [/\b(germany|berlin|munich|münchen|hamburg|frankfurt)\b/, 'Germany'],
    [/\b(united kingdom|uk|london|manchester|edinburgh)\b/, 'United Kingdom'],
    [/\b(united states|usa|u\.s\.|new york|san francisco|seattle|austin|boston)\b/, 'United States'],
    [/\b(canada|toronto|vancouver|montreal)\b/, 'Canada'],
    [/\b(singapore)\b/, 'Singapore'],
    [/\b(australia|sydney|melbourne)\b/, 'Australia'],
    [/\b(netherlands|amsterdam)\b/, 'Netherlands'],
    [/\b(ireland|dublin)\b/, 'Ireland'],
  ];
  for (const [re, name] of map) if (re.test(l)) return name;
  return null;
}
