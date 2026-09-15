import type { CandidateProfile } from '../plan/types.js';

/**
 * Cover-letter starter, assembled from verified facts only.
 *
 * The rule this file exists to enforce: **every sentence is either grounded in
 * a stored fact or is visibly a prompt to the candidate.** There is no third
 * category. No invented years of experience, no "I have long admired your
 * commitment to innovation", no inferred skills — because a cover letter goes
 * out under the candidate's name, and the repo's standing position is that a
 * wrong stored answer is worse than an absent one. A fabricated paragraph is
 * that failure with a signature on it.
 *
 * So this is deliberately NOT a generator. It is a scaffold: it writes the
 * parts that are true by construction (who you are, what role, where you work
 * now, how to reach you) and hands back bracketed prompts for the parts that
 * require knowing something it does not know.
 *
 * What it does not know is worth stating precisely, because it bounds the
 * whole feature. It knows the posting's title, employer, location and the
 * skills its text asks for — so it can name the overlap between those and what
 * the candidate has claimed. It does not know why they want this employer, or
 * which of their achievements maps to this role, and it never guesses: those
 * come back as bracketed prompts. `missingContext` says so on every result.
 */

export interface GroundedFact {
  field: string;
  value: string;
  /** 'profile' — a fact the candidate verified. 'posting' — from the harvest. */
  source: 'profile' | 'posting';
}

export interface LetterStarter {
  text: string;
  facts: GroundedFact[];
  /** Bracketed prompts left in the text, one per thing only a human can supply. */
  placeholders: string[];
  /** Profile fields that would each remove a placeholder if filled in. */
  wouldHelp: string[];
  /** What the app cannot know, so the candidate is never misled about tailoring. */
  missingContext: string[];
  wordCount: number;
}

/**
 * Turn a board token into something addressable.
 *
 * Greenhouse tokens are slugs — `okta`, `sigmacomputing`, `1password`. The
 * listing usually carries a real `company_name`, which ingest stores and the
 * caller passes as `company`; this is the fallback for the postings that do
 * not. It is a best-effort prettify, reported as a fact sourced from the board
 * token rather than as the employer's legal name, so a candidate who sees it
 * come out wrong knows exactly where it came from and fixes one word.
 */
export function employerName(boardToken: string): string {
  const cleaned = boardToken.replace(/[-_]+/g, ' ').trim();
  if (cleaned.length === 0) return boardToken;
  return cleaned.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/**
 * Quote the posting's location instead of parsing it.
 *
 * Greenhouse location strings are free text and take every shape: "Madrid,
 * Spain", "Chicago, Illinois; Michigan; Wisconsin", "Hybrid - San Francisco,
 * New York City". The first draft of this dropped them into "the role in ___",
 * which produced sentences asserting a single place the posting never claimed.
 *
 * Heuristics are the wrong answer here — "San Francisco, New York City" and
 * "Madrid, Spain" are the same shape and mean different things, and no rule
 * short of a gazetteer separates them. So the grammar changed instead: a
 * parenthetical carries any string faithfully, needs no parsing, and quotes
 * the employer's own words rather than paraphrasing them.
 *
 * Still dropped when the title already names the place, because employers
 * frequently put it there — "Senior Solutions Engineer, Okta (Chicago)" does
 * not need it twice.
 */
function locationSuffix(location: string | null | undefined, title: string): string {
  if (!location) return '';
  const loc = location.trim();
  if (loc === '') return '';
  const firstPart = loc.split(/[,;]/)[0]?.trim() ?? '';
  if (firstPart !== '' && title.toLowerCase().includes(firstPart.toLowerCase())) return '';
  return ` (${loc})`;
}

/** "a", "a and b", "a, b and c" — not "a and b and c". */
function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const P = {
  hook: '[One specific thing you have built, shipped or measured that maps to this '
    + 'role — this app cannot write this for you]',
  why: '[Why this employer in particular: one concrete detail about their product, '
    + 'market or engineering that you actually know]',
  role: '[Your current role and where you do it]',
  contact: '[How they should reach you]',
};

/** Minimal shape a starter needs — satisfied by both a JobPosting and an IndexedJob. */
export interface LetterJob {
  boardToken: string;
  title: string;
  location?: string | null;
  absoluteUrl: string;
  company?: string;
  /**
   * Skills the posting asks for, from its own text.
   *
   * Phase 0 had none of this — it stored form schemas, not prose — so the
   * starter could say nothing about the role. Landfall stores descriptions, so
   * the overlap with what the candidate has already claimed is available, and
   * naming it is grounded in two things they both said.
   */
  asks?: string[];
}

export function buildStarter(job: LetterJob, profile: CandidateProfile): LetterStarter {
  const facts: GroundedFact[] = [];
  const placeholders: string[] = [];
  const wouldHelp: string[] = [];

  const fact = (field: string, value: string | undefined, source: GroundedFact['source']): string | null => {
    if (!value || String(value).trim() === '') return null;
    facts.push({ field, value: String(value), source });
    return String(value);
  };

  // Prefer the company name the board reports; fall back to prettifying the token.
  const employer = job.company?.trim() || employerName(job.boardToken);
  fact(job.company?.trim() ? 'employer' : 'employer (from board token)', employer, 'posting');
  const title = fact('role title', job.title, 'posting');
  // Recorded as a fact even when the sentence cannot use it — the candidate
  // should still see the posting's own location string.
  fact('role location', job.location ?? undefined, 'posting');
  const locSuffix = locationSuffix(job.location, job.title);

  const first = profile.preferredFirstName?.trim() || profile.firstName?.trim();
  const fullName = [first, profile.lastName].filter(Boolean).join(' ').trim();
  fact('your name', fullName || undefined, 'profile');
  const currentTitle = fact('current title', profile.currentTitle, 'profile');
  const currentCompany = fact('current company', profile.currentCompany, 'profile');
  const myLocation = fact('your location', profile.location, 'profile');
  const email = fact('email', profile.email, 'profile');
  const phone = fact('phone', profile.phone, 'profile');

  const links = [profile.website, profile.github, profile.linkedin]
    .filter((l): l is string => Boolean(l && l.trim()));
  for (const l of links) fact('link', l, 'profile');

  // ── assemble, sentence by sentence, skipping anything ungrounded ──
  const lines: string[] = [];

  lines.push(`Dear ${employer} hiring team,`);
  lines.push('');

  const opener = title
    ? `I am applying for the ${title} role${locSuffix}.`
    : `I am applying for the role advertised at ${job.absoluteUrl}.`;
  lines.push(opener);
  lines.push('');

  // The overlap: terms the posting asks for that the candidate has claimed.
  // Not a boast about competence — a statement that two lists intersect, which
  // is the only thing either document actually establishes.
  const claimed = new Set((profile.skills ?? []).map((x) => x.toLowerCase()));
  const shared = (job.asks ?? []).filter((a) => claimed.has(a.toLowerCase()));
  if (shared.length > 0) {
    lines.push(
      `The posting asks for ${listJoin(shared.slice(0, 4))}`
      + `${shared.length > 4 ? ' among others' : ''} — ${shared.length === 1 ? 'a skill' : 'skills'} I list on my CV.`,
    );
    lines.push('');
    facts.push({ field: 'skills you both name', value: shared.join(', '), source: 'posting' });
  }

  lines.push(P.hook);
  placeholders.push(P.hook);
  lines.push('');

  lines.push(P.why);
  placeholders.push(P.why);
  lines.push('');

  if (currentTitle && currentCompany) {
    lines.push(
      `I am currently ${currentTitle} at ${currentCompany}`
      + `${myLocation ? `, based in ${myLocation}` : ''}.`,
    );
  } else {
    lines.push(P.role + (myLocation ? `, based in ${myLocation}.` : '.'));
    placeholders.push(P.role);
    if (!currentTitle) wouldHelp.push('currentTitle');
    if (!currentCompany) wouldHelp.push('currentCompany');
  }

  if (links.length > 0) {
    lines.push(`My work is at ${listJoin(links)}.`);
  } else {
    wouldHelp.push('website / github / linkedin');
  }

  lines.push('');
  lines.push('Thank you for your time.');
  lines.push('');

  if (fullName) {
    lines.push(fullName);
  } else {
    lines.push('[Your name]');
    placeholders.push('[Your name]');
    wouldHelp.push('firstName / lastName');
  }

  const contactLine = [email, phone].filter(Boolean).join(' · ');
  if (contactLine) {
    lines.push(contactLine);
  } else {
    lines.push(P.contact);
    placeholders.push(P.contact);
    wouldHelp.push('email / phone');
  }

  const text = lines.join('\n');

  return {
    text,
    facts,
    placeholders,
    wouldHelp: [...new Set(wouldHelp)],
    missingContext: [
      'This starter names the skills the posting asks for that you have already '
      + 'claimed. It does not paraphrase the rest of the description — summarising '
      + 'an employer\'s own advert back at them reads as filler.',
      'Nothing about your experience is inferred. Every claim about you above '
      + 'comes from a profile field you filled in yourself.',
    ],
    // Brackets are prompts, not prose — they should not flatter the count.
    wordCount: text.replace(/\[[^\]]*\]/g, '').split(/\s+/).filter(Boolean).length,
  };
}

/** Does this question want a cover letter, as opposed to some other prose field? */
export function isCoverLetter(labelKey: string): boolean {
  return /cover letter|covering letter|why (do you )?want|why are you interested/i.test(labelKey);
}
