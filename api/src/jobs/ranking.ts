import { prisma } from '../lib/db.js';
import { toIndexed } from '../profile/load.js';
import { scoreJob } from '../score/score.js';
import type { CandidateProfile } from '../plan/types.js';
import type { Prisma } from '@prisma/client';

/**
 * Ordering the index by how well it fits the candidate.
 *
 * Until this existed the job list was sorted newest-first, and the client
 * re-sorted only the rows it had already loaded. With 2,563 eligible postings
 * and a page size of 60, that meant the best matches were almost never on
 * screen. Measured, for a data annotator in India, the first page was
 *
 *     19  Sales Manager, Mid-Market, France
 *     18  Cloud Operations Engineer
 *      0  Regional Director, Enterprise Sales
 *
 * while the actual top of the index scored 79, 79, 79, 76, 74. A matching
 * product that shows a zero first has failed at the only thing it claims to do,
 * and no amount of good scoring fixes it if nothing sorts by the score.
 *
 * **Why this needs a cache.** The score is computed in JavaScript from each
 * posting's facts, not in SQL, so ordering by it means scoring every row that
 * matched the filter: measured at 1.24s for 2,563 postings, dominated by
 * re-extracting facts from each description. That is fine once and absurd on
 * every page of every scroll. So the ranked list of ids is computed once and
 * reused, and paging through it costs one indexed lookup.
 *
 * **Why it is safe to cache.** The key includes the profile's `updatedAt`, so
 * editing a profile — the only thing that can change a score — produces a
 * different key and a fresh ranking. A stale entry cannot outlive the facts it
 * was computed from; it can only be evicted.
 */

interface Ranked {
  ids: string[];
  computedAt: number;
}

/** Small on purpose: a handful of filter shapes per candidate, not a store. */
const MAX_ENTRIES = 24;
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, Ranked>();

function evict(): void {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.computedAt > TTL_MS) cache.delete(k);
  // Map preserves insertion order, so the oldest key is the first one.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Every posting matching `where`, best fit first.
 *
 * Returns ids rather than rows: the caller pages through them and fetches only
 * the page it needs, so the expensive part happens once and the cheap part
 * happens per request.
 */
export async function rankedJobIds(
  candidateId: string,
  profile: CandidateProfile,
  profileStamp: string,
  where: Prisma.JobWhereInput,
): Promise<string[]> {
  evict();
  const key = `${candidateId}|${profileStamp}|${JSON.stringify(where)}`;
  const hit = cache.get(key);
  if (hit) return hit.ids;

  // Only the columns scoring reads — notably NOT `description`. Ranking used to
  // pull every description and re-run `extractFacts` over it, which measured at
  // 1,153ms of a 1,180ms ranking: 98% of the work, to recover values that were
  // already computed once at ingest and thrown away. They are columns now.
  const jobs = await prisma.job.findMany({
    where,
    select: {
      id: true, title: true, location: true, postedAt: true,
      skills: true, requiredSkills: true,
      level: true, workplace: true, yearsRequired: true, remoteScope: true,
    },
  });

  const scored = jobs.map((job) => ({
    id: job.id,
    score: scoreJob(
      {
        id: job.id,
        title: job.title,
        location: job.location,
        facts: {
          skills: job.skills,
          requiredSkills: job.requiredSkills,
          // Ranking compares terms, a level, a year count and a place. It never
          // reads the prose, so an empty summary costs nothing here — and the
          // remote scope it would have been parsed for is itself a column.
          requirementsFound: job.requiredSkills.length > 0,
          level: job.level,
          workplace: job.workplace as 'remote' | 'hybrid' | 'onsite' | null,
          years: job.yearsRequired,
          summary: '',
          remoteScope: job.remoteScope,
        },
      } as never,
      null,
      profile,
    ).match.score,
    // Ties broken by recency, so an unscored index still reads sensibly and the
    // order is stable rather than whatever the database happened to return.
    posted: job.postedAt ? job.postedAt.getTime() : 0,
  }));

  scored.sort((a, b) => b.score - a.score || b.posted - a.posted);

  const ids = scored.map((s) => s.id);
  cache.set(key, { ids, computedAt: Date.now() });
  return ids;
}

/** Drop every ranking for a candidate — their facts changed. */
export function forgetRankings(candidateId: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${candidateId}|`)) cache.delete(k);
}
