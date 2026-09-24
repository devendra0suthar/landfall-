import type { Prisma } from '@prisma/client';
import { termsIn } from '../jobs/extract.js';

/**
 * "Ask Landfall" — job search in plain words, as a conversation.
 *
 * Before this there was no search at all: the Jobs screen had a country menu,
 * a date menu and a checkbox, and nothing anyone typed was read. The products
 * it is compared to let you say what you want.
 *
 * Deliberately not a language model. Every part of a request is recognised by
 * a rule that can be tested — role words, skills, a place, remote, a level, a
 * company, a date range — and every result comes out of the database. A chat
 * that invents or misquotes an opening is worse than no chat. What it could
 * not use is said back, not silently dropped (see `notes` and `ignored`).
 *
 * Pure: vocabularies (companies) are passed in, nothing here queries.
 */

export type Level = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'manager';
export type Workplace = 'remote' | 'hybrid' | 'onsite';

export interface AskFilters {
  /** Words that must each appear in the job title. */
  words: string[];
  /** Skills the posting must list — all of them. */
  skills: string[];
  place: { label: string; terms: string[] } | null;
  workplace: Workplace | null;
  level: Level | null;
  company: string | null;
  days: number | null;
}

export const EMPTY: AskFilters = {
  words: [], skills: [], place: null, workplace: null, level: null, company: null, days: null,
};

export interface Parsed {
  filters: AskFilters;
  /** Things asked for that no rule here can honour, said plainly. */
  notes: string[];
  /** Words kept out of the search because they carry no meaning on their own. */
  ignored: string[];
  /** True when this message started over rather than refining the last. */
  reset: boolean;
}

/* ─────────────────────────── vocabularies ─────────────────────────── */

/**
 * Places, with every spelling the index actually uses. Measured: Indian
 * locations alone appear as "Bangalore", "Bengaluru", "IN-Bengaluru",
 * "Bangalore, IND" — and 2,008 postings have no country at all, so a place is
 * matched in the location text as well as the country column.
 */
const PLACES: Array<{ label: string; say: string[]; terms: string[]; country?: string[] }> = [
  // Not ", ind" or "in-": they would match "Indiana" and "Berlin-Mitte". The
  // "IN-Bengaluru" spellings are caught by the city aliases and the country.
  { label: 'India', say: ['india'], terms: ['india'], country: ['India'] },
  { label: 'Bengaluru', say: ['bangalore', 'bengaluru', 'blr'], terms: ['bangalore', 'bengaluru', 'blr'] },
  { label: 'Mumbai', say: ['mumbai', 'bombay'], terms: ['mumbai', 'bombay'] },
  { label: 'Delhi NCR', say: ['delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram', 'noida'], terms: ['delhi', 'gurgaon', 'gurugram', 'noida'] },
  { label: 'Hyderabad', say: ['hyderabad'], terms: ['hyderabad'] },
  { label: 'Pune', say: ['pune'], terms: ['pune'] },
  { label: 'Chennai', say: ['chennai', 'madras'], terms: ['chennai'] },
  { label: 'United States', say: ['united states', 'usa', 'america', 'the us', 'u.s.'], terms: ['united states', 'usa'], country: ['United States'] },
  { label: 'United Kingdom', say: ['united kingdom', 'uk', 'england', 'britain'], terms: ['united kingdom', 'england'], country: ['United Kingdom'] },
  { label: 'London', say: ['london'], terms: ['london'] },
  { label: 'Canada', say: ['canada'], terms: ['canada'], country: ['Canada'] },
  { label: 'Toronto', say: ['toronto'], terms: ['toronto'] },
  { label: 'Ireland', say: ['ireland'], terms: ['ireland'], country: ['Ireland'] },
  { label: 'Dublin', say: ['dublin'], terms: ['dublin'] },
  { label: 'Singapore', say: ['singapore'], terms: ['singapore'], country: ['Singapore'] },
  { label: 'Germany', say: ['germany'], terms: ['germany'], country: ['Germany'] },
  { label: 'Berlin', say: ['berlin'], terms: ['berlin'] },
  { label: 'Australia', say: ['australia'], terms: ['australia'], country: ['Australia'] },
  { label: 'Sydney', say: ['sydney'], terms: ['sydney'] },
  { label: 'Netherlands', say: ['netherlands', 'holland'], terms: ['netherlands'], country: ['Netherlands'] },
  { label: 'Amsterdam', say: ['amsterdam'], terms: ['amsterdam'] },
  { label: 'New York', say: ['new york', 'nyc'], terms: ['new york', 'nyc'] },
  { label: 'San Francisco', say: ['san francisco', 'bay area', 'sf'], terms: ['san francisco', 'bay area'] },
  { label: 'Seattle', say: ['seattle'], terms: ['seattle'] },
];

const LEVELS: Array<[RegExp, Level]> = [
  [/\b(intern|internship|interns)\b/, 'intern'],
  [/\b(junior|jr|entry[- ]level|graduate|grad|fresher|freshers)\b/, 'junior'],
  [/\b(mid[- ]level|intermediate)\b/, 'mid'],
  [/\b(senior|sr)\b/, 'senior'],
  [/\b(staff|principal)\b/, 'staff'],
];

const WORKPLACE: Array<[RegExp, Workplace]> = [
  [/\b(remote|remotely|wfh|work from home)\b/, 'remote'],
  [/\bhybrid\b/, 'hybrid'],
  [/\b(on[- ]?site|in[- ]office|office based|office-based)\b/, 'onsite'],
];

const DAYS: Array<[RegExp, number]> = [
  [/\b(today|last 24 hours|past 24 hours|past day)\b/, 1],
  [/\b(this week|past week|last week|recent|recently|newest|latest|new ones|fresh)\b/, 7],
  [/\b(this month|past month|last month)\b/, 30],
];

/** Asked for, and not something any posting here states in a way we can read. */
const CANNOT: Array<[RegExp, string]> = [
  [/\b(visa|sponsor|sponsorship|work permit)\b/, 'Employers here don’t say whether they sponsor visas in a way I can filter on — check the posting.'],
  [/\b(salary|pay|paid|compensation|ctc|lpa|lakh|package)\b/, 'I can’t filter by pay — most postings here don’t state it.'],
];

const RESET = /\b(start over|new search|clear (it|this|all|everything)?|reset|forget (that|it))\b/;

/** Carry no meaning as a title word. */
const STOP = new Set(`
  a an the and or but also just only now then please pls show me find get give list want wanted need needs
  looking look search searching for in at on of to from with without near around based within any some all
  job jobs role roles position positions opening openings vacancy vacancies opportunity opportunities work
  working career careers that which who what about how are is be can could would will i im my we our you
  there here these those this last past posted days day week weeks month months ago no not new latest recent
  more less than over under team company companies at level
  good great best better nice decent top high interesting cool exciting dream suitable relevant matching
`.trim().split(/\s+/));

/* ─────────────────────────── parse ─────────────────────────── */

const norm = (s: string): string => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opening words that mark a message as narrowing the last answer. */
const REFINE = /^\s*(only|just|and|also|but|now|then|same|what about|how about|instead|plus|except)\b/;

/** A company's name as a person would type it: "Gusto, Inc." → "gusto". */
export function companyKey(name: string): string {
  return norm(name).replace(/,?\s*(inc|inc\.|ltd|llc|job board|careers)\.?$/g, '').replace(/[^a-z0-9 ]/g, '').trim();
}

export function parseAsk(
  text: string,
  previous: AskFilters | null,
  vocab: { companies: string[] },
): Parsed {
  let t = ` ${norm(text)} `;
  const notes: string[] = [];
  const reset = RESET.test(t);
  if (reset) t = t.replace(RESET, ' ');
  const refining = REFINE.test(t);

  // What THIS message said, before deciding how it combines with the last.
  const next: Partial<AskFilters> = {};

  const take = (re: RegExp): boolean => {
    const hit = re.test(t);
    if (hit) t = t.replace(new RegExp(re.source, 'g'), ' ');
    return hit;
  };

  for (const [re, note] of CANNOT) if (take(re)) notes.push(note);

  const n = t.match(/\b(\d{1,3}) days?\b/);
  if (n) { next.days = Math.min(365, Number(n[1])); t = t.replace(n[0], ' '); }
  else for (const [re, d] of DAYS) if (take(re)) { next.days = d; break; }

  for (const [re, w] of WORKPLACE) if (take(re)) { next.workplace = w; break; }
  for (const [re, l] of LEVELS) if (take(re)) { next.level = l; break; }

  // Longest spelling first, so "new delhi" wins over "delhi" and "new york"
  // is not read as the word "new" plus a city called "york".
  const spellings = PLACES.flatMap((p) => p.say.map((s) => ({ s, p }))).sort((a, b) => b.s.length - a.s.length);
  for (const { s, p } of spellings) {
    const re = new RegExp(`(^|[^a-z])${esc(s)}($|[^a-z])`);
    if (re.test(t)) {
      next.place = { label: p.label, terms: p.terms };
      t = t.replace(re, ' ');
      break;
    }
  }

  for (const c of [...vocab.companies].sort((a, b) => b.length - a.length)) {
    const key = companyKey(c);
    if (key.length < 3) continue;
    const re = new RegExp(`(^|[^a-z])${key}($|[^a-z])`);
    if (re.test(t)) { next.company = c; t = t.replace(re, ' '); break; }
  }

  // Skills use the matcher's own vocabulary, so "python" here is exactly the
  // "python" a posting's skill list holds.
  const skills = termsIn(t);
  if (skills.length > 0) {
    next.skills = skills;
    for (const s of skills) t = t.replace(s, ' ');
  }

  const words = t.split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2);
  const kept = words.filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
  const ignored = words.filter((w) => STOP.has(w));
  // New role words replace the old ones — "product manager" after "data
  // engineer" is a different role, not both.
  if (kept.length > 0) next.words = [...new Set(kept)];

  /**
   * Refine, or start again?
   *
   * "only this week", "at databricks", "product manager" narrow or swap one
   * part and keep the rest — that is what a conversation is for. But "data
   * engineer jobs in india" after "senior data engineer in london" is a whole
   * new request, and quietly keeping "senior" from the last one was the bug
   * that showed it. A message naming a role AND something else, not opening
   * with a refining word ("only", "and", "what about"…), starts fresh. The
   * chips show the result either way, so a wrong guess is one tap to fix.
   */
  const partsNamed = (['place', 'workplace', 'level', 'company', 'days', 'skills'] as const)
    .filter((k) => next[k] !== undefined).length;
  const fresh = reset || !previous || (!refining && next.words !== undefined && partsNamed > 0);

  const base: AskFilters = fresh ? { ...EMPTY } : { ...previous! };
  const filters: AskFilters = {
    ...base,
    ...next,
    // Skills accumulate within a conversation ("…with python", then "and sql").
    skills: next.skills ? [...new Set([...base.skills, ...next.skills])] : base.skills,
  };

  return { filters, notes, ignored: [...new Set(ignored)], reset: fresh && previous !== null };
}

/* ─────────────────────────── to a query ─────────────────────────── */

/**
 * Whole-word title matching, which SQL `contains` cannot do.
 *
 * "data engineer" matched "Database Change Management Engineer" on the first
 * real conversation: "data" is inside "Database". Each word must start at a
 * word boundary and end at one, allowing only the endings that keep the same
 * meaning — engineer/engineers/engineering, manager/managers — so "data"
 * still matches "Data" and no longer matches "Database".
 */
export function titleMatches(title: string, words: string[]): boolean {
  const t = title.toLowerCase();
  return words.every((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${esc}(s|es|ing)?($|[^a-z0-9])`).test(t);
  });
}

/**
 * The words as one phrase, in the order typed: "data engineer" matches
 * "Senior Data Engineer" and "Data Engineering Lead", not "Solutions Engineer
 * (…Data and AI)". Tried first; all-words-anywhere is the fallback.
 */
export function titleHasPhrase(title: string, words: string[]): boolean {
  if (words.length < 2) return titleMatches(title, words);
  const body = words
    .map((w) => `${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es|ing)?`)
    .join('[\\s/-]+');
  return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`).test(title.toLowerCase());
}

/** The database filter for a set of understood filters. Pure. */
export function whereFor(f: AskFilters): Prisma.JobWhereInput {
  const and: Prisma.JobWhereInput[] = [];
  for (const w of f.words) and.push({ title: { contains: w, mode: 'insensitive' } });
  if (f.skills.length > 0) and.push({ skills: { hasEvery: f.skills } });
  if (f.place) {
    const place = PLACES.find((p) => p.label === f.place!.label);
    and.push({
      OR: [
        ...f.place.terms.map((term) => ({ location: { contains: term, mode: 'insensitive' as const } })),
        ...(place?.country ? [{ country: { in: place.country } }] : []),
      ],
    });
  }
  if (f.workplace === 'remote') and.push({ OR: [{ remote: true }, { workplace: 'remote' }] });
  else if (f.workplace) and.push({ workplace: f.workplace });
  if (f.level) and.push({ level: f.level });
  if (f.company) and.push({ company: f.company });
  if (f.days) and.push({ postedAt: { gte: new Date(Date.now() - f.days * 86_400_000) } });
  return and.length > 0 ? { AND: and } : {};
}

/** The same filters with one understood part taken away (a chip removed). */
export function withoutPart(f: AskFilters, key: string): AskFilters {
  if (key.startsWith('skill:')) return { ...f, skills: f.skills.filter((s) => `skill:${s}` !== key) };
  switch (key) {
    case 'words': return { ...f, words: [] };
    case 'place': return { ...f, place: null };
    case 'workplace': return { ...f, workplace: null };
    case 'level': return { ...f, level: null };
    case 'company': return { ...f, company: null };
    case 'days': return { ...f, days: null };
    default: return f;
  }
}

/** Each understood part, for the chips a person can remove. */
export function chipsFor(f: AskFilters): Array<{ key: keyof AskFilters | `skill:${string}`; label: string }> {
  const chips: Array<{ key: keyof AskFilters | `skill:${string}`; label: string }> = [];
  if (f.words.length) chips.push({ key: 'words', label: `“${f.words.join(' ')}” in the title` });
  for (const s of f.skills) chips.push({ key: `skill:${s}`, label: `skill: ${s}` });
  if (f.place) chips.push({ key: 'place', label: `in ${f.place.label}` });
  if (f.workplace) chips.push({ key: 'workplace', label: f.workplace === 'onsite' ? 'on-site' : f.workplace });
  if (f.level) chips.push({ key: 'level', label: f.level });
  if (f.company) chips.push({ key: 'company', label: `at ${f.company}` });
  if (f.days) chips.push({ key: 'days', label: f.days === 1 ? 'posted today' : `posted in the last ${f.days} days` });
  return chips;
}
