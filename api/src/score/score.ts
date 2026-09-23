import type { CandidateProfile, FillPlan } from '../plan/types.js';
import { remoteScopeOf } from '../jobs/extract.js';
import type { IndexedJob } from '../jobs/indexer.js';

/**
 * Two scores per posting, deliberately not blended into one.
 *
 *  - **Readiness** is measured. It comes from the compiled fill plan — actual
 *    fields, actually resolved. It is null until the form has been fetched,
 *    because an unmeasured readiness is not a readiness.
 *  - **Match** is inference. It now has real evidence behind it — the skills a
 *    posting asks for in its requirements section, against the skills the
 *    candidate listed — but it is still a guess about a hiring outcome.
 *
 * Averaging them would let the guess borrow the measurement's credibility, so
 * both are reported with their workings.
 */

export interface MatchSignal {
  name: string;
  hit: boolean;
  detail: string;
  weight: number;
}

export interface JobScore {
  readiness: {
    pct: number | null;
    filled: number;
    total: number;
    blocked: boolean;
    needsWriting: number;
    /** False until the form has been fetched. */
    measured: boolean;
  };
  match: {
    score: number;
    signals: MatchSignal[];
    /** Skills the posting asks for that the candidate has listed. */
    haveSkills: string[];
    /** Skills the posting asks for that the candidate has not. */
    missingSkills: string[];
    confidence: 'low' | 'medium' | 'high';
    basis: string[];
  };
}

const TITLE_STOP = new Set([
  'the','a','an','and','or','of','for','to','in','at','on','with','ii','iii','iv',
  'senior','sr','junior','jr','staff','principal','lead','associate','intern','i',
  'manager','director','head','vp','remote','hybrid','onsite','engineer','specialist',
]);

/** Meaningful words in a job title — seniority and generic nouns removed. */
function titleWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z0-9+#\s]/g, ' ').split(/\s+/)
      .filter((t) => t.length > 2 && !TITLE_STOP.has(t)),
  );
}

/** Seniority ladder, lowest first. Compares levels, never ranks people. */
const LADDER = ['intern', 'junior', 'mid', 'senior', 'staff', 'manager'];


/**
 * Which candidate locations satisfy a stated remote scope.
 *
 * Deliberately only the scopes that name a COUNTRY. The regional labels the
 * extractor also recognises — EMEA, APAC, EU, EUROPE, LATAM — are absent on
 * purpose: deciding whether "Jodhpur" sits inside EMEA needs a geography
 * table this repo has no business carrying, and a wrong answer would silently
 * delete a real opportunity from the list. An absent scope here means "cannot
 * decide", and the signal keeps its credit and says so.
 */
const SCOPE_MEMBERS: Record<string, ReadonlySet<string>> = {
  US: new Set(['us', 'usa', 'united states', 'u.s.', 'america', 'united states of america']),
  UK: new Set(['uk', 'united kingdom', 'england', 'scotland', 'wales', 'northern ireland', 'britain']),
  CANADA: new Set(['canada']),
  INDIA: new Set(['india']),
  GERMANY: new Set(['germany', 'deutschland']),
  AUSTRALIA: new Set(['australia']),
  IRELAND: new Set(['ireland']),
  SINGAPORE: new Set(['singapore']),
};

function levelIndex(level: string | null | undefined): number {
  const i = LADDER.indexOf(String(level ?? ''));
  return i === -1 ? 2 : i; // unmarked reads as mid
}

/** Candidate skills, normalised the same way the extractor normalises a posting's. */
function candidateSkills(profile: CandidateProfile): string[] {
  const raw = profile.skills;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
}

export function scoreJob(
  job: IndexedJob,
  plan: FillPlan | null,
  profile: CandidateProfile,
): JobScore {
  const signals: MatchSignal[] = [];
  const basis: string[] = [];

  // ── 1. skills the posting actually asks for ──
  // Requirements-section terms when the posting HAS a requirements section,
  // and the whole posting when it does not. Those are different qualities of
  // evidence — "what the employer says it needs" versus "every term that
  // appeared anywhere, boilerplate included" — so which one was used is
  // reported rather than quietly substituted.
  const stated = job.facts.requiredSkills.length > 0;
  const asks = stated ? job.facts.requiredSkills : job.facts.skills;
  const mine = new Set(candidateSkills(profile));
  const have = asks.filter((s) => mine.has(s));
  const missing = asks.filter((s) => !mine.has(s));

  if (mine.size === 0) {
    signals.push({
      name: 'Skills',
      hit: false,
      weight: 45,
      detail: 'add skills to your profile — this is the strongest signal available',
    });
  } else if (asks.length === 0) {
    signals.push({
      name: 'Skills',
      hit: false,
      weight: 45,
      detail: 'this posting names no skills we recognise',
    });
  } else {
    signals.push({
      name: 'Skills',
      hit: have.length > 0,
      weight: 45,
      // "asked for" is a claim about the employer. Only say it where the
      // posting actually stated requirements; otherwise these are terms that
      // merely appear somewhere in the text.
      detail: have.length > 0
        ? `you have ${have.length} of ${asks.length} ${stated ? 'asked for' : 'mentioned'}: ${have.slice(0, 6).join(', ')}`
        : `none of the ${asks.length} ${stated ? 'asked for' : 'mentioned'}`,
    });
    basis.push(stated
      ? `${asks.length} skills the posting lists as requirements`
      : `${asks.length} skills mentioned anywhere in the posting — it states no requirements`);
  }

  // ── 2. is it even the same kind of job? ──
  //
  // Skills alone put "Graphics Engineer" top of the list for a data analyst,
  // because the posting named one tool they happen to know. What the job IS
  // matters independently of which tools it names, so the title carries its
  // own weight.
  const myTitle = (profile.currentTitle ?? '').trim();
  if (myTitle !== '') {
    const mineWords = titleWords(myTitle);
    const theirs = titleWords(job.title);
    const shared = [...mineWords].filter((t) => theirs.has(t));
    signals.push({
      name: 'Role',
      hit: shared.length > 0,
      weight: 25,
      detail: shared.length > 0
        ? `shares ${shared.map((w) => `"${w}"`).join(', ')} with "${myTitle}"`
        : `"${job.title}" has nothing in common with "${myTitle}"`,
    });
  }

  // ── 3. seniority ──
  if (myTitle !== '') {
    const myLevel = LADDER.find((l) => new RegExp(`\\b${l}\\b`, 'i').test(myTitle)) ?? null;
    const gap = Math.abs(levelIndex(myLevel) - levelIndex(job.facts.level));
    signals.push({
      name: 'Seniority',
      hit: gap <= 1,
      weight: 15,
      detail: `posting reads ${job.facts.level ?? 'unmarked'}, your title reads ${myLevel ?? 'unmarked'}`,
    });
    basis.push('your current title');
  }

  // ── 4. years of experience ──
  if (job.facts.years !== null) {
    const myYears = Number(profile.yearsExperience);
    if (Number.isFinite(myYears)) {
      signals.push({
        name: 'Experience',
        hit: myYears >= job.facts.years,
        weight: 10,
        detail: `asks for ${job.facts.years}+ years, you have ${myYears}`,
      });
      basis.push('your years of experience');
    } else {
      signals.push({
        name: 'Experience',
        hit: false,
        weight: 10,
        detail: `asks for ${job.facts.years}+ years — add yours to your profile`,
      });
    }
  }

  // ── 5. location ──
  const loc = (job.location ?? '').toLowerCase();
  const remote = job.facts.workplace === 'remote';
  const places = [profile.city, profile.state, profile.country, profile.location]
    .filter((p): p is string => Boolean(p && p.trim()))
    .flatMap((p) => p.split(',').map((s) => s.trim().toLowerCase()))
    .filter((p) => p.length > 2);
  const placeHit = places.find((p) => loc.includes(p));
  /** The candidate's home as THEY wrote it — the places list is lowercased for matching. */
  const homeLabel = (profile.country ?? profile.location ?? profile.city ?? '').trim();

  // A remote role is not automatically a role you can take. 137 of the 772
  // postings the index first called remote name a restriction — "Remote - US"
  // — and a candidate outside it is not eligible. Paying the full location
  // weight on those credited a barrier as if it were an opening.
  //
  // The check only fires where it can actually decide. A REGION (EMEA, APAC)
  // cannot be resolved from a city string, and a candidate who has given no
  // country cannot be placed at all; both keep the credit and say so in the
  // detail rather than guessing. Only a stated COUNTRY that is demonstrably
  // not the candidate's withdraws it.
  // The stored column wins: it was computed at ingest from the full description,
  // which is strictly better evidence than the truncated summary kept here.
  const scope = !remote
    ? null
    : (job.facts.remoteScope ?? remoteScopeOf(job.location ?? '', job.facts.summary ?? ''));
  // Only an explicit COUNTRY can settle scope membership. A city cannot:
  // nothing here knows that Jodhpur is outside the US, and withdrawing the
  // credit on a city that merely failed to match would punish a thin profile
  // instead of a real mismatch. No country means undecided, not ineligible.
  const countryTokens = [profile.country, (profile.location ?? '').split(',').pop()]
    .filter((c): c is string => Boolean(c && c.trim()))
    .map((c) => c.trim().toLowerCase());

  const members = scope === null ? undefined : SCOPE_MEMBERS[scope];
  const inScope: boolean | null = members === undefined || countryTokens.length === 0
    ? null
    : countryTokens.some((c) => members.has(c));

  const locationDetail = (): string => {
    if (!remote) {
      return placeHit ? `mentions ${placeHit}`
        : loc === '' ? 'no location given' : `"${job.location}" is not where you are`;
    }
    if (scope === null) return 'remote, no restriction stated';
    if (members === undefined) return `remote within ${scope} — region eligibility not checked`;
    if (inScope === null) return `remote, restricted to ${scope} — add your country to check it`;
    if (inScope) return `remote within ${scope}, where you are`;
    return `remote, but restricted to ${scope} — you are in ${homeLabel || places[places.length - 1]}`;
  };

  signals.push({
    name: 'Location',
    hit: (remote && inScope !== false) || Boolean(placeHit),
    weight: 20,
    detail: locationDetail(),
  });
  if (places.length > 0) basis.push('your location');

  const available = signals.reduce((n, s) => n + s.weight, 0);
  // Partial credit, over an evidence floor. Dividing by the number of skills a
  // posting happens to name lets a job asking ONE tool you know score a perfect
  // 1.0 on thin evidence — measured: a Graphics Engineer role topped the list
  // for a data analyst on a single shared term. The floor of four means thin
  // postings earn thin scores.
  const EVIDENCE_FLOOR = 4;
  const denom = Math.max(asks.length, EVIDENCE_FLOOR);
  const skillFraction = mine.size > 0 && asks.length > 0
    ? Math.min(1, have.length / denom)
    : 0;
  const earned = signals.reduce((n, s) => {
    if (s.name === 'Skills') return n + s.weight * skillFraction;
    return n + (s.hit ? s.weight : 0);
  }, 0);

  const by = (s: string): number => plan?.actions.filter((a) => a.source === s).length ?? 0;
  const total = plan?.actions.length ?? 0;
  const filled = by('profile') + by('bank') + by('file');

  return {
    readiness: {
      pct: plan && total > 0 ? filled / total : null,
      filled,
      total,
      blocked: plan ? plan.blockingUnresolved.length > 0 : false,
      needsWriting: by('generated'),
      measured: plan !== null,
    },
    match: {
      score: available === 0 ? 0 : Math.round((earned / available) * 100),
      signals,
      haveSkills: have,
      missingSkills: missing,
      // 'medium' once real skills are on both sides AND the posting actually
      // stated its requirements; matching against terms scraped from the whole
      // posting is the weaker read and stays 'low'. Never 'high': this is
      // still keyword overlap, not a judgement about whether you would be
      // hired, and no formula over these inputs earns that word.
      confidence: mine.size > 0 && asks.length > 0 && stated ? 'medium' : 'low',
      basis: basis.length > 0 ? basis : ['nothing yet — fill in your profile'],
    },
  };
}

/**
 * Applications worth chasing.
 *
 * Only `applied` counts. Nagging about something marked `skipped` is noise,
 * and nagging about `saved` is nagging about a bookmark.
 */
export function followUpDue(
  applications: Record<string, { status: string; updatedAt: string }>,
  afterDays = 7,
  now = Date.now(),
): Array<{ id: string; days: number }> {
  const due: Array<{ id: string; days: number }> = [];
  for (const [id, app] of Object.entries(applications)) {
    if (app.status !== 'applied') continue;
    const then = Date.parse(app.updatedAt);
    if (Number.isNaN(then)) continue;
    const days = Math.floor((now - then) / 86_400_000);
    if (days >= afterDays) due.push({ id, days });
  }
  return due.sort((a, b) => b.days - a.days);
}
