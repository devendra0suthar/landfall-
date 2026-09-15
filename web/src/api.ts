/**
 * Talking to the regional API.
 *
 * Relative paths only: the front end is static and global, the API is regional,
 * and which region a candidate reaches is decided by where they loaded the page
 * from — never by an origin baked into this bundle (docs/REQUIREMENTS.md §9).
 */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body ? { 'content-type': 'application/json' } : {},
    ...init,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
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
