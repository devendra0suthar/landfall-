import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/db.js';

/**
 * Sessions, and the single answer to "who is asking?" (FR-24, FR-27).
 *
 * Before this existed, every route called its own copy of a
 * `currentCandidateId()` that returned `findFirst()` — the first row in the
 * database. Fifteen call sites across fourteen files, each one a place the
 * check could later drift. They are all gone: `requireCandidate` is the only
 * way a route learns who the candidate is, so adding an endpoint that forgets
 * to authenticate now takes deliberate effort rather than a copy-paste.
 *
 * Three decisions worth stating:
 *
 *   1. **Opaque random tokens, not JWTs.** The session must be revocable — FR-26
 *      deletes an account from inside the product, and a signed token that
 *      stays valid until it expires makes that a lie. A row that can be deleted
 *      is the whole feature.
 *   2. **Only the hash of the token is stored.** A dump of `Session` is then a
 *      list of expiry dates, not a set of working credentials.
 *   3. **`authedAt` is separate from `createdAt`.** FR-27 re-authenticates
 *      before data leaves or changes, and measuring that from session creation
 *      would let a session kept warm by browsing quietly become permanent.
 */

export const COOKIE = 'landfall_session';

/** How long a session lives without being used again. */
const SESSION_DAYS = 30;

/**
 * How long a password proof counts for, at the points FR-27 guards.
 *
 * Twelve hours: long enough that a working session is not an interrogation,
 * short enough that a browser left open in a shared room does not export
 * someone's entire professional identity a week later.
 */
const REAUTH_HOURS = 12;

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export interface SessionInfo {
  candidateId: string;
  sessionId: string;
  authedAt: Date;
}

/** Mint a session and set the cookie. Returns the token for tests. */
export async function startSession(
  reply: FastifyReply,
  candidateId: string,
  userAgent: string | null,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      candidateId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });

  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    // Lax rather than Strict: Strict drops the cookie when a candidate
    // arrives from a link in their own email, which reads as being logged out.
    // Lax still blocks the cross-site POST that CSRF needs.
    sameSite: 'lax',
    // Off over plain HTTP or the cookie is never sent back and login appears
    // to silently fail on a laptop.
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
  });

  return token;
}

/** Who is asking, or null. Never throws — an absent session is normal. */
export async function sessionFromRequest(req: FastifyRequest): Promise<SessionInfo | null> {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;

  const row = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, candidateId: true, expiresAt: true, authedAt: true },
  });
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    // Expired sessions are removed on sight rather than left to a sweep, so the
    // table cannot grow without bound on a deployment with no cron.
    await prisma.session.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }

  return { candidateId: row.candidateId, sessionId: row.id, authedAt: row.authedAt };
}

/**
 * The guard every route uses.
 *
 * Returns the candidate id, or sends a 401 and returns null. Callers do:
 *
 *     const candidateId = await requireCandidate(req, reply);
 *     if (!candidateId) return reply;
 */
export async function requireCandidate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const session = await sessionFromRequest(req);
  if (!session) {
    reply.code(401).send({ error: 'sign in to continue' });
    return null;
  }
  return session.candidateId;
}

/**
 * The same guard, plus FR-27: a recent password proof.
 *
 * Used where data leaves or changes — export, erasure, profile edits. Answers
 * 403 with a distinct code so the front end can ask for the password again
 * rather than dumping someone back at a login screen having lost their work.
 */
export async function requireFreshAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const session = await sessionFromRequest(req);
  if (!session) {
    reply.code(401).send({ error: 'sign in to continue' });
    return null;
  }
  const age = Date.now() - session.authedAt.getTime();
  if (age > REAUTH_HOURS * 60 * 60 * 1000) {
    reply.code(403).send({
      error: 'confirm your password to continue',
      reauth: true,
    });
    return null;
  }
  return session.candidateId;
}

/** Mark the password as proved again, without minting a new session. */
export async function refreshAuth(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { authedAt: new Date() } });
}

export async function endSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await sessionFromRequest(req);
  if (session) {
    await prisma.session.delete({ where: { id: session.sessionId } }).catch(() => undefined);
  }
  reply.clearCookie(COOKIE, { path: '/' });
}

/** Drop every session for a candidate — used on password change and erasure. */
export async function endAllSessions(candidateId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { candidateId } });
  return count;
}
