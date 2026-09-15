/**
 * Turn a posting's HTML description into structured, matchable signal.
 *
 * No model. The same reasoning as the answerability classifier in
 * `greenhouse.ts`: this runs over tens of thousands of postings, it has to be
 * free, and — more importantly — it has to be auditable. When a job shows a
 * match of 72 the candidate is owed the list of terms that produced it, and a
 * curated vocabulary can give that. An embedding cannot.
 *
 * The vocabulary is deliberately hand-written and deliberately incomplete. A
 * term in the list is a term we can explain; a term absent from it is missed
 * signal, which is a cost we can see. The alternative — stemming every noun in
 * the description and calling the overlap a match — produces high scores from
 * words like "team" and "customer" and cannot tell anyone why.
 */

/**
 * Skills, tools and domains worth matching on, grouped only for readability.
 *
 * One rule decides what may be in here, and it was learned by auditing the
 * index rather than by taste: **a term whose ordinary English use is a verb or
 * a generic noun cannot carry skill signal.** Measured on 3,319 real postings —
 *
 *   go      195 hits  "products that go out to our customers"
 *   excel   170 hits  "We excel in modernizing software"
 *   rest     65 hits  "the rest of the teams"
 *   spring   22 hits  "Winter, Spring, and Fall Fridays"
 *
 * All four are removed, and the unambiguous forms (`golang`, `spring boot`,
 * `rest api`) carry the meaning instead. Terms that survived the same audit —
 * `audit`, `quota`, `ui`, `saas`, `shell`, `security` — did so because their
 * sampled contexts were genuinely about the work.
 */
const VOCAB: readonly string[] = [
  // languages
  'python', 'javascript', 'typescript', 'java', 'kotlin', 'swift', 'golang',
  'rust', 'ruby', 'php', 'c++', 'c#', 'scala', 'elixir', 'erlang', 'haskell',
  'matlab', 'sql', 'bash', 'shell', 'perl', 'dart', 'objective-c', 'solidity',
  // web & mobile
  'react', 'react native', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'remix',
  'node.js', 'nodejs', 'express', 'django', 'flask', 'fastapi', 'rails',
  'spring boot', '.net', 'laravel', 'graphql', 'rest api', 'restful', 'grpc',
  'html', 'css', 'tailwind', 'sass', 'webpack', 'vite', 'ios', 'android', 'flutter',
  // data & ml
  'pandas', 'numpy', 'scikit-learn', 'pytorch', 'tensorflow', 'keras', 'spark',
  'hadoop', 'airflow', 'dbt', 'snowflake', 'redshift', 'bigquery', 'databricks',
  'kafka', 'flink', 'etl', 'elt', 'data warehouse', 'data pipeline', 'data modeling',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'llm',
  'recommendation', 'forecasting', 'a/b testing', 'experimentation', 'statistics',
  'tableau', 'looker', 'power bi', 'dashboards', 'analytics',
  // infra
  'aws', 'gcp', 'azure', 'kubernetes', 'docker', 'terraform', 'ansible', 'helm',
  'ci/cd', 'jenkins', 'github actions', 'gitlab ci', 'linux', 'nginx',
  'microservices', 'serverless', 'lambda', 'observability', 'prometheus',
  'grafana', 'datadog', 'sre', 'devops', 'infrastructure as code',
  // databases
  'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch',
  'dynamodb', 'cassandra', 'clickhouse', 'sqlite', 'neo4j',
  // security
  'security', 'appsec', 'penetration testing', 'iam', 'oauth', 'saml', 'sso',
  'encryption', 'compliance', 'soc 2', 'gdpr', 'hipaa', 'pci',
  // product, design, business
  'product management', 'roadmap', 'user research', 'figma', 'prototyping',
  'design system', 'accessibility', 'ux', 'ui', 'wireframes',
  'salesforce', 'hubspot', 'crm', 'saas', 'b2b', 'b2c', 'enterprise sales',
  'account management', 'quota', 'lead generation', 'negotiation',
  'go-to-market', 'content marketing', 'seo', 'campaigns',
  'recruiting',
  'financial modeling', 'forecasting', 'budgeting', 'audit', 'gaap', 'microsoft excel',
  // ways of working
  'agile', 'scrum', 'kanban', 'stakeholder management', 'mentoring',
  'code review', 'technical writing', 'on-call',
];

/** Multi-word terms first, so "react native" is not consumed by "react". */
const SORTED_VOCAB = [...VOCAB].sort((a, b) => b.length - a.length);

/**
 * Workplace arrangement, ordered by how much each phrase actually commits to.
 *
 * STRONG_REMOTE is a claim about the ROLE. A bare "remote" is not: it also
 * fires on "Hybrid: 1-2 days per week onsite", on "remote and hybrid
 * workforces", and on every technical use of the word. Measured on the 3,319
 * posting index, the old rule put 29 postings that say "hybrid" and 16 that
 * say "onsite" into the remote bucket — including two whose TITLE ends in
 * "(Hybrid)" — because a bare match was tested first and won.
 *
 * So bare "remote" is consulted only once nothing more specific has been
 * found, and the title outranks the body either way.
 */
const STRONG_REMOTE = /\b(fully remote|100% remote|remote[- ](first|only|position|role|based)|work from home|wfh|distributed team)\b/i;
const BARE_REMOTE = /\bremote\b/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /\b(on[- ]?site|in[- ]office|in person)\b/i;

/** The three arrangements a posting can commit to. */
export type Workplace = 'remote' | 'hybrid' | 'onsite';

/**
 * Classify the working arrangement, most explicit evidence first.
 *
 * Order is the whole point. The title wins when it names an arrangement,
 * because "(Hybrid)" in a job title is the employer stating terms rather than
 * prose mentioning a word. Below that, an unambiguous remote phrase beats
 * "hybrid", "hybrid" beats a bare "remote", and a bare "remote" is the last
 * thing consulted rather than the first.
 *
 * Returning null is a real answer: plenty of postings simply never say.
 */
export function classifyWorkplace(title: string, searchable: string): Workplace | null {
  for (const [arrangement, re] of TITLE_ARRANGEMENT) {
    if (re.test(title)) return arrangement;
  }
  if (STRONG_REMOTE.test(searchable)) return 'remote';
  if (HYBRID.test(searchable)) return 'hybrid';
  if (ONSITE.test(searchable)) return 'onsite';
  if (BARE_REMOTE.test(searchable)) return 'remote';
  return null;
}

/**
 * The geography a remote role is restricted to, as a short label, or null.
 *
 * 137 of the 772 postings the index called remote name a restriction like
 * "Remote - US". A candidate outside it is not eligible, so handing the
 * Location signal a flat "remote" credited them for a role they cannot take.
 *
 * Null means unstated, which is not the same as unrestricted — the caller is
 * expected to say "not stated" rather than "anywhere".
 */
export function remoteScopeOf(location: string, body: string): string | null {
  const m = REMOTE_SCOPE.exec(`${location}\n${body}`);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').toLowerCase();
  if (!raw) return null;
  return SCOPE_LABEL[raw] ?? raw.toUpperCase();
}

/** An arrangement named in the TITLE — the employer being explicit about it. */
const TITLE_ARRANGEMENT: ReadonlyArray<readonly [Workplace, RegExp]> = [
  ['hybrid', /\bhybrid\b/i],
  ['remote', /\bremote\b/i],
  ['onsite', /\b(on[- ]?site|in[- ]office)\b/i],
];

/**
 * Where a remote role will actually accept you from — "Remote - US",
 * "Remote (EMEA)", "UK-based".
 *
 * Null means the posting named no restriction, NOT that there is none. An
 * unstated scope is unknown, and the Location signal says so rather than
 * assuming the whole world is eligible.
 */
const REMOTE_SCOPE = /\b(?:remote|wfh)\b[^.\n]{0,30}?\b(united states|united kingdom|usa|u\.s\.|us|uk|canada|emea|apac|latam|europe|eu|india|germany|australia|ireland|singapore)\b|\b(us|uk|eu|emea|canada|india)[- ]?(?:only|based)\b/i;

const SCOPE_LABEL: Record<string, string> = {
  'united states': 'US', usa: 'US', 'u.s.': 'US', us: 'US',
  'united kingdom': 'UK', uk: 'UK',
};

const LEVEL_WORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ['intern', /\b(intern|internship|co-op|trainee)\b/i],
  ['junior', /\b(junior|jr\.?|entry[- ]level|graduate|associate)\b/i],
  ['mid', /\b(mid[- ]level|intermediate)\b/i],
  ['senior', /\b(senior|sr\.?)\b/i],
  ['staff', /\b(staff|principal|lead|architect)\b/i],
  ['manager', /\b(manager|head of|director|vp|vice president)\b/i],
];

/**
 * Years of experience asked for.
 *
 * Returns the LOW end of a range, because that is the bar being set —
 * reporting "5" for "3-5 years" would tell a candidate with 3 years they do
 * not qualify when the posting says they do.
 *
 * The match must sit next to the word "experience". Without that anchor the
 * first version picked up "in the last 3 years", "founded 10 years ago" and
 * "3 years of runway", and reported them as a requirement — measured on a real
 * board, where two identical titles came back wanting 3 and 10 years.
 */
export function requiredYears(text: string): number | null {
  const re = /(\d{1,2})\s*(?:\+|-|–|\s+to\s+)?\s*(?:\d{1,2})?\s*\+?\s*years?\b([^.\n]{0,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const trailing = m[2] ?? '';
    const leading = text.slice(Math.max(0, m.index - 30), m.index);
    if (!/experience|exp\b|working|background|industry/i.test(trailing + leading)) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 30) return n;
  }
  return null;
}

/** Strip HTML to readable text. Entities first, then tags, then whitespace. */
export function htmlToText(html: string): string {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&rsquo;|&#8217;/g, '’')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The requirements half of a posting, where findable.
 *
 * Most of a job description is company marketing. The terms that matter for
 * matching cluster under a "Requirements" / "What you'll need" heading, and
 * scoring against the marketing copy is how "we are a fast-paced team" starts
 * counting as a skill. Falls back to the whole text when no heading is found,
 * which is honest — a worse signal, not a wrong one.
 */
/**
 * A heading, not a sentence that happens to contain the word.
 *
 * The old rule was one regex over the whole document, and `\bskills?\b` in it
 * matched lines like "• Excellent written and verbal communication skills" —
 * a bullet in the middle of a list. The section then started there and ran
 * 2,600 characters forward, swallowing whatever followed. Measured over five
 * boards' full descriptions, 155 of the lines it accepted as headings were
 * bullets or sentences.
 *
 * A real heading is short, carries no bullet marker, and does not end in
 * sentence punctuation.
 */
const HEADING_WORD = /\b(requirements?|qualifications?|what you.{0,5}ll need|what we.{0,5}re looking for|who you are|skills?|you have|minimum qualifications)\b/i;
const STOP_WORD = /\b(benefits?|perks?|compensation|salary|pay range|about us|why join|equal opportunity|eeo|our values|what we offer|life at|diversity|accommodations?)\b/i;
const BULLET_START = /^\s*(?:[•●▪◦‣*·+-]|\d+[.)])\s/;

function isHeadingLike(line: string, word: RegExp): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (BULLET_START.test(t)) return false;
  if (/[.,;]$/.test(t)) return false;
  return word.test(t);
}

/**
 * The part of a posting that states what the employer requires.
 *
 * Returns an EMPTY section when no heading is found, and that is the point.
 * The previous version returned the entire document in that case, so
 * `requiredSkills` silently became "every term anywhere in the posting" —
 * company boilerplate, benefits copy and all. It was measurable: `security`
 * ranked as the single most-required skill across the index, ahead of
 * `python`, on the strength of one company's "about us" paragraph repeated
 * across its whole board — including on a posting titled "General Candidate
 * Application", which states no requirements at all.
 *
 * Empty plus `found: false` says "this posting does not tell us", which
 * callers can act on. A whole document labelled "requirements" cannot be
 * distinguished from a real one.
 */
export function requirementsSection(text: string): { section: string; found: boolean } {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => isHeadingLike(l, HEADING_WORD));
  if (start === -1) return { section: '', found: false };

  const after = lines.slice(start + 1);
  // Stop at the next heading-ish line, so benefits copy does not leak in.
  const stop = after.findIndex((l) => isHeadingLike(l, STOP_WORD));
  const body = (stop === -1 ? after : after.slice(0, stop)).join('\n');

  // Hard cap even when no closing heading is found. Boards that use no
  // headings at all would otherwise hand back the entire document — including
  // the benefits and EEO boilerplate every posting ends with — and call it
  // "requirements". Measured: without this, `benefits` was the single
  // most-"required" term across the index, ahead of python.
  const CAP = 2600;
  return { section: body.slice(0, CAP).trim(), found: true };
}

export interface JobFacts {
  /** Vocabulary terms present, deduped, in vocabulary order. */
  skills: string[];
  /**
   * Terms found specifically in the requirements section.
   *
   * EMPTY when the posting states no requirements section — not a copy of
   * `skills`. A caller that wants a fallback has to choose it deliberately
   * and say which evidence it used.
   */
  requiredSkills: string[];
  /** Whether a requirements heading was actually found. */
  requirementsFound: boolean;
  level: string | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
  years: number | null;
  /** Readable description, truncated. The index does not store full HTML. */
  summary: string;
  /** Characters of description the posting actually had, before truncation. */
  descriptionChars: number;
}

/**
 * Vocabulary terms present in a string.
 *
 * Exported so résumé bullets are scored against exactly the same vocabulary a
 * posting is parsed with. Two different term lists would let a bullet "match"
 * a skill the job extractor never recognised.
 */
export function termsIn(haystack: string): string[] {
  const lower = haystack.toLowerCase();
  const found: string[] = [];
  const consumed: Array<[number, number]> = [];

  for (const term of SORTED_VOCAB) {
    // Word-boundary match that tolerates the punctuation in "c++", "ci/cd".
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9+#./])${escaped}($|[^a-z0-9+#./])`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const start = m.index + (m[1]?.length ?? 0);
      const end = start + term.length;
      // A longer term already claimed this span — "react native" beats "react".
      if (consumed.some(([s, e]) => start < e && end > s)) continue;
      consumed.push([start, end]);
      found.push(term);
      break;
    }
  }
  return found;
}

export function extractFacts(titleAndBody: string, html: string, summaryChars = 1400): JobFacts {
  const text = htmlToText(html);
  const { section, found } = requirementsSection(text);
  const searchable = `${titleAndBody}\n${text}`;

  // Level comes from the TITLE only. The first version fell back to the body
  // and reported "Abuse Investigator" as staff-level, because the description
  // said "lead investigations". Seniority lives in the title; a body mention
  // of "lead" or "director" is usually about who you work with. No level is a
  // better answer than a confident wrong one.
  const level = LEVEL_WORDS.find(([, re]) => re.test(titleAndBody))?.[0] ?? null;

  const workplace = classifyWorkplace(titleAndBody, searchable);

  return {
    skills: termsIn(searchable),
    requiredSkills: termsIn(section),
    requirementsFound: found,
    level,
    workplace,
    years: requiredYears(section) ?? requiredYears(text),
    summary: text.slice(0, summaryChars),
    descriptionChars: text.length,
  };
}
