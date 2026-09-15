/**
 * Fill-plan types — the bridge between a form schema (Lane A) and an
 * execution surface (Lane C).
 *
 * Design note: a plan is DATA, computed with no browser and no LLM. That is
 * the whole point of the build spec's §2 finding — if the plan is computable
 * offline, submission stops being "an agent explores a page" and becomes
 * "execute a known list of actions", which is the difference between $5.26
 * and near-zero per application.
 *
 * A plan is also the audit artifact. Every value in it carries where it came
 * from, so nothing reaches a form without a traceable source.
 */

import type { Answerability, FieldKind, JobPosting } from '../ingest/types.js';

/**
 * Verified fact store, narrow slice.
 *
 * These are fields the candidate confirmed, stored once, reused forever.
 * Deliberately flat and typed: a profile field is never inferred, never
 * generated, and never guessed from another field.
 */
export interface CandidateProfile {
  firstName: string;
  lastName: string;
  preferredFirstName?: string;
  email: string;
  phone: string;
  /** Free-text as the forms want it, e.g. "Jodhpur, Rajasthan, India". */
  location?: string;
  addressLine?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  twitter?: string;
  pronouns?: string;
  namePronunciation?: string;
  /** Secondary link slots. Usually blank; a blank optional field is not a gap. */
  otherLinks?: string;
  portfolioPassword?: string;
  currentCompany?: string;
  currentTitle?: string;
  /** Absolute path to the resume file the executor will attach. */
  resumePath?: string;

  /**
   * Skills the candidate claims, lowercase, matched against the vocabulary in
   * `src/jobs/extract.ts`.
   *
   * This is the strongest matching signal the app has, and it is deliberately
   * self-declared rather than inferred from a résumé: an inferred skill is a
   * claim made on the candidate's behalf, and this list is compared against
   * what employers ask for. A term here that is not in the extractor's
   * vocabulary simply never matches — invisible, not wrong.
   */
  skills?: string[];

  /** Whole years of professional experience, for postings that state a bar. */
  yearsExperience?: number;

  /**
   * Work history as structured facts, newest first.
   *
   * Entered as data rather than parsed out of a PDF, because tailoring needs
   * the *parts* — which bullet, which role — and a parser hands back a wall of
   * text that then has to be re-segmented by guesswork. See docs/DECISIONS.md
   * #2. Everything here is the candidate's own wording; nothing downstream
   * rewrites it.
   */
  experience?: ResumeRole[];
}

/** One job on the résumé. */
export interface ResumeRole {
  title: string;
  company: string;
  /** Free text as the candidate writes it — "Mar 2021", "2021-03", "2021". */
  start: string;
  /** Absent or empty means current. */
  end?: string;
  location?: string;
  /**
   * Achievement lines, verbatim.
   *
   * Tailoring selects and orders these. It never edits one and never adds one:
   * a fabricated bullet on a CV is a lie inside a hiring process, told in the
   * candidate's name.
   */
  bullets: string[];
}

/**
 * One stored answer to a recurring question.
 *
 * `labelKeys` are NORMALISED labels (see normaliseLabel) — one bank entry
 * covers every employer that phrases the question the same way. The measured
 * 9.2x reuse ratio is what makes this table small enough to hand-curate.
 */
export interface BankAnswer {
  labelKeys: string[];
  /**
   * Regex sources matched against the normalised label, for question FAMILIES.
   *
   * The measured backlog is not 712 distinct questions — it is a few dozen
   * questions wearing 712 phrasings, most of them carrying an employer's own
   * name: "Have you ever worked at MongoDB", "…at Coinbase", "…provided
   * services to Fivetran". Enumerating those exactly is unbounded work;
   * one pattern per family is not.
   *
   * Patterns are tried only after every exact `labelKeys` match fails, so a
   * precise entry always wins over a family default.
   */
  labelPatterns?: string[];
  /** Value for text questions. */
  text?: string;
  /**
   * For selects: preference order of option labels. The plan picks the first
   * one the posting actually offers, because option sets differ per employer
   * even when the question is identical.
   */
  optionPreference?: string[];
  /** Set true for answers that are legally consequential (visa, sponsorship). */
  sensitive?: boolean;
  note?: string;
}

export interface AnswerBank {
  answers: BankAnswer[];
}

/** Where a filled value came from. Drives both cost accounting and the audit UI. */
export type FillSource =
  | 'profile'      // verified fact store — free, deterministic
  | 'bank'         // curated recurring answer — free, deterministic
  | 'file'         // document attachment
  | 'generated'    // deferred to the composition stage; NOT filled here
  | 'user'         // must be shown to a human (demographic, sensitive, unknown)
  | 'unresolved';  // nothing can answer this — see `reason`

/** One concrete thing the executor does to the page. */
export interface FillAction {
  /** Vendor field name, e.g. "job_application[first_name]". */
  fieldName: string;
  kind: FieldKind;
  questionLabel: string;
  labelKey: string;
  required: boolean;
  source: FillSource;
  /** Resolved value. Absent for generated/user/unresolved actions. */
  value?: string;
  /** For selects: the option value the executor submits, matched from options. */
  optionValue?: string | number;
  /** Why a non-deterministic source was chosen — shown in the approval queue. */
  reason?: string;
  /** Answerability the classifier assigned, kept for cross-checking. */
  answerability: Answerability;
}

export interface FillPlan {
  boardToken: string;
  vendorJobId: string;
  title: string;
  absoluteUrl: string;
  actions: FillAction[];
  /** Required questions nothing could answer. Non-empty ⇒ cannot submit. */
  blockingUnresolved: FillAction[];
  /** Questions deferred to the grounded composition stage. */
  needsGeneration: FillAction[];
  /** Questions that must be surfaced to the candidate before submit. */
  needsUser: FillAction[];
  /**
   * A plan is only executable when every required field has a value and
   * nothing awaits generation. Never inferred at execution time.
   */
  executable: boolean;
}
