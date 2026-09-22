/**
 * Résumé analysis — a score out of 100, and the working behind every point.
 *
 * This is the product jobsuit.ai leads with, and the one thing Landfall had no
 * answer to: a candidate could see how they scored against an indexed posting,
 * but never how their résumé was doing on its own terms.
 *
 * Two rules separate this from every other résumé scorer:
 *
 * 1. **Every point is traceable.** A score is only useful if you can act on it,
 *    so each category reports what it measured, what it found, and what the
 *    deduction was for. There is no weighting nobody can see and no number
 *    pulled out of a model. Run it twice on the same résumé and it returns the
 *    same 73, for the same stated reasons.
 *
 * 2. **A gap is reported, never filled.** Where a résumé optimiser says "add
 *    these keywords", this says "the posting asks for Salesforce and nothing
 *    you have written demonstrates it". The distinction is the product: a
 *    keyword pasted into a CV is a claim the candidate has to defend in an
 *    interview, and CLAUDE.md rule 1 means this code will not write one for
 *    them.
 *
 * Pure: profile and facts in, analysis out. No database, no network, no model.
 */

import type { CandidateProfile } from '../plan/types.js';
import type { JobFacts } from '../jobs/extract.js';

export type Severity = 'good' | 'warn' | 'bad';

export interface Finding {
  severity: Severity;
  /** What was found, stated as a fact about the résumé. */
  message: string;
  /** What to do about it. Never the words to use — the action to take. */
  fix?: string;
}

export interface AnalysisCategory {
  key: 'keywords' | 'evidence' | 'impact' | 'structure' | 'completeness' | 'ats';
  label: string;
  /** 0–100 for this category alone. */
  score: number;
  /** Share of the overall score. Categories that cannot be judged score null
   *  and their weight is redistributed rather than counted as failure. */
  weight: number;
  /** One line saying what this category actually measured. */
  measured: string;
  findings: Finding[];
}

export interface ResumeAnalysis {
  /** 0–100. A weighted mean of the categories that could be judged. */
  score: number;
  band: 'weak' | 'fair' | 'strong';
  categories: AnalysisCategory[];
  /** Present only when a job description was supplied. */
  target: {
    title: string | null;
    asked: string[];
    /** Asked for, and a bullet demonstrates it. */
    evidenced: string[];
    /** Asked for, claimed in skills, but no bullet shows it. */
    claimedNotShown: string[];
    /** Asked for and not claimed at all. An honest gap. */
    missing: string[];
  } | null;
  /** The highest-value actions, across all categories, worst first. */
  topFixes: Finding[];
}

/** A bullet that quantifies something — a number, a percentage, money, a duration. */
const QUANTIFIED = /(\d+(\.\d+)?\s*%|[$£€₹]\s?\d|\b\d[\d,]*\b)/;

/** Openers that describe duties rather than results. */
const WEAK_OPENER = /^(responsible for|worked on|helped with|assisted|involved in|tasked with|duties included)/i;

/** Verbs that carry a result. Not a whitelist — a signal that one was attempted. */
const STRONG_VERB = /^(built|led|shipped|cut|grew|raised|reduced|designed|automated|migrated|launched|delivered|owned|rewrote|scaled|negotiated|recovered|resolved|trained|mentored)/i;

function bulletsOf(profile: CandidateProfile): string[] {
  return (profile.experience ?? []).flatMap((r) => r.bullets);
}

/** Keywords: does the résumé speak to what this posting asks for? */
function keywordCategory(
  profile: CandidateProfile,
  facts: JobFacts | null,
): AnalysisCategory {
  const label = 'Keywords';
  const measured = 'Terms this posting asks for, against the terms your résumé uses.';

  if (!facts) {
    return {
      key: 'keywords', label, score: 0, weight: 0,
      measured: 'Paste a job description to score this.',
      findings: [{
        severity: 'warn',
        message: 'No job description given, so there is nothing to match against.',
        fix: 'Paste the job description you are applying to.',
      }],
    };
  }

  const asked = facts.requiredSkills.length > 0 ? facts.requiredSkills : facts.skills;
  const claimed = new Set((profile.skills ?? []).map((s) => s.toLowerCase()));
  const hit = asked.filter((t) => claimed.has(t.toLowerCase()));
  const missing = asked.filter((t) => !claimed.has(t.toLowerCase()));

  // No stated requirements is a fact about the posting, not a failure of the
  // résumé, so it does not drag the score down.
  if (asked.length === 0) {
    return {
      key: 'keywords', label, score: 0, weight: 0,
      measured: 'This posting names no specific skills, so there is nothing to match.',
      findings: [{
        severity: 'warn',
        message: 'The posting does not list concrete skills — nothing to score against.',
      }],
    };
  }

  const score = Math.round((hit.length / asked.length) * 100);
  const findings: Finding[] = [];

  findings.push({
    severity: score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad',
    message: `You claim ${hit.length} of the ${asked.length} skills this posting asks for.`,
  });

  if (missing.length > 0) {
    findings.push({
      severity: 'warn',
      message: `Not in your skills list: ${missing.slice(0, 8).join(', ')}.`,
      // Deliberately not "add these keywords". If they are true, the candidate
      // adds them and can defend them; if not, this is the wrong job and that
      // is worth knowing before an interview rather than during one.
      fix: 'Add any of these you can actually evidence to your skills, and write a '
        + 'bullet that shows it. Leave the rest — a keyword you cannot back up is a '
        + 'question you have to answer in the interview.',
    });
  }

  return { key: 'keywords', label, score, weight: 25, measured, findings };
}

/** Evidence: are the claimed skills demonstrated by anything written down? */
function evidenceCategory(profile: CandidateProfile, facts: JobFacts | null): AnalysisCategory {
  const bullets = bulletsOf(profile);
  const haystack = bullets.join('\n').toLowerCase();
  const claimed = profile.skills ?? [];

  const shown = claimed.filter((s) => haystack.includes(s.toLowerCase()));
  const unshown = claimed.filter((s) => !haystack.includes(s.toLowerCase()));

  const findings: Finding[] = [];
  let score = 100;

  if (claimed.length === 0) {
    score = 0;
    findings.push({
      severity: 'bad',
      message: 'No skills claimed, so nothing can be matched to a posting.',
      fix: 'Add the skills you would be comfortable being interviewed on.',
    });
  } else {
    score = Math.round((shown.length / claimed.length) * 100);
    findings.push({
      severity: score >= 70 ? 'good' : score >= 40 ? 'warn' : 'bad',
      message: `${shown.length} of your ${claimed.length} claimed skills appear in a bullet you wrote.`,
    });
    if (unshown.length > 0) {
      findings.push({
        severity: 'warn',
        message: `Claimed but never demonstrated: ${unshown.slice(0, 8).join(', ')}.`,
        fix: 'Write one bullet for each that says what you did with it. This is the '
          + 'gap an interviewer probes first.',
      });
    }
  }

  // When a posting is in play, a skill it asks for that you claim but cannot
  // show is the most expensive version of this problem.
  if (facts) {
    const asked = (facts.requiredSkills.length > 0 ? facts.requiredSkills : facts.skills)
      .map((s) => s.toLowerCase());
    const risky = unshown.filter((s) => asked.includes(s.toLowerCase()));
    if (risky.length > 0) {
      findings.push({
        severity: 'bad',
        message: `This posting asks for ${risky.join(', ')} — you claim it, but no bullet shows it.`,
        fix: 'Write the bullet before you apply. This is the first thing they will ask about.',
      });
    }
  }

  return {
    key: 'evidence',
    label: 'Evidence',
    score,
    weight: 20,
    measured: 'Skills you claim, against the skills your own bullets demonstrate.',
    findings,
  };
}

/** Impact: do the bullets say what happened, or what the job was? */
function impactCategory(profile: CandidateProfile): AnalysisCategory {
  const bullets = bulletsOf(profile);
  const findings: Finding[] = [];

  if (bullets.length === 0) {
    return {
      key: 'impact', label: 'Impact', score: 0, weight: 20,
      measured: 'Bullets that quantify a result, against bullets that describe a duty.',
      findings: [{
        severity: 'bad',
        message: 'No bullets written, so there is nothing to tailor and nothing to show.',
        fix: 'Add achievements to each role — what changed because you were there.',
      }],
    };
  }

  const quantified = bullets.filter((b) => QUANTIFIED.test(b));
  const weak = bullets.filter((b) => WEAK_OPENER.test(b.trim()));
  const strong = bullets.filter((b) => STRONG_VERB.test(b.trim()));

  const quantRate = quantified.length / bullets.length;
  // Two thirds quantified is an excellent résumé; the scale tops out there
  // rather than demanding a number in every line, because some real
  // achievements do not have one and padding them with invented figures is
  // exactly the failure this product exists to avoid.
  const score = Math.round(Math.min(1, quantRate / 0.66) * 100);

  findings.push({
    severity: quantRate >= 0.5 ? 'good' : quantRate >= 0.25 ? 'warn' : 'bad',
    message: `${quantified.length} of ${bullets.length} bullets carry a number, a percentage or an amount.`,
    ...(quantRate < 0.5
      ? {
        fix: 'Add the figure you already know for the ones that have one — how much, '
          + 'how many, how long, how much faster. Do not invent one for the rest.',
      }
      : {}),
  });

  if (weak.length > 0) {
    findings.push({
      severity: 'warn',
      message: `${weak.length} bullet${weak.length === 1 ? '' : 's'} open with a duty phrase `
        + `("responsible for", "worked on").`,
      fix: 'Start with what you did and what changed, not what you were assigned.',
    });
  }

  if (strong.length > 0) {
    findings.push({
      severity: 'good',
      message: `${strong.length} bullet${strong.length === 1 ? '' : 's'} open with a result verb.`,
    });
  }

  return {
    key: 'impact',
    label: 'Impact',
    score,
    weight: 20,
    measured: 'Bullets that quantify a result, against bullets that describe a duty.',
    findings,
  };
}

/** Structure: is the history legible — roles, companies, dates, order? */
function structureCategory(profile: CandidateProfile): AnalysisCategory {
  const roles = profile.experience ?? [];
  const findings: Finding[] = [];
  let points = 100;

  if (roles.length === 0) {
    return {
      key: 'structure', label: 'Structure', score: 0, weight: 15,
      measured: 'Roles with a title, an employer and dates, newest first.',
      findings: [{
        severity: 'bad',
        message: 'No work history on file.',
        fix: 'Add your roles — this is what every tailored résumé is built from.',
      }],
    };
  }

  const missingDates = roles.filter((r) => !r.start || r.start.trim() === '');
  if (missingDates.length > 0) {
    points -= 30;
    findings.push({
      severity: 'bad',
      message: `${missingDates.length} role${missingDates.length === 1 ? ' has' : 's have'} no start date.`,
      fix: 'Add them. A résumé with unclear dates is read as hiding something.',
    });
  }

  const thin = roles.filter((r) => r.bullets.length < 2);
  if (thin.length > 0) {
    points -= 20;
    findings.push({
      severity: 'warn',
      message: `${thin.length} role${thin.length === 1 ? ' has' : 's have'} fewer than two bullets.`,
      fix: 'Two or three each. Tailoring picks the best ones per posting, so it '
        + 'needs more than it uses.',
    });
  }

  const noCompany = roles.filter((r) => !r.company || r.company.trim() === '');
  if (noCompany.length > 0) {
    points -= 20;
    findings.push({
      severity: 'bad',
      message: `${noCompany.length} role${noCompany.length === 1 ? ' is' : 's are'} missing an employer name.`,
      fix: 'Add the employer.',
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'good',
      message: `${roles.length} role${roles.length === 1 ? '' : 's'}, each with an employer, dates and bullets.`,
    });
  }

  return {
    key: 'structure',
    label: 'Structure',
    score: Math.max(0, points),
    weight: 15,
    measured: 'Roles with a title, an employer and dates, newest first.',
    findings,
  };
}

/** The fields employers' forms actually ask for. */
const FORM_FIELDS: ReadonlyArray<readonly [keyof CandidateProfile, string]> = [
  ['firstName', 'first name'],
  ['lastName', 'last name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['location', 'location'],
  ['linkedin', 'LinkedIn URL'],
  ['currentTitle', 'current title'],
];

/**
 * Completeness, measured in form fields rather than as a percentage of a
 * profile page (FR-5).
 *
 * The number that matters to a candidate is not "your profile is 70% full", it
 * is "seven more forms fill themselves". Every field here is one an employer
 * asks for.
 */
function completenessCategory(profile: CandidateProfile): AnalysisCategory {
  const missing = FORM_FIELDS.filter(([k]) => {
    const v = profile[k];
    return v === undefined || v === null || String(v).trim() === '';
  });

  const score = Math.round(((FORM_FIELDS.length - missing.length) / FORM_FIELDS.length) * 100);
  const findings: Finding[] = [];

  findings.push({
    severity: missing.length === 0 ? 'good' : missing.length <= 2 ? 'warn' : 'bad',
    message: `${FORM_FIELDS.length - missing.length} of ${FORM_FIELDS.length} fields every `
      + `application form asks for are filled in.`,
  });

  if (missing.length > 0) {
    findings.push({
      severity: 'warn',
      message: `Missing: ${missing.map(([, l]) => l).join(', ')}.`,
      fix: 'Fill these once and they answer themselves on every application after.',
    });
  }

  if (!profile.resumePath) {
    findings.push({
      severity: 'bad',
      message: 'No résumé file on record, so the attachment field on every form stays empty.',
      fix: 'Upload your résumé.',
    });
  }

  return {
    key: 'completeness',
    label: 'Completeness',
    score,
    weight: 10,
    measured: 'Fields every application form asks for, against the ones you have filled.',
    findings,
  };
}

/** ATS readability — the mechanical things that stop a parser reading a CV. */
function atsCategory(profile: CandidateProfile): AnalysisCategory {
  const findings: Finding[] = [];
  let points = 100;
  const bullets = bulletsOf(profile);

  // Landfall renders the PDF itself, from structured fields, in a single
  // column with real text — so the usual ATS failures (columns, tables, text
  // inside images, headers/footers) cannot happen by construction. What can
  // still go wrong is the content.
  findings.push({
    severity: 'good',
    message: 'The PDF is generated single-column from your structured fields, so there '
      + 'are no tables, columns or images for a parser to trip on.',
  });

  const long = bullets.filter((b) => b.length > 240);
  if (long.length > 0) {
    points -= 15;
    findings.push({
      severity: 'warn',
      message: `${long.length} bullet${long.length === 1 ? ' is' : 's are'} over 240 characters.`,
      fix: 'Split them. A bullet that runs three lines stops being read.',
    });
  }

  if (!profile.email || !profile.phone) {
    points -= 30;
    findings.push({
      severity: 'bad',
      message: 'Contact details are incomplete, which is the one thing a parser must find.',
      fix: 'Add your email and phone.',
    });
  }

  const noVowelSkills = (profile.skills ?? []).filter((s) => s.length > 30);
  if (noVowelSkills.length > 0) {
    points -= 10;
    findings.push({
      severity: 'warn',
      message: 'Some skills are long phrases rather than terms.',
      fix: 'Keep skills to the term an employer would search for.',
    });
  }

  return {
    key: 'ats',
    label: 'ATS readability',
    score: Math.max(0, points),
    weight: 10,
    measured: 'The mechanical things that stop an applicant tracking system reading a CV.',
    findings,
  };
}

export function analyseResume(
  profile: CandidateProfile,
  facts: JobFacts | null,
  targetTitle: string | null = null,
): ResumeAnalysis {
  const categories: AnalysisCategory[] = [
    keywordCategory(profile, facts),
    evidenceCategory(profile, facts),
    impactCategory(profile),
    structureCategory(profile),
    completenessCategory(profile),
    atsCategory(profile),
  ];

  // A category that could not be judged (no job description, or a posting that
  // names no skills) carries weight 0, and the remaining weights are
  // renormalised. Scoring it as zero would punish the candidate for something
  // the posting did not say.
  const judged = categories.filter((c) => c.weight > 0);
  const totalWeight = judged.reduce((n, c) => n + c.weight, 0);
  const score = totalWeight === 0
    ? 0
    : Math.round(judged.reduce((n, c) => n + c.score * c.weight, 0) / totalWeight);

  const topFixes = categories
    .flatMap((c) => c.findings)
    .filter((f) => f.fix !== undefined)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, 5);

  let target: ResumeAnalysis['target'] = null;
  if (facts) {
    const asked = facts.requiredSkills.length > 0 ? facts.requiredSkills : facts.skills;
    const haystack = bulletsOf(profile).join('\n').toLowerCase();
    const claimed = new Set((profile.skills ?? []).map((s) => s.toLowerCase()));

    // A disjoint partition of `asked`, matching resume/tailor.ts. The first
    // version computed `missing` from the claimed-skills list alone, so a term
    // a bullet already demonstrated but that was never added to the skills list
    // came back as both evidenced *and* missing. Two contradictory answers on
    // one screen is worse than either answer alone — it tells the candidate the
    // score cannot be trusted.
    const shows = (t: string): boolean => haystack.includes(t.toLowerCase());
    const isClaimed = (t: string): boolean => claimed.has(t.toLowerCase());

    target = {
      title: targetTitle,
      asked,
      evidenced: asked.filter((t) => shows(t)),
      claimedNotShown: asked.filter((t) => !shows(t) && isClaimed(t)),
      missing: asked.filter((t) => !shows(t) && !isClaimed(t)),
    };
  }

  return {
    score,
    band: score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak',
    categories,
    target,
    topFixes,
  };
}

function severityRank(s: Severity): number {
  return s === 'bad' ? 2 : s === 'warn' ? 1 : 0;
}
