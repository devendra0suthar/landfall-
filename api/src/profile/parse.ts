import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';
import { termsIn } from '../jobs/extract.js';

/**
 * Reading a résumé, and saying how sure it is.
 *
 * The standing decision in this project is that a résumé is structured data,
 * not a file to parse — tailoring needs the *parts*, and a parser hands back a
 * wall of text that then has to be re-segmented by guesswork. This module is
 * the one sanctioned exception, and only in the shape the decision allows: it
 * **pre-fills a form for the candidate to correct**. It never writes to the
 * profile. Nothing here becomes a stored fact without a person confirming it.
 *
 * That is why every field carries a confidence and a reason rather than just a
 * value. A parser that returns bare strings invites its caller to trust them,
 * and the failure mode of a confidently wrong résumé parse is a form filled
 * with someone else's phone number.
 *
 * Deliberately conservative throughout: where a heuristic could go either way
 * it returns `low` and says why, because a flagged field costs the candidate
 * ten seconds and a wrong one costs them an interview.
 *
 * **Known limits, stated because they bound the feature.** This reads a linear
 * text stream. Two-column layouts, tables and text inside images are common in
 * real CVs and will interleave or vanish — the parser reports low confidence
 * across the board when the shape looks wrong, but it cannot un-scramble a
 * column. It has been exercised against generated PDFs and plain text; it has
 * not been measured against a corpus of real-world CVs, and that measurement
 * is the thing that would tell us whether this is good enough to keep.
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface ParsedField<T> {
  value: T;
  confidence: Confidence;
  /** Why it is not certain. Null when it is. */
  reason: string | null;
  /** Other readings worth offering, when the text was ambiguous. */
  alternatives?: T[];
}

export interface ParsedRole {
  title: ParsedField<string>;
  company: ParsedField<string>;
  start: ParsedField<string>;
  end: ParsedField<string | null>;
  /** Where the role was, when the heading line ends in one ("… — Pune"). */
  location?: ParsedField<string>;
  bullets: Array<ParsedField<string>>;
}

export interface ParsedResume {
  firstName: ParsedField<string>;
  lastName: ParsedField<string>;
  email: ParsedField<string>;
  phone: ParsedField<string>;
  location: ParsedField<string>;
  linkedin: ParsedField<string>;
  currentTitle: ParsedField<string>;
  skills: Array<ParsedField<string>>;
  roles: ParsedRole[];
  /** Fields the candidate must look at before anything is saved. */
  needsReview: number;
  /** Everything read, so nothing is hidden behind a summary. */
  fieldCount: number;
  /** Characters of text recovered — a near-empty read is itself a finding. */
  textLength: number;
  /** Things found and deliberately not kept. */
  excluded: string[];
  warnings: string[];
}

export class UnreadableResume extends Error {}

/* ─────────────────────────── text ─────────────────────────── */

export async function extractResumeText(bytes: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));

  if (ext === '.pdf') {
    try {
      const doc = await getDocumentProxy(new Uint8Array(bytes));
      // mergePages gives one string; the array shape is the per-page form.
      const { text } = await extractText(doc, { mergePages: true });
      return text;
    } catch (err) {
      throw new UnreadableResume(
        'That PDF could not be read as text. Scanned or image-only PDFs have no text '
        + 'layer to extract — you can still upload it as your attachment, but the fields '
        + 'below have to be typed in.',
        { cause: err },
      );
    }
  }

  if (ext === '.docx') {
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return value;
  }

  if (ext === '.txt' || ext === '.md') return bytes.toString('utf8');

  throw new UnreadableResume(
    `Landfall cannot read text out of a ${ext} file. PDF, DOCX, TXT and MD work.`,
  );
}

/* ─────────────────────────── patterns ─────────────────────────── */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Deliberately loose on format and strict on length: international numbers take
// every shape, and rejecting a real one is worse than flagging an odd one.
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d[\d\s.-]{7,14}\d/g;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i;

const SECTION = {
  experience: /^(work\s+)?(experience|employment|professional\s+experience|career)\b/i,
  skills: /^(technical\s+)?(skills|competencies|technologies|tools)\b/i,
  education: /^(education|qualifications|academic)\b/i,
  other: /^(projects|publications|awards|interests|references|summary|profile|objective)\b/i,
};

/** A line that is plausibly a date range on a role. */
const DATE_RANGE = new RegExp(
  '(?<start>(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*\\d{2,4}|\\d{1,2}/\\d{4}|\\d{4})'
  + '\\s*(?:[-–—]|to)\\s*'
  + '(?<end>(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?\\s*\\d{2,4}|\\d{1,2}/\\d{4}|\\d{4}|present|current|now)',
  'i',
);

/** Two-digit years with no month: '21–'23 is a guess, and is flagged as one. */
const SHORT_YEARS = /'\d{2}\s*[-–—]\s*'?\d{2}/;

const BULLET = /^\s*[-•*·▪‣]\s+/;

/** Never stored, never inferred (FR-6, GDPR Art. 9). */
const EXCLUDED = [
  { label: 'date of birth', re: /\b(date of birth|d\.?o\.?b\.?|born on)\b/i },
  { label: 'marital status', re: /\bmarital status\b/i },
  { label: 'gender', re: /^\s*(gender|sex)\s*[:\-]/im },
  { label: 'nationality', re: /\bnationality\b/i },
  { label: 'photograph', re: /\b(photograph|passport size photo)\b/i },
  { label: "father's or spouse's name", re: /\b(father'?s name|spouse'?s name)\b/i },
];

/** "Jodhpur, Rajasthan, India" — words and commas, no digits, no address. */
const isPlace = (seg: string): boolean =>
  /^[\p{L} .'-]+,[\p{L} ,.'-]+$/u.test(seg) && seg.length < 80 && !seg.includes('@') && !/\d/.test(seg);

/* ─────────────────────────── parse ─────────────────────────── */

const sure = <T>(value: T): ParsedField<T> => ({ value, confidence: 'high', reason: null });
const unsure = <T>(value: T, confidence: Confidence, reason: string, alternatives?: T[]): ParsedField<T> =>
  ({ value, confidence, reason, ...(alternatives ? { alternatives } : {}) });

export function parseResume(raw: string): ParsedResume {
  const text = raw.replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const warnings: string[] = [];

  if (text.trim().length < 120) {
    warnings.push(
      'Almost no text came out of this file. If it is a scan or an image, there is '
      + 'nothing to read and the fields below need typing in.',
    );
  }

  // ── contact ──
  const emails = [...new Set(text.match(EMAIL) ?? [])];
  const email = emails.length === 1
    ? sure(emails[0]!)
    : emails.length > 1
      ? unsure(emails[0]!, 'medium', `${emails.length} addresses appear in the file`, emails)
      : unsure('', 'low', 'no email address found in the text');

  const phones = [...new Set((text.match(PHONE) ?? []).map((p) => p.trim()))]
    .filter((p) => {
      const digits = p.replace(/\D/g, '').length;
      if (digits < 8 || digits > 15) return false;
      // "2019 - 2022" is eight digits and a separator, which is exactly the
      // shape of a phone number and exactly not one. Every résumé has date
      // ranges, so without this the real number is always reported as one of
      // several and flagged for no reason the candidate can act on.
      if (/^(19|20)\d{2}\s*[-–—/]\s*(19|20)\d{2}$/.test(p)) return false;
      return true;
    });
  const phone = phones.length === 1
    ? sure(phones[0]!)
    : phones.length > 1
      ? unsure(phones[0]!, 'medium', `${phones.length} numbers appear — one may be a landline`, phones)
      : unsure('', 'low', 'no phone number found in the text');

  const linkedinHit = text.match(LINKEDIN);
  const linkedin = linkedinHit
    ? sure(linkedinHit[0].startsWith('http') ? linkedinHit[0] : `https://${linkedinHit[0]}`)
    : unsure('', 'low', 'no LinkedIn URL found');

  // ── name: the first line, if it looks like one ──
  const first = lines[0] ?? '';
  const looksLikeName = /^[\p{L}][\p{L}'.\- ]{1,48}$/u.test(first)
    && first.split(/\s+/).length <= 4
    && !EMAIL.test(first);
  const nameParts = looksLikeName ? first.split(/\s+/) : [];
  const firstName = looksLikeName
    ? unsure(nameParts[0]!, 'medium', 'read from the first line of the document')
    : unsure('', 'low', 'the first line does not look like a name');
  const lastName = looksLikeName && nameParts.length > 1
    ? unsure(nameParts.slice(1).join(' '), 'medium', 'read from the first line of the document')
    : unsure('', 'low', 'no surname could be separated from the first line');

  // ── title and location: the two lines under the name, when they fit ──
  // The title is often not the very next line: "Name / contact line / Title"
  // is as common as "Name / Title / contact line". So the first of the next
  // three lines that is not contact details, a URL or a section heading. Still
  // only medium — a tagline passes every one of these tests.
  const isContact = (l: string): boolean =>
    l.includes('@') || /linkedin\.com|https?:\/\/|www\./i.test(l) || /\d{5,}|\+\d/.test(l)
    || l.split(/\s+[-–—|·]\s+/).length > 2;
  const isHeading = (l: string): boolean => Object.values(SECTION).some((re) => re.test(l));
  const titleLine = looksLikeName
    ? lines.slice(1, 4).find((l) => !isContact(l) && !isHeading(l) && l.length < 60
      && !DATE_RANGE.test(l) && !isPlace(l))
    : undefined;
  const currentTitle = titleLine
    ? unsure(titleLine, 'medium', 'a line near your name — often a title, sometimes a tagline')
    : unsure('', 'low', 'no line near your name looked like a job title');

  // The contact line usually carries the location beside the email and phone:
  // "priya@x.in - +91 98290 41765 - Jodhpur, Rajasthan, India". Skipping every
  // line containing an "@" skipped the only line the location was ever on, so
  // the line is split on its separators and each segment judged on its own.
  const locationLine = lines.slice(0, 6)
    .flatMap((l) => l.split(/\s+[-–—|·]\s+/))
    .map((seg) => seg.trim())
    .find(isPlace);
  const location = locationLine
    ? unsure(locationLine, 'low',
      "guessed from a line near the top — check it is your location, not an employer's")
    : unsure('', 'low', 'no location line found');

  // ── sections ──
  const idx = (re: RegExp): number => lines.findIndex((l) => re.test(l));
  const skillsAt = idx(SECTION.skills);
  const expAt = idx(SECTION.experience);

  // ── skills ──
  const skills: Array<ParsedField<string>> = [];
  if (skillsAt >= 0) {
    const end = lines.slice(skillsAt + 1).findIndex((l) =>
      SECTION.experience.test(l) || SECTION.education.test(l) || SECTION.other.test(l));
    const block = lines.slice(skillsAt + 1, end === -1 ? skillsAt + 8 : skillsAt + 1 + end).join(' ');
    const candidates = [...new Set(block.split(/[,;|·•]|\s-\s/).map((s) => s.trim().toLowerCase()))]
      .filter((s) => s.length > 1 && s.length < 40);
    // A term the extractor recognises can actually match a posting. One it does
    // not is still the candidate's to claim — it is offered, and flagged as
    // invisible to matching rather than dropped silently.
    for (const c of candidates) {
      const known = termsIn(c).includes(c);
      skills.push(known
        ? unsure(c, 'high', null as unknown as string)
        : unsure(c, 'low', 'not in the matcher\'s vocabulary — it will never match a posting'));
    }
  } else {
    warnings.push('No skills section was found, so nothing is pre-filled there.');
  }

  // ── experience ──
  const roles: ParsedRole[] = [];
  if (expAt >= 0) {
    // Skills ends the block too. It used not to, so a SKILLS heading after the
    // roles was read as more experience and "Python, SQL, Airflow…" came back
    // as a third job titled "Python" with no dates.
    const endAt = lines.slice(expAt + 1).findIndex((l) =>
      SECTION.education.test(l) || SECTION.other.test(l) || SECTION.skills.test(l));
    const block = lines.slice(expAt + 1, endAt === -1 ? lines.length : expAt + 1 + endAt);

    let current: ParsedRole | null = null;
    for (const line of block) {
      if (BULLET.test(line)) {
        current?.bullets.push(sure(line.replace(BULLET, '').trim()));
        continue;
      }

      const dates = line.match(DATE_RANGE);
      if (dates?.groups && current) {
        const ambiguous = SHORT_YEARS.test(line);
        current.start = ambiguous
          ? unsure(dates.groups.start!, 'low', 'written as two digits — the months are a guess')
          : sure(dates.groups.start!);
        const rawEnd = dates.groups.end!;
        const present = /present|current|now/i.test(rawEnd);
        current.end = present
          ? sure(null)
          : ambiguous
            ? unsure(rawEnd, 'low', 'written as two digits — the months are a guess')
            : sure(rawEnd);
        continue;
      }

      // A heading line: "Title, Company", "Title at Company", "Title — Company".
      // The comma needs no leading space: "Analyst, Tessellate Labs" is the
      // common shape, and an earlier version demanded whitespace on both sides
      // of every separator, so it matched nothing and every résumé came back
      // with zero roles.
      // A trailing "— Pune" / "| Bengaluru, India" is where the role was, not
      // part of the employer's name. Treating every separator alike stored
      // "Example Analytics Pvt Ltd, Bengaluru" as the company, and that exact
      // string went into every "Current company" field on every form. Only a
      // dash or bar marks it, and only a place-shaped tail qualifies — so
      // "Acme — Inc" or "Tessellate Labs | Remote team" stay in the name.
      const tail = line.match(/\s+[—–|]\s+([^—–|]+)$/);
      const tailText = tail?.[1]?.trim() ?? '';
      const tailIsPlace = tail !== null
        && /^[\p{L} .'-]+(,[\p{L} .'-]+)*$/u.test(tailText)
        && tailText.split(/\s+/).length <= 4
        && !/^(inc|ltd|llc|pvt|gmbh|corp|co|plc|limited|remote team)\.?$/i.test(tailText);
      const head = tailIsPlace ? line.slice(0, tail!.index) : line;
      const split = head
        .split(/\s*,\s*|\s+at\s+|\s*[—–|]\s*/)
        .map((x) => x.trim())
        .filter((x) => x !== '');
      if (split.length >= 2 && head.length < 90) {
        if (current) roles.push(current);
        current = {
          title: unsure(split[0]!.trim(), 'medium', 'split from a "title, company" line'),
          company: unsure(split.slice(1).join(', ').trim(), 'medium', 'split from a "title, company" line'),
          start: unsure('', 'low', 'no date range found for this role'),
          end: unsure(null, 'low', 'no date range found for this role'),
          ...(tailIsPlace ? { location: unsure(tailText, 'medium', 'the end of the role heading') } : {}),
          bullets: [],
        };
      }
    }
    if (current) roles.push(current);
  } else {
    warnings.push('No experience section was found. Roles and bullets have to be entered by hand.');
  }

  if (roles.length === 0 && expAt >= 0) {
    warnings.push(
      'An experience section was found but no roles could be separated out of it — '
      + 'often a two-column layout, which arrives as interleaved text.',
    );
  }

  // ── what was found and deliberately dropped ──
  const excluded = EXCLUDED.filter((e) => e.re.test(text)).map((e) => e.label);

  const fields: Array<ParsedField<unknown>> = [
    firstName, lastName, email, phone, location, linkedin, currentTitle,
    ...skills,
    ...roles.flatMap((r) => [r.title, r.company, r.start, r.end, ...r.bullets]),
  ];

  return {
    firstName,
    lastName,
    email,
    phone,
    location,
    linkedin,
    currentTitle,
    skills,
    roles,
    needsReview: fields.filter((f) => f.confidence !== 'high').length,
    fieldCount: fields.length,
    textLength: text.length,
    excluded,
    warnings,
  };
}
