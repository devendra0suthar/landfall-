import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { ARCHIVE_DIR } from '../lib/paths.js';
import { prisma } from '../lib/db.js';
import { loadIndexed, loadProfile } from '../profile/load.js';
import { tailor } from '../resume/tailor.js';
import { renderResume, resumeFilename } from '../resume/document.js';
import { readStored } from '../profile/resume-store.js';

/**
 * Freezing what was sent.
 *
 * The résumé this platform attaches is rendered per posting from a profile
 * that keeps changing — edit one bullet and every future document changes with
 * it. Without a snapshot, "which CV did they see?" becomes unanswerable three
 * weeks later, at exactly the moment an interview makes it matter.
 *
 * So the bytes are archived, hashed, and never rewritten. A record is written
 * once, when an application first becomes APPLIED, and re-marking does not
 * replace it: the first send is the one the employer read (FR-20, FR-21).
 *
 * It is not a compliance record. It exists for the candidate, and it goes when
 * they go — erasure wins over immutability (docs/REQUIREMENTS.md §8).
 */

/** Two years from the send, then automatic deletion unless shortened. */
const RETENTION_MONTHS = 24;

export interface CapturedSend {
  filename: string;
  sha256: string;
  bytes: number;
  bullets: string[];
  variant: string | null;
  tailored: boolean;
  storageKey: string;
  expiresAt: Date;
}

/**
 * Build the record for one send.
 *
 * Falls back to the candidate's own file when there is nothing to tailor from,
 * and says so in `tailored` — the point is an honest record of what left, not
 * a record that everything was tailored.
 *
 * Returns null when there is nothing to archive at all. That is not a failure
 * of the application: a candidate who applied through a form that wanted no
 * attachment still applied, and blocking the status change because we have no
 * document to freeze would be the tail wagging the dog.
 */
export async function captureSend(
  candidateId: string,
  jobId: string,
): Promise<CapturedSend | null> {
  const [profile, job, active, variant] = await Promise.all([
    loadProfile(candidateId),
    loadIndexed(jobId),
    prisma.resumeFile.findFirst({
      where: { candidateId, active: true },
      orderBy: { uploadedAt: 'desc' },
    }),
    prisma.variant.findFirst({ where: { candidateId, active: true }, select: { name: true } }),
  ]);
  if (!profile || !job) return null;

  const hasBullets = (profile.experience ?? []).some((r) => (r.bullets ?? []).length > 0);

  if (hasBullets) {
    const t = tailor(profile, job);
    // Refuse to claim a tailored send whose lines are not provably the
    // candidate's own. Falling through to their uploaded file is honest; an
    // archived document with invented text would be worse than no archive.
    if (t.integrity.allVerbatim) {
      const pdf = renderResume(t, profile);
      const stored = await store(pdf, '.pdf');
      return {
        filename: resumeFilename(profile, job.company),
        sha256: stored.sha256,
        bytes: pdf.length,
        bullets: t.roles.flatMap((r) => r.kept.map((b) => b.text)),
        variant: variant?.name ?? null,
        tailored: true,
        storageKey: stored.storageKey,
        expiresAt: expiry(),
      };
    }
    console.warn(`tailoring integrity check failed for job ${jobId} — archiving the uploaded file`);
  }

  if (!active) return null;

  const bytes = await readStored(active.storageKey);
  if (!bytes) return null;

  const ext = extname(active.filename).toLowerCase() || '.pdf';
  const stored = await store(bytes, ext);
  return {
    // The candidate's own file keeps its own extension: archiving a .docx
    // under a .pdf name would make the record lie about the very thing it
    // exists to prove.
    filename: resumeFilename(profile, job.company).replace(/\.pdf$/, ext),
    sha256: stored.sha256,
    bytes: bytes.length,
    // No bullet record: the file they already had was attached as-is, so there
    // was nothing to select. An empty list here means exactly that.
    bullets: [],
    variant: variant?.name ?? null,
    tailored: false,
    storageKey: stored.storageKey,
    expiresAt: expiry(),
  };
}

/** The archived bytes for one application, or null when they are gone. */
export async function readArchive(storageKey: string): Promise<Buffer | null> {
  // The key round-trips through a database a person can edit, so a path that
  // escapes the archive directory is refused rather than resolved.
  const full = pathIn(storageKey);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

/**
 * Delete archived bytes that nothing references any more.
 *
 * Erasure is not "the row is gone" — the file is the thing a candidate asked
 * us to forget (docs/REQUIREMENTS.md §8). Archives are content-addressed, so
 * two applications that sent identical documents share one file: the bytes go
 * only once nothing points at them, or one candidate tidying up would delete
 * another's evidence.
 */
export async function forgetArchive(storageKey: string): Promise<boolean> {
  const stillReferenced = await prisma.sentRecord.count({ where: { storageKey } });
  if (stillReferenced > 0) return false;

  const full = pathIn(storageKey);
  if (!full) return false;

  await rm(full, { force: true });
  return true;
}

/** A storage key resolved inside the archive directory, or null if it escapes. */
function pathIn(storageKey: string): string | null {
  const root = resolve(ARCHIVE_DIR);
  const full = isAbsolute(storageKey)
    ? resolve(storageKey)
    : resolve(join(ARCHIVE_DIR, storageKey.replace(/^archive\//, '')));
  return full.startsWith(root) ? full : null;
}

async function store(bytes: Buffer, ext: string): Promise<{ storageKey: string; sha256: string }> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mkdir(ARCHIVE_DIR, { recursive: true });
  // Content-addressed, as uploads are: two applications that sent identical
  // bytes share one file, and neither can delete the other's evidence.
  await writeFile(join(ARCHIVE_DIR, `${sha256}${ext}`), bytes);
  return { storageKey: `archive/${sha256}${ext}`, sha256 };
}

function expiry(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + RETENTION_MONTHS);
  return d;
}
