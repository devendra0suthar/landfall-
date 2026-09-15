/**
 * Working out which posting a page is.
 *
 * The extension runs on an employer's own application form and needs to know
 * which indexed job that is. Asking the candidate to paste an id is a seam:
 * they would have to find it in one window and type it into another, and the
 * id is not a thing they have any reason to know.
 *
 * The URL already says. Greenhouse serves the same posting from two hosts and
 * in three shapes, which is why this is a parser with cases rather than one
 * regex:
 *
 *   https://job-boards.greenhouse.io/addepar1/jobs/8451871002
 *   https://boards.greenhouse.io/figma/jobs/5711913004?gh_jid=5711913004
 *   https://boards.greenhouse.io/embed/job_app?for=figma&token=5711913004
 *
 * Pure, so it is testable without a browser or a database.
 */

export interface PostingRef {
  vendor: 'greenhouse';
  boardToken: string;
  vendorJobId: string;
}

const HOSTS = new Set(['boards.greenhouse.io', 'job-boards.greenhouse.io']);

export function parsePostingUrl(raw: string): PostingRef | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (!HOSTS.has(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);

  // The embedded application form carries both parts in the query string
  // instead of the path.
  if (segments[0] === 'embed') {
    const board = url.searchParams.get('for');
    const token = url.searchParams.get('token') ?? url.searchParams.get('gh_jid');
    return board && token ? { vendor: 'greenhouse', boardToken: board, vendorJobId: token } : null;
  }

  // /<board>/jobs/<id> — with an optional trailing segment like /application,
  // which is the page the extension actually runs on.
  const jobsAt = segments.indexOf('jobs');
  if (jobsAt === 1 && segments[0] && segments[2]) {
    const id = /^\d+$/.test(segments[2]) ? segments[2] : url.searchParams.get('gh_jid');
    return id ? { vendor: 'greenhouse', boardToken: segments[0], vendorJobId: id } : null;
  }

  // Some boards link the posting with the id only in the query.
  const jid = url.searchParams.get('gh_jid');
  if (segments[0] && jid) {
    return { vendor: 'greenhouse', boardToken: segments[0], vendorJobId: jid };
  }

  return null;
}
