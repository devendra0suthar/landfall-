import { Vendor } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { extractFacts, htmlToText, remoteScopeOf } from '../jobs/extract.js';
import { fetchForm, listJobs, probeBoard } from './greenhouse.js';
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

  const postings = await listJobs(boardToken);
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

  await prisma.board.update({
    where: { id: board.id },
    data: { lastFetchedAt: new Date() },
  });

  return result;
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
      formReadable: Array.isArray(posting.questions),
      formFetchedAt: Array.isArray(posting.questions) ? new Date() : null,
    },
    update: {
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
      // Never downgrade a form we have already read back to 'unknown'
      // because this pass did not re-fetch it.
      ...(Array.isArray(posting.questions)
        ? { formReadable: true, formFetchedAt: new Date() }
        : {}),
      fetchedAt: new Date(),
    },
  });

  if (!Array.isArray(posting.questions)) return { formRead: false, questionCount: 0 };

  // The form schema is replaced wholesale rather than merged: a question the
  // employer removed must disappear here too, or a plan compiled tomorrow fills
  // a field that no longer exists.
  await prisma.question.deleteMany({ where: { jobId: job.id } });
  await prisma.question.createMany({
    data: posting.questions.map((q, i) => ({
      jobId: job.id,
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

  return { formRead: true, questionCount: posting.questions.length };
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
