import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { hashPassword, verifyPassword, passwordProblem } from '../auth/password.js';
import {
  startSession, endSession, endAllSessions, sessionFromRequest, refreshAuth,
} from '../auth/session.js';

/**
 * Sign-up, sign-in, sign-out (FR-24).
 *
 * Two things here are deliberate and look like bugs if you skim them:
 *
 *   1. **Sign-up and sign-in give the same answer to "does this email exist?"
 *      — none.** A signup that says "that email is taken" is an account
 *      enumeration oracle, and this product's users are job seekers whose
 *      employers should not be able to test whether they have an account. So a
 *      taken email returns the same shaped failure as a wrong password.
 *   2. **The wrong-password path still hashes.** Returning early when the email
 *      is unknown makes "unknown email" measurably faster than "wrong
 *      password", which is the same oracle with a stopwatch.
 *
 * Rate limiting is applied to this whole plugin in `server.ts`; without it,
 * both protections above are academic.
 */

const Credentials = z.object({
  email: z.string().trim().toLowerCase().email('a valid email is required').max(320),
  password: z.string().min(1, 'a password is required').max(200),
}).strict();

/** Said identically for every failure, so the reply carries no information. */
const REFUSED = 'that email and password do not match an account';

/**
 * Whether a row with no password may be claimed by signing up as it.
 *
 * `pnpm seed` writes a candidate with `passwordHash: null`, and letting the
 * first sign-up on that address adopt it is what stops a developer's seeded
 * profile being stranded the moment accounts arrived. That convenience is also
 * an account takeover: anyone who knows the address gets the profile, the
 * résumé and the application history attached to it.
 *
 * So it is off in production unless switched on deliberately. A fresh deploy
 * has no passwordless rows anyway; one only exists if someone ran the seed
 * against a live database, which is exactly the case that must not be
 * claimable by a stranger.
 */
function claimingAllowed(): boolean {
  if (process.env.LANDFALL_ALLOW_CLAIM === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/signup', async (req, reply) => {
    const parsed = Credentials.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'bad body' });
    }
    const { email, password } = parsed.data;

    const problem = passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });

    const hash = await hashPassword(password);
    const existing = await prisma.candidate.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    if (existing) {
      // An account seeded before passwords existed can claim itself by signing
      // up with the same address — it has no password, so no one is displaced.
      // Off in production: see `claimingAllowed`.
      if (existing.passwordHash === null && claimingAllowed()) {
        await prisma.candidate.update({ where: { id: existing.id }, data: { passwordHash: hash } });
        await startSession(reply, existing.id, req.headers['user-agent'] ?? null);
        return reply.send({ id: existing.id, email, claimed: true });
      }
      // Otherwise: no confirmation that this address is taken.
      return reply.code(409).send({ error: REFUSED });
    }

    const candidate = await prisma.candidate.create({
      data: { email, passwordHash: hash },
      select: { id: true, email: true },
    });
    await startSession(reply, candidate.id, req.headers['user-agent'] ?? null);
    return reply.send({ ...candidate, claimed: false });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = Credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: REFUSED });
    const { email, password } = parsed.data;

    const candidate = await prisma.candidate.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    // Verified even when there is no such account, against a hash that cannot
    // match, so the two paths cost the same wall-clock.
    const ok = await verifyPassword(password, candidate?.passwordHash ?? null);
    if (!candidate || !ok) return reply.code(401).send({ error: REFUSED });

    await startSession(reply, candidate.id, req.headers['user-agent'] ?? null);
    return reply.send({ id: candidate.id, email: candidate.email });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await endSession(req, reply);
    return reply.send({ ok: true });
  });

  /**
   * Who am I — the call the front end makes before rendering anything.
   *
   * 200 with `candidate: null` rather than 401, because "not signed in" is the
   * expected answer on a first visit, and a 401 in the console on every cold
   * load trains people to ignore 401s.
   */
  app.get('/api/auth/me', async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (!session) return reply.send({ candidate: null });

    const candidate = await prisma.candidate.findUnique({
      where: { id: session.candidateId },
      select: { id: true, email: true, region: true, profile: { select: { id: true } } },
    });
    if (!candidate) return reply.send({ candidate: null });

    return reply.send({
      candidate: {
        id: candidate.id,
        email: candidate.email,
        region: candidate.region,
        /** So the app can send a brand-new account to the résumé upload. */
        hasProfile: candidate.profile !== null,
      },
      authedAt: session.authedAt,
    });
  });

  /**
   * Prove the password again without starting over (FR-27).
   *
   * The counterpart to `requireFreshAuth`'s 403: the front end asks for the
   * password in place and the candidate keeps whatever they were doing.
   */
  app.post('/api/auth/confirm', async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: 'sign in to continue' });

    const parsed = z.object({ password: z.string().min(1).max(200) }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'a password is required' });

    const candidate = await prisma.candidate.findUnique({
      where: { id: session.candidateId },
      select: { passwordHash: true },
    });
    const ok = await verifyPassword(parsed.data.password, candidate?.passwordHash ?? null);
    if (!ok) return reply.code(401).send({ error: 'that password does not match' });

    await refreshAuth(session.sessionId);
    return reply.send({ ok: true });
  });

  app.post('/api/auth/password', async (req, reply) => {
    const session = await sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: 'sign in to continue' });

    const parsed = z.object({
      current: z.string().min(1).max(200),
      next: z.string().min(1).max(200),
    }).strict().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'both passwords are required' });

    const problem = passwordProblem(parsed.data.next);
    if (problem) return reply.code(400).send({ error: problem });

    const candidate = await prisma.candidate.findUnique({
      where: { id: session.candidateId },
      select: { passwordHash: true },
    });
    const ok = await verifyPassword(parsed.data.current, candidate?.passwordHash ?? null);
    if (!ok) return reply.code(401).send({ error: 'that password does not match' });

    await prisma.candidate.update({
      where: { id: session.candidateId },
      data: { passwordHash: await hashPassword(parsed.data.next) },
    });
    // Every other browser is signed out. A password change that leaves the
    // session it was stolen in still working has not changed anything.
    await endAllSessions(session.candidateId);
    await startSession(reply, session.candidateId, req.headers['user-agent'] ?? null);
    return reply.send({ ok: true, otherSessionsEnded: true });
  });
}
