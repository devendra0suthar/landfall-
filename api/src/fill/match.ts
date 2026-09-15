/**
 * Matching a fill plan onto the fields actually on the page.
 *
 * The plan knows what should go where by field *name*, from the vendor's own
 * schema. The page is the vendor's rendering of that schema, and the two drift:
 * Greenhouse's React renderer drops the `name` attribute on custom selects, so
 * a matcher that trusts `name` alone silently fills a form two thirds of the
 * way and reports success.
 *
 * So matching is layered, each layer weaker than the last, and every match
 * records which layer found it. A field filled by its label rather than its
 * name is not wrong, but it is worth knowing — it is the first sign a vendor
 * has changed their rendering under us.
 *
 * This module is pure. It takes a description of the fields on a page and
 * returns instructions; it never touches a DOM, which is what lets the same
 * logic be proved against a fixture and then run inside an extension.
 */

export type MatchVia = 'name' | 'id' | 'label' | 'none';

/** A field as seen on the page, however it was found. */
export interface PageField {
  /** The DOM name attribute, when the renderer kept one. */
  name: string | null;
  id: string | null;
  /** The visible label text, trimmed. */
  label: string | null;
  kind: 'text' | 'textarea' | 'select' | 'file' | 'checkbox' | 'radio' | 'unknown';
  /** Option labels for a select, in the order the page offers them. */
  options?: string[];
  /** Opaque handle the caller uses to write back into its own page. */
  handle: string;
}

/** One action from the compiled plan, narrowed to what filling needs. */
export interface PlanAction {
  fieldName: string;
  questionLabel: string;
  labelKey: string;
  source: 'profile' | 'bank' | 'file' | 'generated' | 'user' | 'unresolved';
  value?: string | undefined;
  required: boolean;
}

export interface FillInstruction {
  handle: string;
  value: string;
  via: MatchVia;
  questionLabel: string;
  kind: PageField['kind'];
}

export interface SkippedField {
  questionLabel: string;
  reason: string;
}

export interface MatchResult {
  fill: FillInstruction[];
  /** Deliberately not filled, with the reason a candidate would accept. */
  skipped: SkippedField[];
  /** In the plan, not found on the page. The renderer changed, or the form did. */
  unmatched: Array<{ questionLabel: string; fieldName: string; required: boolean }>;
  /** On the page, not in the plan. Usually consent checkboxes the vendor adds late. */
  unplanned: Array<{ label: string; kind: PageField['kind']; required: boolean }>;
}

/** Labels reduced to a comparable shape — the same normalisation ingest uses. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\(optional\)|\(required\)/g, '')
    .replace(/[^\w\s/-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sources that never reach a page automatically.
 *
 * `user` is the whole point of the product's consent position: EEO, privacy
 * notices and attestations are surfaced to the candidate on the employer's own
 * form, never ticked by us. `generated` is prose the candidate has not written
 * yet. `unresolved` has no answer to give.
 */
const NEVER_AUTOFILL: Record<string, string> = {
  user: 'yours to answer — consent, attestation or demographic',
  generated: 'needs prose you have not written yet',
  unresolved: 'nothing stored can answer this',
};

export function matchPlanToPage(
  actions: readonly PlanAction[],
  fields: readonly PageField[],
): MatchResult {
  const result: MatchResult = { fill: [], skipped: [], unmatched: [], unplanned: [] };
  const used = new Set<string>();

  const byName = new Map<string, PageField>();
  const byId = new Map<string, PageField>();
  const byLabel = new Map<string, PageField>();
  for (const f of fields) {
    if (f.name) byName.set(f.name, f);
    if (f.id) byId.set(f.id, f);
    if (f.label) byLabel.set(norm(f.label), f);
  }

  for (const a of actions) {
    const why = NEVER_AUTOFILL[a.source];
    if (why) {
      result.skipped.push({ questionLabel: a.questionLabel, reason: why });
      continue;
    }

    // A resolved action with no value is a bug upstream, not something to
    // paper over by writing an empty string into someone's application.
    const value = a.value;
    if (value === undefined || value === '') {
      result.skipped.push({
        questionLabel: a.questionLabel,
        reason: 'the plan resolved this but carried no value',
      });
      continue;
    }

    let field = byName.get(a.fieldName);
    let via: MatchVia = 'name';
    if (!field) { field = byId.get(a.fieldName); via = 'id'; }
    if (!field) { field = byLabel.get(norm(a.questionLabel)); via = 'label'; }

    if (!field || used.has(field.handle)) {
      result.unmatched.push({
        questionLabel: a.questionLabel,
        fieldName: a.fieldName,
        required: a.required,
      });
      continue;
    }

    // A select only accepts an option it actually offers. Pushing a raw value
    // at a dropdown is how "she/her" ends up in a four-option pronouns field —
    // measured in Phase 0, and the reason profile values go through option
    // matching exactly as banked ones do.
    if (field.kind === 'select') {
      const options = field.options ?? [];
      const hit = options.find((o) => norm(o) === norm(value));
      if (!hit) {
        result.skipped.push({
          questionLabel: a.questionLabel,
          reason: options.length === 0
            ? 'a dropdown whose options the page does not expose'
            : `"${value}" is not one of the ${options.length} options offered`,
        });
        continue;
      }
      used.add(field.handle);
      result.fill.push({ handle: field.handle, value: hit, via, questionLabel: a.questionLabel, kind: field.kind });
      continue;
    }

    used.add(field.handle);
    result.fill.push({ handle: field.handle, value, via, questionLabel: a.questionLabel, kind: field.kind });
  }

  const planned = new Set(actions.map((a) => norm(a.questionLabel)));
  for (const f of fields) {
    if (used.has(f.handle)) continue;
    if (f.label && planned.has(norm(f.label))) continue;
    if (f.kind === 'unknown') continue;
    result.unplanned.push({ label: f.label ?? f.name ?? '(unlabelled)', kind: f.kind, required: false });
  }

  return result;
}
