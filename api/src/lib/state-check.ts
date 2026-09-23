import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { STATE_DIR } from './paths.js';

/**
 * Prove at boot that we can write where we say we will.
 *
 * This exists because of a real failure, in production, found in a log rather
 * than by anyone watching: `LANDFALL_STATE_DIR` pointed at `/var/data`, which
 * on Render is the mount point for a disk that had not been attached. Nothing
 * complained. The service reported healthy, served every page, authenticated
 * fine — and then the first person to upload a résumé got
 *
 *     EACCES: permission denied, mkdir '/var/data'
 *
 * because every write in this codebase creates its directory lazily, at the
 * moment of writing. The configuration was wrong from the first second and the
 * product only said so at the worst possible moment: a candidate handing over
 * their CV.
 *
 * A deployment that cannot store a résumé is broken whether or not anyone has
 * tried yet, so it now says so on the first line of the log, with the path it
 * tried and the reason. The check writes and deletes a real file, because
 * "does the directory exist" is the question that was already being answered
 * correctly while the actual write failed.
 *
 * It does not exit the process. A running service that can still show someone
 * their applications is better than one that refuses to start, and on a free
 * tier the fix is an environment variable away.
 */
export async function checkStateDirWritable(
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): Promise<boolean> {
  const probe = join(STATE_DIR, '.write-probe');
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    log.info({ stateDir: STATE_DIR }, 'state directory is writable');
    return true;
  } catch (err) {
    log.error(
      {
        stateDir: STATE_DIR,
        reason: (err as Error).message,
        hint: 'Résumé uploads and send archives will fail. If LANDFALL_STATE_DIR '
          + 'names a mount point, either attach the disk or unset it so storage '
          + 'falls back inside the deploy.',
      },
      'STATE DIRECTORY IS NOT WRITABLE — uploads will fail',
    );
    return false;
  }
}
