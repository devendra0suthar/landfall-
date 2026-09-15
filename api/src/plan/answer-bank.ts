import type { SelectOption } from '../ingest/types.js';
import type { AnswerBank, BankAnswer, CandidateProfile } from './types.js';

/**
 * Resolution of a question to a stored answer.
 *
 * Two separate problems live here and they have different difficulty:
 *
 *  1. Matching the QUESTION. Easy, because labels normalise well — that is
 *     what the 9.2x reuse ratio measured.
 *  2. Matching the ANSWER to the employer's OPTION SET. Harder, and the part
 *     everyone underestimates. "How did you hear about this job?" is one
 *     question with 57 different option lists. A stored string is useless
 *     unless it can be mapped onto whatever this employer actually offers.
 *
 * Both are deterministic. Neither needs a model.
 */

// ─────────────────────── profile field resolution ───────────────────────

/**
 * Normalised-label → profile field. Ordered: first match wins, so the more
 * specific patterns must precede the general ones ("preferred first name"
 * before "first name").
 *
 * These mirror PROFILE_PATTERNS in the Greenhouse classifier, but they do a
 * strictly harder job: the classifier only decides *that* a question is
 * profile-answerable, this decides *which* field answers it. A question can
 * classify as `profile` and still land here unresolved — that gap is exactly
 * what the plan-coverage report surfaces.
 */
const PROFILE_RESOLVERS: Array<[RegExp, keyof CandidateProfile]> = [
  [/^preferred first name/, 'preferredFirstName'],
  [/^preferred name/, 'preferredFirstName'],
  [/^(first|given) name/, 'firstName'],
  [/^(last|family|sur) ?name/, 'lastName'],
  [/^full name|^name$|^legal name/, 'firstName'], // composed below
  [/^e-?mail/, 'email'],
  [/^phone/, 'phone'],
  // Line 2 must be tested first, or "address line 2" inherits line 1's value.
  [/^address line 2|^apt|^unit$|^suite/, 'addressLine2'],
  [/^address( line 1)?$|^address line|^street/, 'addressLine'],
  [/^(postal|zip)/, 'postalCode'],
  // Employers split and join these arbitrarily: "State", "Province/State",
  // "State/Province/Region". All one field.
  [/^(state|province|region)[\s/]*(province|state|region)?$/, 'state'],
  [/^(country|nationality of residence)$/, 'country'],
  [/^name pronunciation$/, 'namePronunciation'],
  [/^(current )?(location|city|town)/, 'location'],
  [/linkedin/, 'linkedin'],
  [/^github/, 'github'],
  [/^twitter|^x profile/, 'twitter'],
  // "Pronouns", "My pronouns are", "What is your Preferred Pronoun?" — and
  // note "pronunciation" does not contain "pronoun", so this cannot collide.
  [/\bpronouns?\b/, 'pronouns'],
  [/^portfolio password$/, 'portfolioPassword'],
  // Secondary link slots ("Other Website", "Other links") are their own field,
  // not a second copy of the primary one — usually left blank.
  [/^other (website|link|url)/, 'otherLinks'],
  [/^(personal )?(website|portfolio|blog|homepage)/, 'website'],
  // Employers pad these with filler words the anchored patterns missed:
  // "Current Job Title", "Who is your current or previous employer?".
  [/^(who is your )?current(ly)? (or previous )?(company|employer|organisation|organization)/, 'currentCompany'],
  [/name of your current|current .{0,12}most recent.{0,4} (company|employer)/, 'currentCompany'],
  [/^(what is your )?current (or previous )?(job )?(title|role|position)/, 'currentTitle'],
  [/^where is your permanent|permanent .{0,12}work location/, 'location'],
  [/^in what cities are you available/, 'location'],
  [/^current country|^country of residence/, 'country'],
  [/^how do you pronounce your name/, 'namePronunciation'],
  [/^professional profile/, 'linkedin'],

  // ── The same fact, wrapped in a sentence ────────────────────────────────
  //
  // Everything above is anchored at the start of the label, which is right
  // for a form field called "Country". But employers also ask it as prose —
  // "What is your current country of residence?", "Which state or province do
  // you currently live in?", "What is the zip code of your primary residence?"
  // — and an anchored pattern never sees those. Measured on the 541-posting
  // harvest, country/state/zip phrased this way accounted for 43 unresolved
  // instances across the backlog's top 25, every one of them a fact already
  // sitting in the profile.
  //
  // Lookaheads because word order varies and none of it is reliable: "your"
  // comes before "country" in one phrasing and after it in the next.
  //
  // Each requires THREE things: the field noun, a residence word, and a
  // second-person reference. That last one is the guard. Without it,
  // "select the country or countries you anticipate working from" looks like
  // a residence question — it is an intent question, the answer is not a fact
  // about today, and filling it from the profile would be a confident wrong
  // answer of exactly the kind this repo would rather not give.
  [/(?=.*\bcountry\b)(?=.*\b(reside|residing|residence|live|living|based|located)\b)(?=.*\b(you|your)\b)/, 'country'],
  [/(?=.*\b(state|province)\b)(?=.*\b(reside|residing|residence|live|living|based|located)\b)(?=.*\b(you|your)\b)/, 'state'],
  [/(?=.*\b(zip|postal) ?code\b)(?=.*\b(you|your)\b)/, 'postalCode'],

  // No preferredLastName field exists, and inventing one would be a second
  // place for the same fact to be wrong. A preferred surname is the surname.
  [/^preferred (last|family|sur) ?name/, 'lastName'],
];

/**
 * Whether any profile resolver claims this label, regardless of whether the
 * profile actually holds a value.
 *
 * The distinction matters: "we know what this question wants and you left it
 * blank" is a different outcome from "we have no idea what this question
 * wants". The first is a blank optional field; the second is a backlog item.
 */
export function matchesProfilePattern(labelKey: string): boolean {
  if (/^full name|^name$|^legal name/.test(labelKey)) return true;
  return PROFILE_RESOLVERS.some(([pattern]) => pattern.test(labelKey));
}

/** Resolve a normalised label to a concrete profile value, or null. */

/**
 * Which profile field a question wants, whether or not the profile holds it.
 *
 * `resolveProfile` answers "what is the value", and returns null both when no
 * resolver claims the label and when one does but the field is blank. Those
 * are different facts, and the completeness report needs the second: a blank
 * field that 47 forms ask for is the single most useful thing a candidate can
 * be told to go and fill in.
 */
export function profileFieldFor(labelKey: string): keyof CandidateProfile | null {
  if (/^full name|^name$|^legal name/.test(labelKey)) return 'firstName';
  for (const [pattern, field] of PROFILE_RESOLVERS) {
    if (pattern.test(labelKey)) return field;
  }
  return null;
}

export function resolveProfile(
  labelKey: string,
  profile: CandidateProfile,
): { field: keyof CandidateProfile; value: string } | null {
  // Full-name questions are a composition, not a single field.
  if (/^full name|^name$|^legal name/.test(labelKey)) {
    const value = `${profile.firstName} ${profile.lastName}`.trim();
    return value ? { field: 'firstName', value } : null;
  }

  for (const [pattern, field] of PROFILE_RESOLVERS) {
    if (!pattern.test(labelKey)) continue;
    const raw = profile[field];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return { field, value: raw.trim() };
    }
    // Pattern matched but the profile is missing the field — stop here rather
    // than falling through to a looser pattern and filling the wrong value.
    return null;
  }
  return null;
}

// ─────────────────────── bank lookup ───────────────────────

/**
 * Compiled `labelPatterns`, cached per entry.
 *
 * An invalid pattern is dropped with a warning rather than thrown: a typo in a
 * curated data file should cost you one family's coverage, visible in the next
 * coverage report, not the whole run.
 */
const patternCache = new WeakMap<BankAnswer, RegExp[]>();

function patternsFor(a: BankAnswer): RegExp[] {
  const cached = patternCache.get(a);
  if (cached) return cached;
  const compiled: RegExp[] = [];
  for (const src of a.labelPatterns ?? []) {
    try {
      compiled.push(new RegExp(src));
    } catch {
      console.warn(`answer-bank: ignoring invalid pattern ${JSON.stringify(src)}`);
    }
  }
  patternCache.set(a, compiled);
  return compiled;
}

export interface BankMatch {
  answer: BankAnswer;
  /**
   * How the question was matched. This is a confidence signal, not trivia: an
   * exact normalised label means someone read that question and wrote that
   * answer. A pattern means the question merely *resembles* a family — which
   * is enough for "How did you hear about us", and not enough for anything
   * with legal weight.
   */
  via: 'exact' | 'pattern';
}

/**
 * Exact labels first, across every entry, before any pattern is tried — so a
 * specific answer always beats a family default regardless of file order.
 */
export function findBankAnswer(labelKey: string, bank: AnswerBank): BankMatch | null {
  for (const a of bank.answers) {
    if (a.labelKeys.includes(labelKey)) return { answer: a, via: 'exact' };
  }
  for (const a of bank.answers) {
    if (patternsFor(a).some((re) => re.test(labelKey))) return { answer: a, via: 'pattern' };
  }
  return null;
}

// ─────────────────────── option matching ───────────────────────

/**
 * Canonical form for comparing an option label to a stored preference.
 * Aggressive on purpose: option labels carry punctuation, casing and filler
 * that vary per employer while meaning the same thing.
 */
function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s+]/g, ' ')
    .replace(/\b(a|an|the|of|for|to|i|am|is|are)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Equivalence classes for option labels that mean the same thing.
 * Kept small and auditable — every entry here is a claim about semantics and
 * a wrong one puts a wrong answer on a real application.
 */
const SYNONYMS: string[][] = [
  ['yes', 'yes i do', 'yes i am', 'true', 'y'],
  ['no', 'no i do not', 'no i am not', 'false', 'n'],
  ['prefer not to say', 'decline to self identify', 'i do not wish disclose', 'prefer not disclose'],
  ['linkedin', 'linkedin job posting', 'linkedin com'],
  ['company website', 'company career site', 'careers page', 'website'],
  ['referral', 'employee referral', 'referred by employee', 'friend referral'],
  ['job board', 'online job board', 'other job board'],
];

function synonymClass(c: string): number {
  return SYNONYMS.findIndex((group) => group.includes(c));
}

export interface OptionMatch {
  option: SelectOption;
  /** How the match was made — recorded so a weak match can be routed to the user. */
  via: 'exact' | 'canonical' | 'synonym' | 'substring';
}

/**
 * Match a stored preference list against the options this employer offers.
 * Tries every strategy for preference 1 before moving to preference 2, so a
 * strong second choice never beats a weak first choice.
 */
export function matchOption(
  preferences: readonly string[],
  options: readonly SelectOption[],
): OptionMatch | null {
  for (const pref of preferences) {
    const p = canon(pref);
    if (!p) continue;

    for (const o of options) {
      if (o.label === pref) return { option: o, via: 'exact' };
    }
    for (const o of options) {
      if (canon(o.label) === p) return { option: o, via: 'canonical' };
    }

    const pClass = synonymClass(p);
    if (pClass >= 0) {
      for (const o of options) {
        if (synonymClass(canon(o.label)) === pClass) return { option: o, via: 'synonym' };
      }
    }

    // Substring is the weakest signal. Require the stored preference to be at
    // least 4 chars so "no" doesn't match "not applicable".
    if (p.length >= 4) {
      for (const o of options) {
        const oc = canon(o.label);
        if (oc.includes(p) || p.includes(oc)) return { option: o, via: 'substring' };
      }
    }
  }
  return null;
}
