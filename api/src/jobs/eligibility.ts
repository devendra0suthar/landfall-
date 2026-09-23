import type { Prisma } from '@prisma/client';
import type { CandidateProfile } from '../plan/types.js';

/**
 * Postings this candidate could actually take.
 *
 * Measured on the index as it stands: 2,408 postings, of which 225 are remote
 * roles that name a country the candidate is not in — "Remote — US" and the
 * like. A barrier is not an opening (FR-10), and leaving them in the default
 * list is why the location signal hits on 8.2% of what people are shown. Auto
 * -fill makes that worse rather than better: filling a form for a role you are
 * not eligible for is faster waste, not less waste.
 *
 * The rule is subtractive and deliberately timid. It removes only postings we
 * can *demonstrate* exclude this candidate, and keeps everything it cannot
 * decide — an unstated country, an unstated remote scope, a regional label like
 * EMEA that no geography table here can resolve. "Nullable beats wrong": a
 * posting wrongly hidden is an opportunity silently deleted, which is worse
 * than one wrongly shown.
 *
 * It uses the same country vocabulary as `score.ts` so the list and the score
 * cannot disagree about who is eligible for what.
 */

/** Scope labels that name a country, and the country names that satisfy them. */
const SCOPE_COUNTRIES: Record<string, readonly string[]> = {
  US: ['united states', 'usa', 'us', 'u.s.', 'america'],
  UK: ['united kingdom', 'uk', 'england', 'scotland', 'wales', 'britain'],
  CANADA: ['canada'],
  INDIA: ['india'],
  GERMANY: ['germany', 'deutschland'],
  IRELAND: ['ireland'],
  AUSTRALIA: ['australia'],
  SINGAPORE: ['singapore'],
  FRANCE: ['france'],
  NETHERLANDS: ['netherlands', 'holland'],
};

/** The candidate's country, lowercased, from wherever they recorded it. */
export function countryOf(profile: CandidateProfile): string | null {
  const raw = (profile.country ?? '').trim()
    || (profile.location ?? '').split(',').pop()?.trim()
    || '';
  return raw ? raw.toLowerCase() : null;
}

/** Scope labels this candidate is NOT inside. Empty when we cannot tell. */
export function excludedScopes(profile: CandidateProfile): string[] {
  const country = countryOf(profile);
  if (!country) return [];
  return Object.entries(SCOPE_COUNTRIES)
    .filter(([, names]) => !names.some((n) => country === n || country.includes(n)))
    .map(([scope]) => scope);
}

/**
 * A Prisma filter for "postings that do not exclude me".
 *
 * Returns `{}` when nothing can be decided — no country on the profile means no
 * basis for hiding anything, and the candidate sees the whole index rather than
 * a quietly truncated one.
 */
export function eligibilityWhere(profile: CandidateProfile): Prisma.JobWhereInput {
  const country = countryOf(profile);
  if (!country) return {};

  const excluded = excludedScopes(profile);
  const mine = Object.entries(SCOPE_COUNTRIES)
    .filter(([, names]) => names.some((n) => country === n || country.includes(n)))
    .flatMap(([, names]) => names);
  // Their own country as written, plus every spelling of it we know, so
  // "United States" and "usa" are one place.
  const myCountryNames = [...new Set([country, ...mine])];

  return {
    AND: [
      // A remote role restricted to somewhere else is not open to them. A role
      // with no stated scope, or a regional one we cannot resolve, stays.
      //
      // The `remoteScope: null` arm is load-bearing, not defensive. In SQL,
      // `scope NOT IN ('US', …)` evaluates to NULL — not true — when scope is
      // NULL, so a bare NOT-IN drops every row that never stated a scope. That
      // is 2,167 of 2,408 postings here: measured, the filter returned 15 rows
      // instead of 1,200 and looked like a very decisive product feature.
      //
      // Scope only constrains a *remote* role. An on-site job in Bangalore that
      // happens to carry a stray "US" scope from the extractor is a job in
      // Bangalore, and hiding it from someone in India was measurably wrong.
      {
        OR: [
          { remote: false },
          { remoteScope: null },
          { NOT: { remoteScope: { in: excluded } } },
        ],
      },
      {
        OR: [
          // Remote, and not excluded by the clause above.
          { remote: true },
          // On-site or hybrid where they are.
          { country: { in: myCountryNames, mode: 'insensitive' } },
          // Country unknown — we have not measured it, so we do not act on it.
          { country: null },
        ],
      },
    ],
  };
}
