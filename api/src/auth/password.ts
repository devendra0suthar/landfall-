import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// promisify picks the 3-argument overload, which drops the options object the
// cost parameters live in. Typed explicitly rather than cast at the call site.
const scrypt = promisify(scryptCb) as (
  password: string, salt: Buffer, keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing, on Node's own scrypt.
 *
 * No dependency, deliberately. scrypt is a memory-hard KDF built into the
 * runtime, it is what this threat model needs, and an auth library here would
 * bring a plugin surface and a release cadence to guard a single verb. The
 * repo already makes this trade in `resume/pdf.ts`; it is the same one.
 *
 * What is *not* hand-rolled: the comparison (`timingSafeEqual`), the salt
 * (`randomBytes`), and the parameters, which are stored **in** the hash rather
 * than assumed. That last part is the one that matters in a year: raising the
 * cost factor must not invalidate every existing password, so every hash
 * carries the parameters it was made with and is verified on its own terms.
 *
 *   scrypt$N$r$p$salt$key   — all base64url, all from the stored string
 */

const N = 32768; // CPU/memory cost. 2^15 — ~100ms on a small container.
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;


const b64 = (b: Buffer): string => b.toString('base64url');

// scrypt needs ~128·N·r bytes, and Node's default 32 MB ceiling sits below what
// N=32768 asks for — the failure is an exception at signup, not a weak hash, so
// maxmem is set from the parameters rather than left to the default.
async function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    N: n, r, p, maxmem: 128 * n * r * 2,
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(key)}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed or unknown-format hash rather than throwing:
 * a corrupt row must read as "wrong password", not as a 500 that tells an
 * attacker they found something interesting.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A hostile row could otherwise ask this process to allocate its way to death.
  if (n < 1024 || n > 1048576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64url');
    const expected = Buffer.from(parts[5] ?? '', 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = await derive(password, salt, n, r, p);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * The one rule about password shape, and the reason there is only one.
 *
 * Composition rules (a digit, a symbol, a capital) push people towards
 * "Password1!" and are worse than length. NIST dropped them in 2017. Length is
 * the check that survives; the upper bound exists so a megabyte of input
 * cannot be turned into a denial of service by way of the KDF.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'a password needs to be at least 10 characters';
  if (password.length > 200) return 'a password can be at most 200 characters';
  return null;
}
