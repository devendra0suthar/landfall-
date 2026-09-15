import { fetchJson } from '../lib/http.js';
import type {
  Answerability, BoardProbe, FieldKind, FormField, FormQuestion, JobPosting, SelectOption,
} from './types.js';

/**
 * Greenhouse Job Board API client.
 *
 * Unauthenticated and public. The endpoint that matters is
 *   /v1/boards/{token}/jobs/{id}?questions=true
 * which returns the complete application form schema — every question, its
 * required flag and field types — WITHOUT a browser and WITHOUT auth.
 * That is what makes deterministic form filling tractable on ~half the market.
 */

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

// ─────────────────────────── wire types ───────────────────────────
// Deliberately loose: this is someone else's API and it will change.

interface GhField {
  name?: string;
  type?: string;
  values?: Array<{ label?: string; value?: string | number }>;
}
interface GhQuestion {
  label?: string;
  required?: boolean;
  fields?: GhField[];
}
interface GhJobSummary {
  id?: number;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
  /** The employer's display name. "Addepar", where the token is "addepar1". */
  company_name?: string;
  /** HTML, and only when the request asked for content=true. */
  content?: string;
}
interface GhJobsResponse { jobs?: GhJobSummary[]; meta?: { total?: number } }
interface GhJobDetail extends GhJobSummary {
  questions?: GhQuestion[];
  demographic_questions?: { questions?: unknown[] } | null;
  compliance?: Array<{ type?: string; requires_consent?: boolean }>;
}

// ─────────────────────────── mapping ───────────────────────────

const FIELD_KIND: Record<string, FieldKind> = {
  input_text: 'short_text',
  textarea: 'long_text',
  input_file: 'file',
  multi_value_single_select: 'single_select',
  multi_value_multi_select: 'multi_select',
  input_hidden: 'unknown',
  boolean: 'boolean',
};

function toFieldKind(t: string | undefined): FieldKind {
  if (!t) return 'unknown';
  return FIELD_KIND[t] ?? 'unknown';
}

/**
 * Normalise a question label so the same question asked by 300 different
 * companies counts as one. This is the crux of the whole measurement: if
 * normalisation is too loose we overstate reuse, too tight and we understate it.
 */
export function normaliseLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')            // drop parentheticals: "(optional)", "(if any)"
    .replace(/\[.*?\]/g, ' ')
    .replace(/[‘’]/g, "'")     // smart quotes
    .replace(/[“”]/g, '"')
    .replace(/https?:\/\/\S+/g, ' ')     // embedded links
    .replace(/&[a-z]+;/g, ' ')           // stray html entities
    .replace(/<[^>]+>/g, ' ')            // stray html tags
    .replace(/[^a-z0-9\s'/-]/g, ' ')     // punctuation, asterisks, colons
    .replace(/\b(please|kindly)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordered rules — first match wins. Written as explicit patterns rather than
// an LLM call, because this classification has to be free and deterministic.
const PROFILE_PATTERNS: RegExp[] = [
  // identity
  /^(first|last|full|preferred|legal|given|family) name/,
  /^preferred first name/,
  /^name$/,
  /^e-?mail/,
  /^phone/,
  /^pronouns?$/,
  // postal address — all deterministic profile fields
  /^(current )?(location|city|town)/,
  /^address( line)?/,
  /^(state|province|region)$/,
  /^(country|nationality of residence)$/,
  /^(postal|zip)[\s/-]?(code)?$/,
  /^postal\/zip code$/,
  // links
  /linkedin/,
  /^(personal )?(website|portfolio|blog|homepage)/,
  /^portfolio password$/,
  /^github/,
  /^twitter|^x profile/,
  // current employment — stored, not generated
  /^current (company|employer|title|role|position)/,
];

const GENERATED_PATTERNS: RegExp[] = [
  /cover letter/,
  /^why (do you |are you |would you )?(want|interested|excited|applying)/,
  /why (this|our) (company|role|team|position)/,
  /tell us (about|why)/,
  /describe (a|your|an)/,
  /what (interests|excites|draws|motivates) you/,
  /in your own words/,
  /what makes you/,
  /anything else (you|we)/,
  /additional information/,
];

const DEMOGRAPHIC_PATTERNS: RegExp[] = [
  /\b(race|ethnicity|hispanic|latino)\b/,
  /\bgender\b/,
  /\bveteran\b/,
  /\bdisability\b/,
  /\bsexual orientation\b/,
  /voluntary self-?identification/,
];

function classify(labelKey: string, fields: FormField[], isDemographic: boolean): Answerability {
  if (isDemographic) return 'demographic';
  if (DEMOGRAPHIC_PATTERNS.some((p) => p.test(labelKey))) return 'demographic';
  // Greenhouse pairs an input_file with a textarea on resume/cover-letter
  // questions (paste-instead-of-upload). Any file field means this is an
  // attachment question, not a writing prompt — EXCEPT the cover letter,
  // which is genuinely generated even when uploaded as a file.
  const hasFile = fields.some((f) => f.kind === 'file');
  if (hasFile && !/cover letter/.test(labelKey)) return 'file';
  if (PROFILE_PATTERNS.some((p) => p.test(labelKey))) return 'profile';
  if (GENERATED_PATTERNS.some((p) => p.test(labelKey))) return 'generated';
  // A long free-text box that isn't a recognised recurring prompt has to be
  // generated per job. Selects and short text are bankable.
  if (fields.some((f) => f.kind === 'long_text')) return 'generated';
  return 'bank';
}

function mapField(f: GhField): FormField {
  const options: SelectOption[] | undefined = f.values?.length
    ? f.values
        .filter((v) => v.label !== undefined)
        .map((v) => ({ label: String(v.label), value: v.value ?? '' }))
    : undefined;
  return {
    name: f.name ?? '',
    kind: toFieldKind(f.type),
    ...(options ? { options } : {}),
  };
}

function mapQuestion(q: GhQuestion): FormQuestion {
  const label = (q.label ?? '').trim();
  const fields = (q.fields ?? []).map(mapField);
  const labelKey = normaliseLabel(label);
  return {
    label,
    labelKey,
    required: Boolean(q.required),
    fields,
    answerability: classify(labelKey, fields, false),
  };
}

// ─────────────────────────── public API ───────────────────────────

/** Check whether a board token exists and how many jobs it has. */
export async function probeBoard(boardToken: string): Promise<BoardProbe> {
  const res = await fetchJson<GhJobsResponse>(`${BASE}/${encodeURIComponent(boardToken)}/jobs`);
  if (!res.ok || !res.data) {
    return { boardToken, ok: false, status: res.status, jobCount: 0, error: res.error };
  }
  return {
    boardToken,
    ok: true,
    status: res.status,
    jobCount: res.data.jobs?.length ?? 0,
  };
}

/** List every posting on a board (summaries only — no form schema). */
export async function listJobs(boardToken: string): Promise<JobPosting[]> {
  // `content=true` returns every posting's description HTML in the same call.
  // Without it the index holds titles and nothing else to extract skills from,
  // which silently zeroes every match score — the failure looks like a narrow
  // vocabulary rather than a missing request.
  const res = await fetchJson<GhJobsResponse>(
    `${BASE}/${encodeURIComponent(boardToken)}/jobs?content=true`,
  );
  if (!res.ok || !res.data?.jobs) return [];

  return res.data.jobs.flatMap((j) => {
    if (j.id === undefined) return [];
    return [{
      vendor: 'greenhouse' as const,
      boardToken,
      vendorJobId: String(j.id),
      title: j.title ?? '',
      absoluteUrl: j.absolute_url ?? '',
      location: j.location?.name ?? null,
      updatedAt: j.updated_at ?? null,
      companyName: j.company_name ?? null,
      content: j.content ?? null,
    }];
  });
}

/**
 * Fetch the full application form schema for one posting.
 * This is the call that removes the need for a browser during planning.
 */
export async function fetchForm(job: JobPosting): Promise<JobPosting> {
  const url = `${BASE}/${encodeURIComponent(job.boardToken)}/jobs/${job.vendorJobId}?questions=true`;
  const res = await fetchJson<GhJobDetail>(url);
  if (!res.ok || !res.data) return job;

  const questions = (res.data.questions ?? []).map(mapQuestion);
  const demographicQuestionCount = res.data.demographic_questions?.questions?.length ?? 0;
  const complianceNotes = (res.data.compliance ?? [])
    .filter((c) => c.type)
    .map((c) => `${c.type}${c.requires_consent ? ' (consent required)' : ''}`);

  return { ...job, questions, demographicQuestionCount, complianceNotes };
}
