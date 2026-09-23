import { termsIn } from '../jobs/extract.js';

/**
 * The gate between a model's proposed rewording and the candidate's résumé.
 *
 * CLAUDE.md rule 1 says never write a claim on the candidate's behalf. A
 * rewording feature is the most direct way that rule could be broken, so the
 * model's output is not trusted: every proposal is checked here, mechanically,
 * before a human is ever shown it.
 *
 * The distinction this file exists to draw is between **rewording** and
 * **claiming**. Rewording changes words — that is the point, and a verifier
 * that rejected changed words would reject everything. Claiming introduces
 * facts. Facts live in three word classes, and those are what is guarded:
 *
 *   1. **Numbers.** "reduced latency" → "reduced latency by 40%" invents a
 *      measurement. This is the most common embellishment and the easiest to
 *      check, because a number is either in the source or it is not.
 *   2. **Technologies.** "built the pipeline" → "built the Airflow pipeline"
 *      claims experience with a tool. Checked against `termsIn`, the same
 *      vocabulary the job extractor and the scorer use — which means the exact
 *      keyword a posting asks for is the exact keyword we can prove was
 *      inserted. That is not a coincidence: keyword insertion is what the
 *      competitor's version of this feature does, and this is the check that
 *      makes it impossible here.
 *   3. **Scope and credit.** "helped migrate" → "led the migration" is a
 *      promotion the candidate did not receive. Grouped by concept below, so
 *      "led" in the source permits "leading" in the proposal.
 *
 * Facts going *missing* is also rejected. A rewording that quietly drops the
 * metric the candidate earned is not embellishment, but it is not a rewording
 * either, and silently weakening someone's own evidence is not a service.
 *
 * Everything here is pure and offline. `pnpm test` exercises it with no
 * network and no key, which matters: this is the check that has to keep
 * working on the day the model changes behaviour.
 */

export type ObjectionKind =
  | 'empty'
  | 'unchanged'
  | 'new-number'
  | 'new-technology'
  | 'new-entity'
  | 'escalation'
  | 'dropped-number'
  | 'dropped-technology'
  | 'inflated';

export interface Objection {
  kind: ObjectionKind;
  /** What tripped it, in the candidate's own words where possible. */
  detail: string;
}

export interface Verdict {
  ok: boolean;
  objections: Objection[];
}

/**
 * Small number words, folded to digits.
 *
 * Without this, "3 regions" reworded to "three regions" reads as both a
 * dropped number and a new one, and a legitimate proposal is thrown away.
 */
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12',
};

/**
 * Numeric claims in a line, normalised.
 *
 * The unit stays attached: "40" and "40%" are different claims, and a proposal
 * that turns one into the other has invented a denominator.
 */
export function numbersIn(text: string): string[] {
  const found: string[] = [];
  const lowered = text.toLowerCase();

  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`(^|[^a-z])${word}($|[^a-z])`).test(lowered)) found.push(digit);
  }

  // A number, its thousands separators and decimals, plus a trailing unit
  // marker where one is written against it.
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(%|x\b|k\b|m\b|bn\b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = (m[1] ?? '').replace(/,/g, '').replace(/\.0+$/, '');
    const unit = (m[2] ?? '').toLowerCase();
    found.push(`${value}${unit}`);
  }
  return [...new Set(found)];
}

/**
 * Words that claim scope or credit, grouped by what they actually assert.
 *
 * Grouped rather than listed flat so that inflection is not mistaken for
 * escalation: a candidate who wrote "led" has already claimed leadership, and
 * a proposal saying "leading" adds nothing. A candidate who wrote "helped" has
 * not, and "led" is then a claim about their role that they never made.
 */
const CREDIT_GROUPS: Record<string, string[]> = {
  lead: ['led', 'lead', 'leads', 'leading', 'leader', 'leadership'],
  own: ['owned', 'own', 'owns', 'owning', 'owner', 'ownership',
    'sole', 'solely', 'single-handedly', 'singlehandedly', 'independently'],
  manage: ['managed', 'manage', 'managing', 'manager', 'supervised', 'supervising',
    'directed', 'directing', 'oversaw', 'overseeing', 'oversight',
    'headed', 'heading', 'head', 'chief', 'principal', 'senior'],
  originate: ['spearheaded', 'pioneered', 'founded', 'architected', 'championed',
    'drove', 'driving', 'initiated', 'established'],
  superlative: ['first', 'only', 'best', 'fastest', 'largest', 'biggest',
    'greatest', 'top', 'expert', 'flawless', 'seamless'],
};

function creditGroupsIn(text: string): string[] {
  const lowered = text.toLowerCase();
  const hit: string[] = [];
  for (const [group, words] of Object.entries(CREDIT_GROUPS)) {
    for (const w of words) {
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`).test(lowered)) {
        hit.push(group);
        break;
      }
    }
  }
  return hit;
}

/**
 * Capitalised words that are not sentence-initial — proper nouns, in practice.
 *
 * This is the backstop behind the technology check: `termsIn` only knows the
 * vocabulary it was given, and a proposal that inserts "Salesforce" or
 * "Deloitte" is making a claim whether or not the extractor has heard of it.
 * Sentence-initial words are skipped because their capital says nothing.
 */
export function properNounsIn(text: string): string[] {
  const found: string[] = [];
  let sentenceStart = true;
  for (const raw of text.split(/\s+/)) {
    if (raw.length === 0) continue;
    const word = raw.replace(/^[^\w]+/, '').replace(/[^\w.+#/-]+$/, '');
    const isCapitalised = /^[A-Z][A-Za-z0-9.+#/-]*$/.test(word) && word.length > 1;
    if (isCapitalised && !sentenceStart && word !== 'I') found.push(word);
    // The next word starts a sentence only after terminal punctuation.
    sentenceStart = /[.!?]$/.test(raw);
  }
  return [...new Set(found)];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function lowerSet(list: readonly string[]): Set<string> {
  return new Set(list.map((s) => s.toLowerCase()));
}

/**
 * Check one proposed rewording against the bullet the candidate wrote.
 *
 * `ok: false` means the proposal is discarded before anyone sees it. It is
 * deliberately not "shown with a warning": a warned-about embellishment on a
 * screen full of accept buttons is an embellishment that gets accepted.
 */
export function verifyRewording(original: string, proposal: string): Verdict {
  const objections: Objection[] = [];
  const add = (kind: ObjectionKind, detail: string): void => {
    objections.push({ kind, detail });
  };

  const from = original.trim();
  const to = proposal.trim();

  if (to.length === 0) {
    return { ok: false, objections: [{ kind: 'empty', detail: 'the proposal is blank' }] };
  }
  const flatten = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');
  if (flatten(to) === flatten(from)) {
    return { ok: false, objections: [{ kind: 'unchanged', detail: 'identical to the original' }] };
  }

  const fromNumbers = lowerSet(numbersIn(from));
  const toNumbers = lowerSet(numbersIn(to));
  for (const n of numbersIn(to)) if (!fromNumbers.has(n.toLowerCase())) add('new-number', n);
  for (const n of numbersIn(from)) if (!toNumbers.has(n.toLowerCase())) add('dropped-number', n);

  const fromTerms = lowerSet(termsIn(from));
  const toTerms = lowerSet(termsIn(to));
  for (const t of termsIn(to)) if (!fromTerms.has(t.toLowerCase())) add('new-technology', t);
  for (const t of termsIn(from)) if (!toTerms.has(t.toLowerCase())) add('dropped-technology', t);

  // Proper nouns the extractor's vocabulary does not cover. Anything already
  // reported as a technology is left alone rather than counted twice.
  const fromNouns = lowerSet(properNounsIn(from));
  for (const n of properNounsIn(to)) {
    const key = n.toLowerCase();
    if (fromNouns.has(key) || fromTerms.has(key)) continue;
    if (termsIn(n).length > 0) continue;
    add('new-entity', n);
  }

  const fromCredit = new Set(creditGroupsIn(from));
  for (const g of creditGroupsIn(to)) if (!fromCredit.has(g)) add('escalation', g);

  // Padding. A rewording that needs half again as many words is usually
  // adding adjectives, and adjectives about one's own work are claims.
  const fromWords = wordCount(from);
  const toWords = wordCount(to);
  if (toWords > Math.ceil(fromWords * 1.5) + 2) {
    add('inflated', `${fromWords} words became ${toWords}`);
  }

  return { ok: objections.length === 0, objections };
}
