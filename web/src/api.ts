/**
 * Talking to the regional API.
 *
 * Relative paths only: the front end is static and global, the API is regional,
 * and which region a candidate reaches is decided by where they loaded the page
 * from — never by an origin baked into this bundle (docs/REQUIREMENTS.md §9).
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** FR-27: the session is live but the password proof has gone stale. */
    readonly reauth = false,
  ) {
    super(message);
  }
}

/**
 * Raised when the API says nobody is signed in.
 *
 * Dispatched as an event rather than thrown into whichever screen happened to
 * be loading: a 401 is a fact about the whole app, and every screen catching it
 * separately is how you get eight different renderings of "signed out".
 */
export const SIGNED_OUT = 'landfall:signed-out';
export const REAUTH = 'landfall:reauth';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : {},
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new ApiError(
      body.error ?? `request failed (${res.status})`,
      res.status,
      body.reauth === true,
    );
    // The shell listens for these. Auth endpoints are exempt: a wrong password
    // on the sign-in form is that form's business, not a global sign-out.
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent(SIGNED_OUT));
    }
    if (err.reauth) window.dispatchEvent(new CustomEvent(REAUTH));
    throw err;
  }
  return body as T;
}

/* ── shapes the API actually returns ── */

export interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  country: string | null;
  remote: boolean;
  remoteScope: string | null;
  vendor: string;
  url: string;
  postedAt: string | null;
  skills: string[];
  requiredSkills: string[];
  /** Null when we have not read the form yet — not zero. */
  questionCount: number | null;
  formState: 'readable' | 'not-published' | 'unknown';
  /** Null when there is no profile to compare against — never a zero. */
  match: { score: number; confidence: 'low' | 'medium' | 'high' } | null;
}

export interface MatchSignal { name: string; hit: boolean; detail: string }

export interface JobScore {
  match: {
    score: number;
    confidence: 'low' | 'medium' | 'high';
    signals: MatchSignal[];
    haveSkills: string[];
    missingSkills: string[];
    basis: string[];
  };
  readiness: {
    pct: number | null; filled: number; total: number;
    blocked: boolean; needsWriting: number; measured: boolean;
  };
}

export interface PlanAction {
  label: string;
  labelKey: string;
  fieldName: string;
  required: boolean;
  source: 'profile' | 'bank' | 'file' | 'generated' | 'user' | 'unresolved';
  value: string | null;
  reason: string | null;
}

export interface Plan {
  formState: 'readable' | 'unknown';
  message?: string;
  executable?: boolean;
  counts?: {
    formFields: number;
    planned: number;
    skippedOptionalBlank: number;
    deterministic: number;
    needsWriting: number;
    needsCandidate: number;
    unresolved: number;
  };
  actions?: PlanAction[];
}

/* ── the Application Kit (FR-39 … FR-43) ── */

/**
 * Three states, never two. `unread` is our gap; `unpublished` is the vendor's.
 * The candidate is owed the difference, so the UI never collapses them.
 */
export type KitFormState = 'readable' | 'unread' | 'unpublished';

export interface KitQuestion {
  label: string;
  /** Null for a question we expect but did not read from this form. */
  fieldName: string | null;
  required: boolean;
  source: PlanAction['source'];
  value: string | null;
  reason: string | null;
  /** False ⇒ this is a question that recurs elsewhere, not one of theirs. */
  read: boolean;
}

export interface ApplicationKit {
  job: { id: string; title: string; company: string; location: string | null; url: string };
  form: {
    state: KitFormState;
    /** Rendered verbatim — the honest phrasing lives on the server, not per screen. */
    statement: string;
    /** Null when unknown. Never zero. */
    fields: number | null;
    stated: number;
    /** Null whenever `fields` is null: a ratio with an unknown total is a guess. */
    coverage: number | null;
    skippedOptionalBlank: number;
  };
  answers: KitQuestion[];
  yours: KitQuestion[];
  openItems: KitQuestion[];
  resume: {
    integrityOk: boolean;
    bulletsKept: number;
    bulletsAvailable: number;
    asked: string[];
    evidenced: string[];
    claimedNotShown: string[];
    missing: string[];
    /** The evidence for the integrity claim: what was kept, what was dropped, and why. */
    roles: Array<{
      title: string; company: string; start: string; end: string | null;
      location: string | null;
      kept: TailoredBullet[]; dropped: TailoredBullet[];
    }>;
  };
  letter: {
    text: string;
    grounded: number;
    yours: number;
    wouldHelp: string[];
    facts: Array<{ field: string; value: string; source: 'profile' | 'posting' }>;
    missingContext: string[];
  };
  counts: { prepared: number; yours: number; open: number };
}

export interface TailoredBullet { text: string; score: number; matched: string[] }

export interface Tailored {
  integrity: { allVerbatim: boolean; notFound: string[] };
  bulletsKept: number;
  bulletsAvailable: number;
  coverage: { evidenced: string[]; claimedNotShown: string[]; missing: string[] };
  roles: Array<{
    title: string; company: string; start: string; end: string | null;
    kept: TailoredBullet[]; dropped: TailoredBullet[];
  }>;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedField<T> {
  value: T;
  confidence: Confidence;
  reason: string | null;
  alternatives?: T[];
}

export interface ParsedRole {
  title: ParsedField<string>;
  company: ParsedField<string>;
  start: ParsedField<string>;
  end: ParsedField<string | null>;
  location?: ParsedField<string>;
  bullets: Array<ParsedField<string>>;
}

export interface ParseResponse {
  source: { filename: string; bytes: number; sha256: string };
  note: string;
  parsed: {
    firstName: ParsedField<string>;
    lastName: ParsedField<string>;
    email: ParsedField<string>;
    phone: ParsedField<string>;
    location: ParsedField<string>;
    linkedin: ParsedField<string>;
    currentTitle: ParsedField<string>;
    skills: Array<ParsedField<string>>;
    roles: ParsedRole[];
    needsReview: number;
    fieldCount: number;
    textLength: number;
    excluded: string[];
    warnings: string[];
  };
}

export interface ResumeRow {
  id: string;
  filename: string;
  bytes: number;
  sha256: string;
  uploadedAt: string;
  /** Exactly one is true (FR-4) — the file every application attaches. */
  active: boolean;
}

export interface ResumeList { count: number; rows: ResumeRow[] }

export interface GapRow {
  labelKey: string;
  label: string;
  kind: 'profile' | 'bankable' | 'perPosting' | 'yours';
  jobCount: number;
  requiredCount: number;
  profileField: string | null;
  answer: string | null;
}

export interface GapReport {
  formsRead: number;
  totalQuestions: number;
  rows: { profile: GapRow[]; bankable: GapRow[]; perPosting: GapRow[]; yours: GapRow[] };
  reach: { profile: number; bankable: number };
}

export interface LetterStarter {
  text: string;
  facts: Array<{ field: string; value: string; source: 'profile' | 'posting' }>;
  placeholders: string[];
  wouldHelp: string[];
  missingContext: string[];
  wordCount: number;
}

export interface AppRow {
  id: string;
  status: 'SAVED' | 'READY' | 'APPLIED' | 'SKIPPED';
  title: string;
  company: string;
  location: string | null;
  url: string;
  updatedAt: string;
  sent: { sentAt: string; filename: string; sha256: string; tailored: boolean } | null;
  quiet: boolean;
}

export interface AppDetail {
  id: string;
  status: AppRow['status'];
  notes: string | null;
  job: { id: string; title: string; company: string; location: string | null; url: string };
  sent: {
    sentAt: string; filename: string; sha256: string; bytes: number;
    bullets: string[]; variant: string | null; tailored: boolean;
    expiresAt: string; verified: string;
  } | null;
}

export interface ProfilePayload {
  candidate: { email: string; region: string };
  profile: {
    firstName: string; lastName: string; email: string; phone: string | null;
    location: string | null; country: string | null; linkedin: string | null;
    currentTitle: string | null; skills: string[]; yearsExperience: number | null;
    roles: Array<{
      id: string; title: string; company: string; start: string;
      end: string | null; location: string | null; bullets: string[];
    }>;
  };
  resume: { id: string; filename: string; bytes: number; sha256: string; uploadedAt: string } | null;
  bank: Array<{ labelKey: string; value: string }>;
  variants: Array<{ name: string; active: boolean }>;
}

/* ── résumé analysis (works on any pasted job description) ── */

export type Severity = 'good' | 'warn' | 'bad';

export interface Finding {
  severity: Severity;
  message: string;
  /** What to do. Never the words to use — the action to take. */
  fix?: string;
}

export interface AnalysisCategory {
  key: 'keywords' | 'evidence' | 'impact' | 'structure' | 'completeness' | 'ats';
  label: string;
  score: number;
  /** 0 means the category could not be judged and is excluded from the score. */
  weight: number;
  measured: string;
  findings: Finding[];
}

export interface ResumeAnalysis {
  score: number;
  band: 'weak' | 'fair' | 'strong';
  categories: AnalysisCategory[];
  target: {
    title: string | null;
    asked: string[];
    evidenced: string[];
    claimedNotShown: string[];
    missing: string[];
  } | null;
  topFixes: Finding[];
}

export interface AnalyzeResponse {
  analysis: ResumeAnalysis;
  /** What the extractor understood, so a bad paste is visible as one. */
  readJob: {
    title: string | null;
    skills: string[];
    requiredSkills: string[];
    requirementsFound: boolean;
    level: string | null;
    workplace: string | null;
    years: number | null;
    characters: number;
  } | null;
  tailored: {
    integrityOk: boolean;
    bulletsKept: number;
    bulletsAvailable: number;
    roles: Array<{
      title: string; company: string; start: string; end: string | null;
      kept: TailoredBullet[]; dropped: TailoredBullet[];
    }>;
    text: string;
  } | null;
}

/* ── AI-proposed rewordings (the honest form of keyword insertion) ── */

/**
 * A bullet, with whether a machine ever shaped its words.
 *
 * `originalText` is what the candidate typed before they accepted a proposal,
 * and it is the whole undo story: non-null means this line can be reverted.
 */
export interface EditableBullet {
  id: string;
  text: string;
  originalText: string | null;
  acceptedAt: string | null;
}

export interface BulletRole {
  id: string;
  title: string;
  company: string;
  start: string;
  end: string | null;
  bullets: EditableBullet[];
}

export interface BulletsResponse {
  /** False when the server has no model credentials. The screen says so. */
  available: boolean;
  roles: BulletRole[];
  bulletCount: number;
}

export interface Suggestion {
  bulletId: string;
  original: string;
  proposal: string;
  rationale: string;
}

export type ObjectionKind =
  | 'empty' | 'unchanged' | 'new-number' | 'new-technology' | 'new-entity'
  | 'escalation' | 'dropped-number' | 'dropped-technology' | 'inflated';

export interface Discarded {
  bulletId: string;
  original: string;
  proposal: string;
  objections: Array<{ kind: ObjectionKind; detail: string }>;
}

export interface SuggestResponse {
  suggestions: Suggestion[];
  /** Proposals the verifier refused. Counted on screen, never hidden. */
  discarded: Discarded[];
  model: string | null;
  bulletsConsidered: number;
}


/* ── accounts (FR-24, FR-27) ── */

export interface Me {
  candidate: {
    id: string;
    email: string;
    region: string;
    /** False on a brand-new account, which is sent to the résumé upload. */
    hasProfile: boolean;
  } | null;
  authedAt?: string;
}

/* ── the autofill extension (FR-15) ── */

export interface ExtensionToken {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface ExtensionTokenList { tokens: ExtensionToken[] }

/** The token itself appears here once and is never retrievable again. */
export interface NewExtensionToken { id: string; token: string; note: string }

/* ── résumé layouts ── */

export interface ResumeTemplate { id: string; name: string; suits: string }
export interface TemplateList { templates: ResumeTemplate[] }

/* ── the run: your next applications, already prepared ── */

export interface RunItem {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  match: number;
  prepared: number;
  yours: number;
  open: number;
  /** Null when the form has not been read — never zero. */
  fields: number | null;
  applied: boolean;
}

export interface RunResponse {
  items: RunItem[];
  /** Named rather than silently dropped from the count. */
  couldNotPrepare: Array<{ jobId: string; reason: string }>;
  requested: number;
  available: number;
  totals: { prepared: number; yours: number; open: number };
}
