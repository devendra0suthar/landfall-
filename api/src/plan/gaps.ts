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

/**
 * Where a question type goes, decided from its key alone — so it is decided
 * once, with the stats, not per request. It was ~40 regexes × 2,185 question
 * types on every call, which was most of what was left after the query fix.
 */
type Route = 'yours' | 'skip' | 'perPosting' | 'profile' | 'bank';

function routeFor(labelKey: string, answerability: string): Route {
  // Human-only first: it outranks everything. A consent question that also
  // looks bankable is still a consent question.
  if (isHumanOnly(labelKey) || answerability === 'demographic') return 'yours';
  // An attachment is not an unanswered question — it is answered by the
  // résumé on file, or it is not, and the profile screen says which.
  if (answerability === 'file') return 'skip';
  // Prose is per posting by nature. It recurs, and it is still not bankable.
  if (answerability === 'generated') return 'perPosting';
  if (matchesProfilePattern(labelKey)) return 'profile';
  return 'bank';
}

interface QuestionStats {
  grouped: Array<{
    labelKey: string; answerability: string; _count: { _all: number };
    route: Route; profileField: string | null;
  }>;
  formsRead: number;
  requiredByKey: Map<string, number>;
  labelByKey: Map<string, string>;
}

/**
 * The index-wide half of the report: the same for every candidate.
 *
 * One pass over the question table instead of three. The old version's third
 * query was Prisma's `distinct`, which does not become SQL DISTINCT — it
 * fetched all ~86,000 rows into Node and deduplicated them in JavaScript. That
 * was 284 of the report's ~350 ms, on a report the Apply screen now loads on
 * every visit.
 *
 * Grouped by the normalised key, not the label: "Have you worked at Figma"
 * and "…at Addepar" are one question, and counting them separately is what
 * makes a backlog look unbounded. `mode()` is the most common real phrasing,
 * so the UI shows a question a person recognises rather than a slug.
 *
 * Cached for a few minutes because it only changes when forms are re-read,
 * which is a batch job, never a request. A stale count for five minutes after
 * an ingest is harmless; the per-candidate half below is never cached.
 */
const STATS_TTL_MS = 5 * 60_000;
let statsCache: { at: number; value: Promise<QuestionStats> } | null = null;

export function forgetQuestionStats(): void { statsCache = null; }

function questionStats(): Promise<QuestionStats> {
  if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value;
  const value = loadQuestionStats();
  statsCache = { at: Date.now(), value };
  // A failed load must not be cached as the answer for five minutes.
  value.catch(() => { if (statsCache?.value === value) statsCache = null; });
  return value;
}

async function loadQuestionStats(): Promise<QuestionStats> {
  // The most common phrasing per key comes from a separate DISTINCT ON over
  // per-phrasing counts: `mode() WITHIN GROUP` gives the same answer but sorts
  // every label and measured 417 ms against 75 ms for this.
  const [rows, phrasings, formsRead] = await Promise.all([
    prisma.$queryRaw<Array<{ labelKey: string; answerability: string; n: bigint; req: bigint }>>`
      SELECT "labelKey", "answerability",
             count(*) AS n,
             count(*) FILTER (WHERE "required") AS req
        FROM "Question"
       GROUP BY "labelKey", "answerability"
       ORDER BY n DESC`,
    prisma.$queryRaw<Array<{ labelKey: string; label: string }>>`
      SELECT DISTINCT ON ("labelKey") "labelKey", "label"
        FROM (SELECT "labelKey", "label", count(*) AS c FROM "Question" GROUP BY 1, 2) t
       ORDER BY "labelKey", c DESC, "label"`,
    prisma.job.count({ where: { formFetchedAt: { not: null }, formReadable: true } }),
  ]);

  const requiredByKey = new Map<string, number>();
  for (const r of rows) {
    // Required is per key across answerabilities, as the old groupBy counted it.
    requiredByKey.set(r.labelKey, (requiredByKey.get(r.labelKey) ?? 0) + Number(r.req));
  }
  const labelByKey = new Map(phrasings.map((p) => [p.labelKey, p.label]));
  return {
    grouped: rows.map((r) => {
      const route = routeFor(r.labelKey, r.answerability);
      const field = route === 'profile' ? profileFieldFor(r.labelKey) : null;
      return {
        labelKey: r.labelKey, answerability: r.answerability, _count: { _all: Number(r.n) },
        route, profileField: field ? String(field) : null,
      };
    }),
    formsRead,
    requiredByKey,
    labelByKey,
  };
}

export async function gapReport(
  profile: CandidateProfile,
  bank: AnswerBank,
): Promise<GapReport> {
  const { grouped, formsRead, requiredByKey, labelByKey } = await questionStats();

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

    // See routeFor — the order of these checks lives there now.
    if (g.route === 'yours') { rows.yours.push({ ...row, kind: 'yours' }); continue; }
    if (g.route === 'skip') continue;
    if (g.route === 'perPosting') { rows.perPosting.push({ ...row, kind: 'perPosting' }); continue; }

    if (g.route === 'profile') {
      // Already answered from the profile — not a gap at all.
      if (resolveProfile(labelKey, profile)) continue;
      rows.profile.push({ ...row, kind: 'profile', profileField: g.profileField });
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
