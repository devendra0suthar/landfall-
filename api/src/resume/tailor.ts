import type { CandidateProfile, ResumeRole } from '../plan/types.js';
import { termsIn } from '../jobs/extract.js';
import type { IndexedJob } from '../jobs/indexer.js';

/**
 * Résumé tailoring that selects and orders, and never writes.
 *
 * The rule, from docs/DECISIONS.md #1: **every line in the output exists
 * verbatim in the input.** Not "closely based on", not "lightly rephrased" —
 * character-for-character identical. A fabricated or embellished bullet on a
 * CV is a lie inside a hiring process, told in the candidate's name, and no
 * amount of relevance is worth it.
 *
 * That rule is not a comment here, it is checked. `integrity.allVerbatim` is
 * computed by comparing every emitted bullet against the set of bullets the
 * candidate actually wrote, and the API surfaces it. If a future change starts
 * generating text, this flag goes false and says so.
 *
 * What tailoring therefore is: for a given posting, decide **which** of the
 * candidate's own achievements to show and **in what order**, so the most
 * relevant evidence is at the top of each role. What it is not: a writer.
 *
 * One deliberate asymmetry — bullets are reordered within a role, but roles
 * are never reordered. Employment history is chronological, and shuffling it
 * to put a more relevant job first misrepresents a career.
 */

export interface ScoredBullet {
  text: string;
  score: number;
  /** Terms in this bullet that the posting asks for. The reason it ranked. */
  matched: string[];
}

export interface TailoredRole {
  title: string;
  company: string;
  start: string;
  end: string | null;
  location: string | null;
  /** Chosen, best first. */
  kept: ScoredBullet[];
  /** Left out, with their scores, so the choice is reviewable. */
  dropped: ScoredBullet[];
}

export interface TailoredResume {
  roles: TailoredRole[];
  bulletsKept: number;
  bulletsAvailable: number;
  /** What the posting asks for, and whether the résumé evidences it. */
  coverage: {
    asked: string[];
    evidenced: string[];
    /** Asked for, claimed in your skills, but no bullet demonstrates it. */
    claimedNotShown: string[];
    /** Asked for and not claimed at all. An honest gap. */
    missing: string[];
  };
  integrity: {
    /** True when every emitted bullet is character-identical to an input bullet. */
    allVerbatim: boolean;
    /** Any emitted text not found in the input. Should always be empty. */
    notFound: string[];
  };
  /** Plain text, ready to paste. */
  text: string;
}

/** Terms a bullet evidences, using the same vocabulary as the job extractor. */
function bulletTerms(bullet: string): string[] {
  return termsIn(bullet);
}

export interface TailorOptions {
  /** Bullets to keep per role. */
  perRole?: number;
  /**
   * Keep at least this many even when nothing matches.
   *
   * A role reduced to zero bullets reads as a gap in employment rather than an
   * irrelevant one, which is worse than showing a bullet that did not score.
   */
  minPerRole?: number;
}

export function tailor(
  profile: CandidateProfile,
  job: { facts: Pick<IndexedJob['facts'], 'requiredSkills' | 'skills'> },
  opts: TailorOptions = {},
): TailoredResume {
  const perRole = opts.perRole ?? 4;
  const minPerRole = opts.minPerRole ?? 2;

  // Requirements-section terms count double: they are what the employer says
  // it needs, as opposed to what the marketing copy happens to mention.
  const required = new Set(job.facts.requiredSkills);
  const mentioned = new Set(job.facts.skills);
  const asked = [...new Set([...required, ...mentioned])];

  const weightOf = (term: string): number => (required.has(term) ? 2 : 1);

  const roles: TailoredRole[] = (profile.experience ?? []).map((role: ResumeRole) => {
    const scored: ScoredBullet[] = (role.bullets ?? []).map((text) => {
      const matched = bulletTerms(text).filter((t) => required.has(t) || mentioned.has(t));
      return {
        text,
        score: matched.reduce((n, t) => n + weightOf(t), 0),
        matched,
      };
    });

    // Stable sort by score, so bullets that tie keep the candidate's own order.
    const ranked = scored
      .map((b, i) => ({ b, i }))
      .sort((x, y) => y.b.score - x.b.score || x.i - y.i)
      .map(({ b }) => b);

    const keepCount = Math.max(Math.min(perRole, ranked.length), Math.min(minPerRole, ranked.length));
    return {
      title: role.title,
      company: role.company,
      start: role.start,
      end: role.end?.trim() ? role.end : null,
      location: role.location ?? null,
      kept: ranked.slice(0, keepCount),
      dropped: ranked.slice(keepCount),
    };
  });

  // ── coverage: what the posting wants vs what the résumé shows ──
  const evidencedSet = new Set<string>();
  for (const r of roles) for (const b of r.kept) for (const t of b.matched) evidencedSet.add(t);
  const claimed = new Set((profile.skills ?? []).map((s) => s.toLowerCase()));

  const evidenced = asked.filter((t) => evidencedSet.has(t));
  const claimedNotShown = asked.filter((t) => !evidencedSet.has(t) && claimed.has(t));
  const missing = asked.filter((t) => !evidencedSet.has(t) && !claimed.has(t));

  // ── render ──
  const lines: string[] = [];
  const name = [profile.preferredFirstName || profile.firstName, profile.lastName]
    .filter(Boolean).join(' ').trim();
  if (name) lines.push(name);
  const contact = [profile.email, profile.phone, profile.location].filter(Boolean).join(' · ');
  if (contact) lines.push(contact);
  const links = [profile.linkedin, profile.github, profile.website].filter(Boolean);
  if (links.length) lines.push(links.join('  '));
  if (profile.skills?.length) {
    lines.push('', 'SKILLS', profile.skills.join(', '));
  }
  if (roles.length) lines.push('', 'EXPERIENCE');
  for (const r of roles) {
    lines.push('');
    lines.push(`${r.title} — ${r.company}${r.location ? `, ${r.location}` : ''}`);
    lines.push(`${r.start} – ${r.end ?? 'Present'}`);
    for (const b of r.kept) lines.push(`• ${b.text}`);
  }
  const text = lines.join('\n');

  // ── integrity: prove nothing was invented ──
  const inputBullets = new Set((profile.experience ?? []).flatMap((r) => r.bullets ?? []));
  const emitted = roles.flatMap((r) => r.kept.map((b) => b.text));
  const notFound = emitted.filter((t) => !inputBullets.has(t));

  return {
    roles,
    bulletsKept: emitted.length,
    bulletsAvailable: (profile.experience ?? []).reduce((n, r) => n + (r.bullets?.length ?? 0), 0),
    coverage: { asked, evidenced, claimedNotShown, missing },
    integrity: { allVerbatim: notFound.length === 0, notFound },
    text,
  };
}

/**
 * The résumé with nothing aimed at anything.
 *
 * Every bullet, in the order the candidate wrote them — the document they are
 * tailoring *from*, so they can see and hand over the whole thing rather than
 * only ever meeting it one posting at a time.
 *
 * It goes through `tailor` deliberately, against a posting that asks for
 * nothing and with no per-role cap. One renderer, one integrity check, one
 * place where a bullet can be dropped: a second code path that assembles
 * résumés would be a second place for them to disagree.
 */
export function baseResume(profile: CandidateProfile): TailoredResume {
  return tailor(profile, { facts: { requiredSkills: [], skills: [] } }, { perRole: Infinity });
}
