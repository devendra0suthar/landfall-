import { fetchJson } from '../lib/http.js';
import { extractFacts } from './extract.js';
import type { JobFacts } from './extract.js';

/**
 * Build a live job index from the boards discovery found.
 *
 * One request per board. `?content=true` returns every posting on a board
 * *with its full description*, which is the fact this whole design rests on —
 * 625 jobs and 4.8 MB from a single call, no per-job fetch, no extra
 * rate-limit pressure. Checked before committing to it, not assumed.
 *
 * What is deliberately NOT in the index: the application form. Form schemas
 * cost one request per posting, and at index scale that is tens of thousands
 * of requests for data the candidate will never look at — nobody applies to
 * 5,000 jobs. So the index carries what browsing and matching need, and the
 * form is fetched when a job is actually opened or prepared. Cheap browse,
 * lazy form.
 */

const BASE = 'https://boards-api.greenhouse.io/v1/boards';

interface GhListJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  first_published?: string;
  content?: string;
  company_name?: string;
  departments?: Array<{ name?: string }>;
  offices?: Array<{ name?: string }>;
  requisition_id?: string;
}

export type IndexVendor = 'greenhouse' | 'ashby' | 'lever';

export interface IndexedJob {
  id: string;
  vendor: IndexVendor;
  boardToken: string;
  vendorJobId: string;
  company: string;
  title: string;
  absoluteUrl: string;
  location: string | null;
  department: string | null;
  office: string | null;
  updatedAt: string | null;
  firstPublished: string | null;
  facts: JobFacts;
  /**
   * Whether this repo can read the posting's application form.
   *
   * Greenhouse publishes form schemas; Ashby and Lever do not — measured, see
   * the README's split table. So those postings are fully browsable, matchable
   * and tailorable, and the answer sheet simply is not available for them. That
   * is a real limitation of the vendor and the app says so rather than
   * pretending the form failed to load.
   */
  formReadable: boolean;
}

export interface BoardResult {
  vendor: IndexVendor;
  boardToken: string;
  ok: boolean;
  status: number;
  jobs: IndexedJob[];
  /** Postings the board returned but which carried no description at all. */
  withoutContent: number;
}

function contentUrl(board: string): string {
  return `${BASE}/${encodeURIComponent(board)}/jobs?content=true`;
}

export async function indexBoard(board: string): Promise<BoardResult> {
  const res = await fetchJson<{ jobs?: GhListJob[] }>(contentUrl(board));
  if (!res.ok || !res.data?.jobs) {
    return { vendor: 'greenhouse', boardToken: board, ok: false, status: res.status, jobs: [], withoutContent: 0 };
  }

  let withoutContent = 0;
  const jobs: IndexedJob[] = [];

  for (const j of res.data.jobs) {
    if (j.id === undefined || !j.title) continue;
    const html = j.content ?? '';
    if (html.trim() === '') withoutContent++;

    jobs.push({
      id: `greenhouse:${board}:${j.id}`,
      vendor: 'greenhouse',
      boardToken: board,
      vendorJobId: String(j.id),
      company: j.company_name?.trim() || board,
      title: j.title.trim(),
      absoluteUrl: j.absolute_url ?? '',
      location: j.location?.name?.trim() || null,
      department: j.departments?.[0]?.name?.trim() || null,
      office: j.offices?.[0]?.name?.trim() || null,
      updatedAt: j.updated_at ?? null,
      firstPublished: j.first_published ?? null,
      facts: extractFacts(j.title, html),
      formReadable: true,
    });
  }

  return { vendor: 'greenhouse', boardToken: board, ok: true, status: res.status, jobs, withoutContent };
}

// ─────────────────────────── ashby ───────────────────────────

interface AshbyJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  location?: string;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

/**
 * Ashby, one request per board.
 *
 * Same shape of win as Greenhouse: the board listing carries every posting's
 * full description (144 jobs, 2.6 MB on a real board), so browsing and matching
 * cost one request per tenant. What Ashby does NOT publish is the application
 * form — measured at 0/5 with the shared detector — so these postings are
 * marked `formReadable: false` and the app says the form has to be filled on
 * Ashby's own site.
 */
export async function indexAshbyBoard(board: string): Promise<BoardResult> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const res = await fetchJson<{ jobs?: AshbyJob[] }>(url);
  if (!res.ok || !res.data?.jobs) {
    return { vendor: 'ashby', boardToken: board, ok: false, status: res.status, jobs: [], withoutContent: 0 };
  }

  let withoutContent = 0;
  const jobs: IndexedJob[] = [];

  for (const j of res.data.jobs) {
    if (!j.id || !j.title || j.isListed === false) continue;
    const body = j.descriptionHtml ?? j.descriptionPlain ?? '';
    if (body.trim() === '') withoutContent++;

    const facts = extractFacts(j.title, body);
    // Ashby states the workplace outright, which beats inferring it from prose.
    const stated = j.isRemote === true ? 'remote' as const
      : j.workplaceType?.toLowerCase() === 'hybrid' ? 'hybrid' as const
        : j.workplaceType?.toLowerCase() === 'onsite' ? 'onsite' as const
          : null;

    jobs.push({
      id: `ashby:${board}:${j.id}`,
      vendor: 'ashby',
      boardToken: board,
      vendorJobId: j.id,
      company: board,
      title: j.title.trim(),
      absoluteUrl: j.jobUrl ?? j.applyUrl ?? '',
      location: j.location?.trim() || null,
      department: j.department?.trim() || j.team?.trim() || null,
      office: null,
      updatedAt: j.publishedAt ?? null,
      firstPublished: j.publishedAt ?? null,
      facts: { ...facts, workplace: stated ?? facts.workplace },
      formReadable: false,
    });
  }

  return { vendor: 'ashby', boardToken: board, ok: true, status: res.status, jobs, withoutContent };
}

// ─────────────────────────── lever ───────────────────────────

interface LeverJob {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
  description?: string;
}

/**
 * Lever, one request per site.
 *
 * Thin by necessity rather than by design: Lever blocks the crawlers by name,
 * so `npm run discover` finds zero Lever tenants and the only site list is the
 * hand-written one. Supported because the postings are rich when a site is
 * known, but expect few of them.
 */
export async function indexLeverSite(site: string): Promise<BoardResult> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`;
  const res = await fetchJson<LeverJob[]>(url);
  if (!res.ok || !Array.isArray(res.data)) {
    return { vendor: 'lever', boardToken: site, ok: false, status: res.status, jobs: [], withoutContent: 0 };
  }

  let withoutContent = 0;
  const jobs: IndexedJob[] = [];

  for (const j of res.data) {
    if (!j.id || !j.text) continue;
    const body = j.description ?? j.descriptionPlain ?? '';
    if (body.trim() === '') withoutContent++;

    jobs.push({
      id: `lever:${site}:${j.id}`,
      vendor: 'lever',
      boardToken: site,
      vendorJobId: j.id,
      company: site,
      title: j.text.trim(),
      absoluteUrl: j.hostedUrl ?? j.applyUrl ?? '',
      location: j.categories?.location?.trim() || null,
      department: j.categories?.team?.trim() || null,
      office: null,
      updatedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      firstPublished: j.createdAt ? new Date(j.createdAt).toISOString() : null,
      facts: extractFacts(j.text, body),
      formReadable: false,
    });
  }

  return { vendor: 'lever', boardToken: site, ok: true, status: res.status, jobs, withoutContent };
}

export interface JobIndex {
  builtAt: string;
  /** Boards attempted, so a thin index is visibly thin rather than mysteriously so. */
  boardsAttempted: number;
  boardsLive: number;
  jobs: IndexedJob[];
  /**
   * The API field the whole design depends on. Recorded so that if Greenhouse
   * ever stops returning descriptions, the cause is one line in the artifact
   * rather than a week of wondering why match scores went flat.
   */
  dependsOn: string;
  postingsWithoutDescription: number;
  /** Per-vendor breakdown, so a thin index is visibly thin and attributable. */
  vendors?: Array<{ vendor: string; source: string; attempted: number; live: number; jobs: number; withoutDescription: number }>;
}

/** How stale is a posting? Callers surface this; the index just carries dates. */
export function daysOld(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}
