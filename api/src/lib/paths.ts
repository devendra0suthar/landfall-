import { fileURLToPath } from 'node:url';

/**
 * Paths, resolved correctly on every platform.
 *
 * `new URL(...).pathname` looks right and works on POSIX, but on Windows it
 * yields "/C:/Users/..." — a leading slash before the drive letter — which
 * concatenates into "C:\C:\Users\..." and fails with ENOENT. fileURLToPath is
 * the only correct conversion. Carried over from the Phase 0 research repo,
 * where this cost an afternoon.
 */

/** Anything the API writes: cached vendor responses, résumé files, archives. */
const stateOverride = (process.env.LANDFALL_STATE_DIR ?? '').trim();

export const STATE_DIR = stateOverride
  ? (/[\/]$/.test(stateOverride) ? stateOverride : `${stateOverride}/`)
  : fileURLToPath(new URL('../../storage/', import.meta.url));

/** Vendor responses, cached so we do not re-probe what has not changed (NFR-2). */
export const CACHE_DIR = `${STATE_DIR}cache/`;

/** Résumé files a candidate uploaded, and the archives of what was sent. */
export const RESUME_DIR = `${STATE_DIR}resumes/`;
export const ARCHIVE_DIR = `${STATE_DIR}archive/`;
