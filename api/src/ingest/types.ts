/**
 * Vendor-neutral types for ATS job data.
 *
 * Design note: these are OURS, not Greenhouse's. Every ATS client normalises
 * into these shapes so the matching, composition and adapter layers never
 * learn a vendor's wire format. Adding Lever/Ashby/Workday later means writing
 * a new client, not touching anything downstream.
 */

export type AtsVendor =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'smartrecruiters'
  | 'recruitee';

/** How a question expects to be answered. Drives the fill strategy. */
export type FieldKind =
  | 'short_text'
  | 'long_text'
  | 'single_select'
  | 'multi_select'
  | 'file'
  | 'boolean'
  | 'unknown';

/**
 * Answerability class — the number that decides whether deterministic
 * adapters are viable. Assigned by classify(), not by the vendor.
 */
export type Answerability =
  | 'profile'   // answerable from stored profile fields alone (name, email, links)
  | 'bank'      // recurring question, answerable from a reusable answer bank
  | 'generated' // needs per-job generation (cover letter, "why this company")
  | 'file'      // resume / transcript upload
  | 'demographic'; // EEO / diversity — must be surfaced to the user, never auto-filled

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface FormField {
  /** Vendor's field name, e.g. "job_application[first_name]" */
  name: string;
  kind: FieldKind;
  options?: SelectOption[];
}

export interface FormQuestion {
  label: string;
  /** Normalised label used for cross-posting frequency counting. */
  labelKey: string;
  required: boolean;
  fields: FormField[];
  answerability: Answerability;
}

export interface JobPosting {
  vendor: AtsVendor;
  /** Vendor tenant identifier — Greenhouse board token, Lever site, etc. */
  boardToken: string;
  vendorJobId: string;
  title: string;
  absoluteUrl: string;
  location: string | null;
  updatedAt: string | null;
  /** Description HTML, when the vendor returns it with the listing. */
  content?: string | null;

  /** Present only once the form schema has been fetched. */
  questions?: FormQuestion[];
  /** Questions the vendor flags as demographic/EEO, kept separate by design. */
  demographicQuestionCount?: number;
  complianceNotes?: string[];
}

export interface BoardProbe {
  boardToken: string;
  ok: boolean;
  status: number;
  jobCount: number;
  error?: string;
  /**
   * A caveat on the numbers above, not a failure.
   *
   * SmartRecruiters answers an unknown tenant with HTTP 200 and
   * `totalFound: 0` — identical to a real tenant with no open roles — so a
   * zero there is unverifiable rather than dead. Any vendor whose probe
   * cannot fully stand behind its own result says so here.
   */
  note?: string;
}
