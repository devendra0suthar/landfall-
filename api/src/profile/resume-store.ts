import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { RESUME_DIR } from '../lib/paths.js';

/**
 * Where a candidate's résumé file lives.
 *
 * Local disk in v0, region-local object storage later — which is why callers
 * get a `storageKey` and never a path they can join onto. The key is opaque on
 * purpose: when this moves to S3 in ap-south-1, only this file changes.
 *
 * Nothing here is served over a public URL. A résumé is a complete
 * professional identity — name, address, phone, employer history — and the one
 * thing a candidate did not ask for is for it to be fetchable by anyone who
 * guesses a link (docs/REQUIREMENTS.md NFR-8).
 */

/** 8 MB. Generous for a résumé, small enough that a stray upload cannot hurt. */
export const MAX_BYTES = 8_000_000;

const ALLOWED = new Set(['.pdf', '.doc', '.docx', '.rtf', '.txt', '.md']);

export interface StoredResume {
  storageKey: string;
  sha256: string;
  bytes: number;
  extension: string;
}

export class ResumeRejected extends Error {}

/**
 * Validate and store one uploaded file.
 *
 * The filename is used for exactly one thing — its extension. No directory
 * component of it is trusted, and it never becomes part of the stored path:
 * employers see `resumeFilename()`, built from the candidate's own name.
 */
export async function storeResume(bytes: Buffer, originalName: string): Promise<StoredResume> {
  if (bytes.length === 0) throw new ResumeRejected('that file is empty');
  if (bytes.length > MAX_BYTES) {
    throw new ResumeRejected(`that file is ${Math.round(bytes.length / 1e6)} MB — the limit is 8 MB`);
  }

  const ext = extname(originalName).toLowerCase();
  if (!ALLOWED.has(ext)) {
    throw new ResumeRejected('a résumé should be a PDF, Word, RTF, text or markdown file');
  }

  // A file named .pdf that is not one would be attached to every application
  // and open on nobody's screen. Cheap to check, and the failure it prevents is
  // silent and total.
  if (ext === '.pdf' && bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new ResumeRejected('that file is named .pdf but does not start like a PDF — '
      + 'check you picked the right file');
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // Content-addressed: the same file uploaded twice occupies one copy, and a
  // key can never collide with another candidate's upload.
  const storageKey = `resumes/${sha256}${ext}`;
  await mkdir(RESUME_DIR, { recursive: true });
  await writeFile(join(RESUME_DIR, `${sha256}${ext}`), bytes);

  return { storageKey, sha256, bytes: bytes.length, extension: ext };
}

/** The bytes behind a key, or null when they are gone. */
export async function readStored(storageKey: string): Promise<Buffer | null> {
  const full = pathFor(storageKey);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

/**
 * Delete stored bytes.
 *
 * Only ever called for a key this module wrote. A path that escapes the résumé
 * directory is refused rather than resolved — the key round-trips through a
 * database a person can edit.
 */
export async function deleteStored(storageKey: string): Promise<void> {
  const full = pathFor(storageKey);
  if (full) await rm(full, { force: true });
}

/**
 * Resolve a key to a path inside the résumé directory, or null.
 *
 * Also accepts an absolute path for the executor, which needs a real file to
 * attach; everything else is confined.
 */
export function pathFor(storageKey: string): string | null {
  const root = resolve(RESUME_DIR);
  const candidate = isAbsolute(storageKey)
    ? resolve(storageKey)
    : resolve(join(RESUME_DIR, storageKey.replace(/^resumes\//, '')));
  return candidate === root || candidate.startsWith(root) ? candidate : null;
}
