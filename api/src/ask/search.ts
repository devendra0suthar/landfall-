import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { eligibilityWhere } from '../jobs/eligibility.js';
import type { CandidateProfile } from '../plan/types.js';
import { titleHasPhrase, titleMatches, whereFor, type AskFilters } from './parse.js';

/**
 * Every open posting matching the filters, as ids.
 *
 * Title words are narrowed in SQL with `contains` and then checked as whole
 * words here (see titleMatches) — SQL alone matched "data" inside "Database".
 * The candidate set after the SQL narrowing is small, so this costs little.
 */
export async function matchingIds(f: AskFilters, profile: CandidateProfile | null): Promise<{
  ids: string[]; eligibilityApplied: boolean; titleMatch: 'phrase' | 'words' | null;
}> {
  // Eligibility applies unless they named a place: someone who asks for
  // "jobs in London" has told us where they want to look, and quietly
  // hiding London because their profile says India would be overruling them.
  const eligibility = profile && !f.place ? eligibilityWhere(profile) : {};
  const where: Prisma.JobWhereInput = {
    AND: [whereFor(f), eligibility, { closedAt: null }, { board: { disabled: false } }],
  };
  const rows = await prisma.job.findMany({ where, select: { id: true, title: true } });
  const eligibilityApplied = Object.keys(eligibility).length > 0;
  if (f.words.length === 0) return { ids: rows.map((r) => r.id), eligibilityApplied, titleMatch: null };
  // The phrase as typed first; every word anywhere only if no title has it —
  // and the reply says which, so a loose match is never passed off as exact.
  const phrase = rows.filter((r) => titleHasPhrase(r.title, f.words));
  if (phrase.length > 0 || f.words.length < 2) {
    return { ids: phrase.map((r) => r.id), eligibilityApplied, titleMatch: 'phrase' };
  }
  return { ids: rows.filter((r) => titleMatches(r.title, f.words)).map((r) => r.id), eligibilityApplied, titleMatch: 'words' };
}
