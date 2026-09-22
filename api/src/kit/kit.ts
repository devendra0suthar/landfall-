/**
 * The Application Kit — the posture-C deliverable (FR-39 … FR-43).
 *
 * Landfall does not apply. What it hands the candidate instead is this: every
 * question the employer's form will ask, in form order, with the prepared
 * answer and where that answer came from — plus an honest statement of what we
 * could not read.
 *
 * Three rules shape every line below, and each one exists because the obvious
 * implementation is the wrong one:
 *
 * 1. **A Kit states what it does not know** (CLAUDE.md rule 7). The worst bug
 *    this product can ship is a Kit that looks complete because the form was
 *    never read. Presenting an unread form as a form with no questions sends
 *    someone into an interview unprepared while telling them they are ready.
 *    So `fields` is `null` — not `0` — when the count is unknown, and every
 *    coverage number is nullable for the same reason.
 *
 * 2. **Three states, never two** (FR-40). `formFetchedAt == null` means we
 *    never asked. `formReadable == false` means the vendor publishes none.
 *    These are different facts about the world and the candidate is owed the
 *    difference: the first is our gap, the second is theirs to work around.
 *
 * 3. **Resolved and unresolved never merge.** A single "92% ready" would
 *    flatter both numbers and hide the 17.7% only the candidate may answer.
 *    Every section is counted separately and summed nowhere.
 *
 * Assembly is a pure function over already-loaded facts: no browser, no
 * network, no model. Opening a Kit never contacts the employer (FR-42) —
 * the form was read at ingest, and this is compiled from what was stored.
 */

import type { AnswerBank, FillPlan, FillSource } from '../plan/types.js';
import type { GroundedFact, LetterStarter } from '../compose/letter.js';
import type { TailoredResume, TailoredRole } from '../resume/tailor.js';

/**
 * What we know about this employer's form.
 *
 * Deliberately not a boolean. See rule 2 above — and the `formReadable`
 * comment in schema.prisma, which is where this distinction was first paid for.
 */
export type FormState = 'readable' | 'unread' | 'unpublished';

/** One question, with its prepared answer and the answer's provenance. */
export interface KitQuestion {
  label: string;
  /** The vendor's own field name. Present only for questions we actually read. */
  fieldName: string | null;
  required: boolean;
  source: FillSource;
  /** The prepared answer. Null whenever it is not ours to supply. */
  value: string | null;
  /** Why this is not resolved, in words the candidate can act on. */
  reason: string | null;
  /**
   * True when this question was read from *this* employer's form; false when it
   * is a question we expect from experience but did not read (FR-43).
   *
   * The candidate must be able to tell those apart. An expected question that
   * does not appear costs them nothing; an unexpected one that does appear is
   * the thing that catches people out.
   */
  read: boolean;
}

export interface KitForm {
  state: FormState;
  /**
   * One sentence, for a person, about what we know of this form. The UI shows
   * this verbatim rather than deriving its own copy from `state`, so the honest
   * phrasing lives in one place and cannot drift per screen.
   */
  statement: string;
  /** Questions on the employer's form. Null when unknown — never 0 (rule 1). */
  fields: number | null;
  /** Questions we can name and put in front of the candidate. */
  stated: number;
  /**
   * `stated / fields`, 0–100. Null when `fields` is unknown, because a ratio
   * with an unknown denominator is not a number, it is a guess.
   */
  coverage: number | null;
  /**
   * Optional questions the candidate has left blank, which the planner drops.
   *
   * Reported rather than absorbed: "Address Line 2 (Optional)" is not a backlog
   * item when measuring coverage, but a candidate deciding what to fill in is
   * owed the fact that it exists.
   */
  skippedOptionalBlank: number;
}

export interface ApplicationKit {
  job: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    url: string;
  };
  form: KitForm;
  /** Prepared answers, in the employer's own field order. */
  answers: KitQuestion[];
  /**
   * Questions only the candidate may answer — EEO, consent, health,
   * attestations (FR-6). Listed as theirs, never pre-filled, never counted as
   * resolved. Under posture C this stopped being a restraint we exercise on
   * their behalf and became simply the honest boundary of the product.
   */
  yours: KitQuestion[];
  /** The answer sheet: what nothing could resolve, and what needs writing. */
  openItems: KitQuestion[];
  resume: {
    integrityOk: boolean;
    bulletsKept: number;
    bulletsAvailable: number;
    /** What the posting asks for, split by whether a bullet evidences it. */
    asked: string[];
    evidenced: string[];
    claimedNotShown: string[];
    missing: string[];
    /**
     * The selection itself — every role with the bullets kept and the bullets
     * dropped, each carrying the score that decided it.
     *
     * Carried in the Kit rather than left to a separate request because this is
     * the *evidence* for the integrity claim. "Every line is yours, verbatim" is
     * an assertion; the kept-and-dropped list with scores is what lets the
     * candidate check it, and a claim whose evidence is one screen away is a
     * claim most people never verify.
     */
    roles: TailoredRole[];
  };
  letter: {
    text: string;
    grounded: number;
    yours: number;
    wouldHelp: string[];
    /** Every fact the starter rests on, and whether it came from them or the posting. */
    facts: GroundedFact[];
    /** What the app cannot know, so the candidate is never misled about tailoring. */
    missingContext: string[];
  };
  /** Counts, each independent. Nothing here sums into a single readiness score. */
  counts: {
    prepared: number;
    yours: number;
    open: number;
  };
}

/**
 * The three-state read (FR-40).
 *
 * Order matters: "never asked" is checked first, because `formReadable`
 * defaults to false and is meaningless until a fetch has happened. Reading it
 * before checking `formFetchedAt` is exactly the conflation rule 2 forbids.
 */
export function formState(job: {
  formFetchedAt: Date | null;
  formReadable: boolean;
}): FormState {
  if (job.formFetchedAt === null) return 'unread';
  return job.formReadable ? 'readable' : 'unpublished';
}

/** The one place the honest phrasing for each state lives. */
function statementFor(state: FormState, stated: number): string {
  switch (state) {
    case 'readable':
      return 'Read from this employer\'s form. Every question below is one they '
        + 'actually ask, in their own order.';
    case 'unpublished':
      return 'This employer publishes no readable form — their questions are only '
        + `visible once you start applying. The ${stated} question${stated === 1 ? '' : 's'} `
        + 'below are the ones that recur across employers, not theirs. Expect more.';
    case 'unread':
      return 'We have not read this employer\'s form yet, so we cannot tell you what '
        + `it asks. The ${stated} question${stated === 1 ? '' : 's'} below are the ones `
        + 'that recur across employers. Treat this as a starting point, not a list.';
  }
}

/**
 * Title-case a normalised bank label key for display.
 *
 * Bank keys are normalised (lowercased, punctuation stripped) so that one entry
 * covers every employer phrasing the same question. That makes them poor
 * display strings, and this is a presentational repair, not a claim about how
 * any particular employer words it — which is why these questions are marked
 * `read: false`.
 */
function labelFromKey(key: string): string {
  const spaced = key.replace(/[-_]+/g, ' ').trim();
  if (spaced.length === 0) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The fallback Kit for a form we could not read (FR-43).
 *
 * A Kit still ships. Phase 0 measured 0/24 Workday postings exposing a
 * populated question set, and ~22% of postings cannot be planned offline at
 * all — for those, silence would be the product failing quietly. What we can
 * honestly offer is the recurring core: the nine questions that cover half of
 * every form on the market, which the candidate has already answered once.
 *
 * Every row is `read: false`. The candidate is never told these are this
 * employer's questions, because we do not know that.
 */
function expectedQuestions(bank: AnswerBank, hasResume: boolean): KitQuestion[] {
  const rows: KitQuestion[] = [];

  for (const answer of bank.answers) {
    // A bank entry with no stored value answers nothing, and listing it would
    // pad the Kit with questions we cannot help with.
    const value = answer.text ?? answer.optionPreference?.[0];
    if (value === undefined || value.length === 0) continue;

    const key = answer.labelKeys[0];
    if (key === undefined) continue;

    rows.push({
      label: answer.note ?? labelFromKey(key),
      fieldName: null,
      // Unknowable without the form. Claiming "required" would be inventing a
      // fact about an employer we have not read.
      required: false,
      source: 'bank',
      value,
      reason: null,
      read: false,
    });
  }

  if (hasResume) {
    rows.push({
      label: 'Resume/CV',
      fieldName: null,
      required: false,
      source: 'file',
      value: null,
      reason: null,
      read: false,
    });
  }

  return rows;
}

export interface KitInput {
  job: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    absoluteUrl: string;
    formFetchedAt: Date | null;
    formReadable: boolean;
  };
  /** Null when the form could not be read — the FR-43 path. */
  plan: FillPlan | null;
  /** Total questions on the form, when known. */
  formFields: number | null;
  tailored: TailoredResume;
  starter: LetterStarter;
  bank: AnswerBank;
  /** Filename of the document that would be attached, if there is one. */
  attachedFilename: string | null;
}

/**
 * Assemble the Kit.
 *
 * Pure: every input is already loaded, and nothing here fetches, renders or
 * calls a model. That is what lets FR-42 hold — opening a Kit cannot contact
 * the employer, because this function has no way to.
 */
export function buildKit(input: KitInput): ApplicationKit {
  const { job, plan, formFields, tailored, starter, bank, attachedFilename } = input;
  const state = formState(job);

  const answers: KitQuestion[] = [];
  const yours: KitQuestion[] = [];
  const openItems: KitQuestion[] = [];
  let skippedOptionalBlank = 0;

  if (plan === null) {
    // FR-43. No form, so no field order and no required flags — only the
    // recurring core, clearly marked as not this employer's.
    answers.push(...expectedQuestions(bank, attachedFilename !== null));
  } else {
    for (const action of plan.actions) {
      // A file action's value is a path on our disk. The candidate needs to
      // know which document goes, not where we keep it, and the path must not
      // leave the process.
      const value = action.source === 'file'
        ? attachedFilename
        : action.value ?? null;

      // A file question with no file behind it is not a prepared answer. It
      // used to render as a blank row in the prepared column, which is the
      // silent-gap failure this product exists to avoid: the candidate reaches
      // the employer's form believing the attachment is handled, and the one
      // field every single form in the sample asks for is empty.
      const unattachable = action.source === 'file' && value === null;

      const row: KitQuestion = {
        label: action.questionLabel,
        fieldName: action.fieldName,
        required: action.required,
        source: unattachable ? 'unresolved' : action.source,
        value,
        reason: unattachable
          ? 'no résumé on file — upload one and this is answered for every application'
          : action.reason ?? null,
        read: true,
      };

      if (unattachable) {
        openItems.push(row);
        continue;
      }

      // Where a question lands is decided by who may answer it, not by whether
      // we happen to have a value. 'user' is the 17.7% that is theirs by right
      // (FR-6) and it never appears in `answers`, even if a value existed.
      switch (action.source) {
        case 'profile':
        case 'bank':
        case 'file':
          answers.push(row);
          break;
        case 'user':
          yours.push(row);
          break;
        case 'generated':
        case 'unresolved':
          openItems.push(row);
          break;
      }
    }

    if (formFields !== null) {
      const dropped = formFields - plan.actions.length;
      skippedOptionalBlank = dropped > 0 ? dropped : 0;
    }
  }

  const stated = answers.length + yours.length + openItems.length;

  // Null denominator ⇒ null ratio (rule 1). A percentage computed against an
  // unknown total is the single most misleading number this screen could show.
  const coverage = formFields !== null && formFields > 0
    ? Math.round((stated / formFields) * 100)
    : null;

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      url: job.absoluteUrl,
    },
    form: {
      state,
      statement: statementFor(state, stated),
      fields: formFields,
      stated,
      coverage,
      skippedOptionalBlank,
    },
    answers,
    yours,
    openItems,
    resume: {
      integrityOk: tailored.integrity.allVerbatim,
      bulletsKept: tailored.bulletsKept,
      bulletsAvailable: tailored.bulletsAvailable,
      asked: tailored.coverage.asked,
      evidenced: tailored.coverage.evidenced,
      claimedNotShown: tailored.coverage.claimedNotShown,
      missing: tailored.coverage.missing,
      roles: tailored.roles,
    },
    letter: {
      text: starter.text,
      grounded: starter.facts.length,
      yours: starter.placeholders.length,
      wouldHelp: starter.wouldHelp,
      facts: starter.facts,
      missingContext: starter.missingContext,
    },
    counts: {
      prepared: answers.length,
      yours: yours.length,
      open: openItems.length,
    },
  };
}
