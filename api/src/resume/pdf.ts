/**
 * A PDF writer, in one file, with no dependencies.
 *
 * The repo installs four devDependencies and has no bundler (docs/DECISIONS.md
 * #3). Pulling in a PDF library to lay out ten lines of text would cost more
 * than it returns, and every candidate library brings a font pipeline for
 * glyphs this document never uses. A résumé rendered here is headings, body
 * text and bullets in one standard face — a page generator, not a typesetting
 * engine.
 *
 * The one genuinely hard part is line breaking, and it is hard only if you
 * guess. Helvetica's advance widths are a published table; measuring with them
 * wraps exactly where the reader's PDF viewer will, whereas the usual
 * "characters × average width" shortcut overflows the right margin on any line
 * carrying capitals or punctuation.
 */

const BS = String.fromCharCode(92);
const NL = String.fromCharCode(10);

/**
 * Helvetica and Helvetica-Bold advance widths for ASCII 32–126, in 1/1000 em.
 *
 * From the Adobe Font Metrics for the standard 14 faces, which every PDF
 * viewer resolves without the file embedding anything.
 */
const W_REG = ('278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 '
  + '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 '
  + '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 '
  + '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 '
  + '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 '
  + '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584').split(' ').map(Number);

const W_BOLD = ('278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 '
  + '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 '
  + '975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 '
  + '667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 '
  + '333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 '
  + '611 611 389 556 333 611 556 778 556 556 500 389 280 389 584').split(' ').map(Number);

export type Face = 'regular' | 'bold';

/** Width of "n", used for anything outside the measured range. */
const FALLBACK = 110 - 32;

function widthOf(text: string, size: number, face: Face): number {
  const table = face === 'bold' ? W_BOLD : W_REG;
  let mils = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 32;
    mils += (c >= 32 && c <= 126 ? table[c - 32] : table[FALLBACK]) ?? table[FALLBACK] ?? 556;
  }
  return (mils * size) / 1000;
}

/**
 * Greedy wrap on spaces.
 *
 * A single word wider than the measure is left to overhang rather than
 * hyphenated: a URL broken across lines stops being a URL.
 */
export function wrap(text: string, size: number, face: Face, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (widthOf(candidate, size, face) <= maxWidth || line === '') {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/**
 * Unicode to WinAnsi, the encoding the standard faces are declared with.
 *
 * Latin-1 passes through. Above it, characters are transliterated where there
 * is an obvious equivalent and dropped otherwise: a résumé that silently grows
 * a black diamond where a dash used to be reads as a mistake the candidate
 * made, not one the renderer made.
 */
const SWAP: Record<number, string> = {
  0x2018: "'", 0x2019: "'", 0x201a: "'", 0x2039: "'", 0x203a: "'",
  0x201c: '"', 0x201d: '"', 0x201e: '"',
  0x2013: '-', 0x2014: '-', 0x2212: '-',
  0x2026: '...',
  0x2022: '-', 0x25cf: '-', 0x25aa: '-', 0x00b7: '-',
  0x00a0: ' ', 0x2007: ' ', 0x202f: ' ',
};

function toWinAnsi(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 32;
    const swap = SWAP[c];
    if (swap !== undefined) out += swap;
    else if (c <= 0xff) out += ch;
  }
  return out;
}

/** Escape the three characters that terminate or nest a PDF string. */
function pdfString(s: string): string {
  return toWinAnsi(s)
    .split(BS).join(BS + BS)
    .split('(').join(`${BS}(`)
    .split(')').join(`${BS})`);
}

export interface Line {
  text: string;
  size: number;
  face: Face;
  /** Extra space above this line, in points. */
  spaceBefore?: number;
  /** Indent from the left margin, in points. */
  indent?: number;
  /**
   * Centred across the measure. Used by layouts that centre the name block.
   *
   * Centring needs the measured width, which is why it lives here rather than
   * being faked with leading spaces — a space-padded line is a different string
   * in the PDF, and an employer's ATS reads the string.
   */
  align?: 'left' | 'center';
  /**
   * Extra space between characters, in points — the PDF `Tc` operator.
   *
   * Only applied to short headings that cannot wrap. `wrap()` measures without
   * it, so a tracked line long enough to break would break in the wrong place.
   */
  tracking?: number;
  /** A hairline rule across the measure, below this line. */
  ruleBelow?: boolean;
}

const PAGE_W = 595; // A4 at 72dpi
const PAGE_H = 842;
const MARGIN = 54;
const MEASURE = PAGE_W - MARGIN * 2;

export type PositionedLine = Line & { y: number };

/**
 * Lay lines out into pages, wrapping each to the measure.
 *
 * Kept separate from serialisation so pagination can be asserted on directly,
 * without parsing a PDF back out to find where the breaks landed.
 */
export function paginate(lines: readonly Line[]): PositionedLine[][] {
  const pages: PositionedLine[][] = [];
  let page: PositionedLine[] = [];
  let y = PAGE_H - MARGIN;

  for (const line of lines) {
    const indent = line.indent ?? 0;
    const pieces = wrap(line.text, line.size, line.face, MEASURE - indent);
    // An empty string is a deliberate blank line, not nothing to draw.
    const rendered = pieces.length > 0 ? pieces : [''];
    let first = true;
    for (const piece of rendered) {
      const lead = line.size * 1.32;
      const gap = first ? (line.spaceBefore ?? 0) : 0;
      if (y - gap - lead < MARGIN) {
        pages.push(page);
        page = [];
        y = PAGE_H - MARGIN;
      }
      y -= gap + lead;
      page.push({ ...line, text: piece, y });
      first = false;
    }
  }
  if (page.length > 0) pages.push(page);
  return pages.length > 0 ? pages : [[]];
}

/** Serialise laid-out lines to PDF bytes. */
export function renderPdf(lines: readonly Line[]): Buffer {
  const pages = paginate(lines);

  const contents = pages.map((page) => {
    let out = '';
    for (const line of page) {
      // A rule can sit under an empty line — a spacer whose only job is the
      // rule — so the rule is drawn before the early return for empty text.
      if (line.ruleBelow) {
        const y = (line.y - line.size * 0.42).toFixed(2);
        // 0.5pt hairline in mid grey: heavy enough to read on paper, light
        // enough not to compete with the headings it separates.
        out += `q 0.5 w 0.62 G ${MARGIN} ${y} m ${(PAGE_W - MARGIN).toFixed(2)} ${y} l S Q${NL}`;
      }
      if (line.text === '') continue;

      const font = line.face === 'bold' ? '/F2' : '/F1';
      const indent = line.indent ?? 0;
      const tracking = line.tracking ?? 0;

      let x = MARGIN + indent;
      if (line.align === 'center') {
        const w = widthOf(line.text, line.size, line.face)
          // Tc adds space after every glyph including the last, so the visible
          // width is one gap short of the naive sum. Centring without this
          // correction drifts right by half a gap on a tracked heading.
          + tracking * Math.max(0, [...line.text].length - 1);
        x = MARGIN + (MEASURE - w) / 2;
      }

      out += 'BT ';
      if (tracking) out += `${tracking.toFixed(2)} Tc `;
      out += `${font} ${line.size} Tf 1 0 0 1 ${x.toFixed(2)} ${line.y.toFixed(2)} Tm `
        + `(${pdfString(line.text)}) Tj `;
      // Reset, or the tracking leaks into every later line on the page.
      if (tracking) out += '0 Tc ';
      out += `ET${NL}`;
    }
    return out;
  });

  // 1 catalog, 2 page tree, then one object per page, per content stream, and
  // the two fonts.
  const pageIds = pages.map((_, i) => 3 + i);
  const contentIds = pages.map((_, i) => 3 + pages.length + i);
  const fontReg = 3 + pages.length * 2;
  const fontBold = fontReg + 1;

  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] `
    + `/Count ${pages.length} >>`);
  pages.forEach((_, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> `
      + `/Contents ${contentIds[i]} 0 R >>`);
  });
  contents.forEach((c) => {
    objs.push(`<< /Length ${Buffer.byteLength(c, 'latin1')} >>${NL}stream${NL}${c}endstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = `%PDF-1.4${NL}`;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj${NL}${o}${NL}endobj${NL}`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref${NL}0 ${objs.length + 1}${NL}0000000000 65535 f ${NL}`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n ${NL}`;
  pdf += `trailer${NL}<< /Size ${objs.length + 1} /Root 1 0 R >>${NL}`
    + `startxref${NL}${xref}${NL}%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
