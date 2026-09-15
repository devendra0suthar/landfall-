import { prisma } from '../lib/db.js';
import { isHumanOnly } from './plan.js';
import { findBankAnswer, matchesProfilePattern, profileFieldFor, resolveProfile } from './answer-bank.js';
import type { AnswerBank, CandidateProfile } from './types.js';

/**
 * What is still unanswered across the whole index, and what would close it.
 *
 * This is where the 9.2x reuse ratio stops being a statistic and starts being
 * worth something: a question is not one question, it is the same question
 * wearing 200 employers' phrasings. Answering it once resolves it everywhere,
 * so the only useful ordering is by how many forms each answer unlocks.
 *
 * Four kinds of gap, kept apart because the right repair differs for each
 * (docs/DECISIONS.md #7 in the Phase 0 repo, carried forward):
 *
 *   profile    — a field on the profile is blank. Fill it there, not here:
 *                the same fact stored twice is a fact that can disagree with
 *                itself.
 *   bankable   — recurring, not about identity, safe to answer once and reuse.
 *   perPosting — prose. "Why do you want to join Figma?" recurs across 25 of
 *                their postings and is still not bankable: one stored answer
 *                sent to 25 employers is the spam this product exists against.
 *                A letter starter helps here; the bank does not.
 *   yours      — consent, attestation, demographics, health. Never stored,
 *                never answered on the candidate's behalf, surfaced every time.
 *
 * The routing uses the `answerability` each question was classified with at
 * ingest, rather than re-deriving it from the label. Attachment fields are
 * excluded entirely: "Resume/CV" is answered by uploading a résumé, and listing
 * it as an unanswered question invites someone to type into a file field.
 */

export type GapKind = 'profile' | 'bankable' | 'perPosting' | 'yours';

export interface GapRow {
  labelKey: string;
  /** One employer's phrasing, so the candidate recognises the question. */
  label: string;
  kind: GapKind;
  /** Postings whose form asks this. */
  jobCount: number;
  /** Of those, how many mark it required. */
  requiredCount: number;
  /** The profile field that would close it, when the answer belongs there. */
  profileField: string | null;
  /** What is stored now, when something is. */
  answer: string | null;
}

export interface GapReport {
  /** Postings whose form we have actually read — the denominator, stated. */
  formsRead: number;
  totalQuestions: number;
  rows: { profile: GapRow[]; bankable: GapRow[]; perPosting: GapRow[]; yours: GapRow[] };
  /** Instances an answer would newly resolve, by kind. */
  reach: { profile: number; bankable: number };
}

export async function gapReport(
  profile: CandidateProfile,
  bank: AnswerBank,
): Promise<GapReport> {
  // Group by the normalised key, not the label: "Have you worked at Figma"
  // and "Have you worked at Addepar" are one question, and counting them
  // separately is what makes a backlog look unbounded.
  const grouped = await prisma.question.groupBy({
    by: ['labelKey', 'answerability'],
    _count: { _all: true },
    orderBy: { _count: { labelKey: 'desc' } },
  });

  const [formsRead, required, samples] = await Promise.all([
    prisma.job.count({ where: { formFetchedAt: { not: null }, formReadable: true } }),
    prisma.question.groupBy({
      by: ['labelKey'],
      where: { required: true },
      _count: { _all: true },
    }),
    // One real phrasing per key, so the UI shows a question a person recognises
    // rather than a normalised slug.
    prisma.question.findMany({
      distinct: ['labelKey'],
      select: { labelKey: true, label: true },
    }),
  ]);

  const requiredByKey = new Map(required.map((r) => [r.labelKey, r._count._all]));
  const labelByKey = new Map(samples.map((s) => [s.labelKey, s.label]));

  const rows: GapReport['rows'] = { profile: [], bankable: [], perPosting: [], yours: [] };
  const reach = { profile: 0, bankable: 0 };
  let totalQuestions = 0;

  for (const g of grouped) {
    const labelKey = g.labelKey;
    const jobCount = g._count._all;
    totalQuestions += jobCount;

    const row: GapRow = {
      labelKey,
      label: labelByKey.get(labelKey) ?? labelKey,
      kind: 'bankable',
      jobCount,
      requiredCount: requiredByKey.get(labelKey) ?? 0,
      profileField: null,
      answer: null,
    };

    // Human-only first: it outranks everything. A consent question that also
    // looks bankable is still a consent question.
    if (isHumanOnly(labelKey) || g.answerability === 'demographic') {
      rows.yours.push({ ...row, kind: 'yours' });
      continue;
    }

    // An attachment is not an unanswered question — it is answered by the
    // résumé on file, or it is not, and the profile screen says which.
    if (g.answerability === 'file') continue;

    // Prose is per posting by nature. It recurs, and it is still not bankable.
    if (g.answerability === 'generated') {
      rows.perPosting.push({ ...row, kind: 'perPosting' });
      continue;
    }

    if (matchesProfilePattern(labelKey)) {
      const hit = resolveProfile(labelKey, profile);
      // Already answered from the profile — not a gap at all.
      if (hit) continue;
      const field = profileFieldFor(labelKey);
      rows.profile.push({ ...row, kind: 'profile', profileField: field ? String(field) : null });
      reach.profile += jobCount;
      continue;
    }

    const stored = findBankAnswer(labelKey, bank);
    if (stored) {
      // Answered, and worth showing: the candidate should be able to see and
      // change what is being sent on their behalf.
      rows.bankable.push({ ...row, answer: stored.answer.text ?? null });
      continue;
    }

    rows.bankable.push(row);
    reach.bankable += jobCount;
  }

  // Unanswered first within each kind, then by how much each one unlocks.
  const rank = (a: GapRow, b: GapRow): number =>
    Number(a.answer !== null) - Number(b.answer !== null) || b.jobCount - a.jobCount;
  rows.profile.sort(rank);
  rows.bankable.sort(rank);
  rows.perPosting.sort((a, b) => b.jobCount - a.jobCount);
  rows.yours.sort((a, b) => b.jobCount - a.jobCount);

  return { formsRead, totalQuestions, rows, reach };
}
