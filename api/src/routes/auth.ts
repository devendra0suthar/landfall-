import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { hashPassword, verifyPassword, passwordProblem } from '../auth/password.js';
import {
  startSession, endSession, endAllSessions, sessionFromRequest, refreshAuth,
  createExtensionToken, listExtensionTokens, revokeExtensionToken,
} from '../auth/session.js';
import { requireCandidate, requireFreshAuth } from '../auth/session.js';
import {
  googleConfig, newState, authorizeUrl, redirectUri, stateMatches, exchangeCode, STATE_COOKIE,
} from '../auth/google.js';

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
  /**
   * Connect the autofill extension (FR-15).
   *
   * Returns the token **once**. Only its hash is stored, so this screen is the
   * one and only place it is ever readable — a token a page can re-display is
   * a token held in plain text somewhere.
   *
   * Behind requireFreshAuth: handing out a long-lived credential is exactly the
   * kind of act FR-27 asks for a password before.
   */
  app.post('/api/auth/extension', async (req, reply) => {
    const candidateId = await requireFreshAuth(req, reply);
    if (!candidateId) return reply;

    const parsed = z.object({ label: z.string().trim().max(80).optional() })
      .strict().safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'bad body' });

    const existing = await listExtensionTokens(candidateId);
    // Not a security limit — a hygiene one. Someone who has connected ten
    // browsers has lost track, and the list is how they revoke.
    if (existing.length >= 10) {
      return reply.code(409).send({
        error: 'ten extensions are already connected — revoke one before adding another',
      });
    }

    const { token, id } = await createExtensionToken(candidateId, parsed.data.label ?? null);
    return reply.send({
      id,
      token,
      note: 'Copy this now. It is not shown again, and it is stored only as a hash.',
    });
  });

  app.get('/api/auth/extension', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;
    return reply.send({ tokens: await listExtensionTokens(candidateId) });
  });

  app.delete('/api/auth/extension/:id', async (req, reply) => {
    const candidateId = await requireCandidate(req, reply);
    if (!candidateId) return reply;
    const { id } = req.params as { id: string };
    const gone = await revokeExtensionToken(candidateId, id);
    if (!gone) return reply.code(404).send({ error: 'no such connected extension' });
    return reply.send({ ok: true });
  });
}

/**
 * Google sign-in (FR-24).
 *
 * Separate from `registerAuthRoutes` so it can be registered outside the strict
 * 10/min auth rate limit: the callback is one hop in a redirect chain the
 * candidate did not choose the timing of, and rate-limiting it would fail real
 * sign-ins while doing nothing an attacker cares about — there is no password
 * here to guess.
 */
export async function registerGoogleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/google/available', async () => ({ available: googleConfig() !== null }));

  app.get('/api/auth/google', async (req, reply) => {
    const cfg = googleConfig();
    if (!cfg) return reply.code(503).send({ error: 'Google sign-in is not configured on this server' });

    const state = newState();
    reply.setCookie(STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      // Lax, not Strict: the callback arrives as a top-level navigation from
      // accounts.google.com, and Strict would withhold the cookie exactly then
      // — the sign-in would fail every time with a state mismatch.
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
    });
    return reply.redirect(authorizeUrl(cfg, redirectUri(req as never), state));
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const cfg = googleConfig();
    if (!cfg) return reply.code(503).send({ error: 'Google sign-in is not configured on this server' });

    const q = req.query as { code?: string; state?: string; error?: string };
    // The candidate pressing "cancel" on Google's screen is not an error worth
    // a stack trace — it is them changing their mind. Send them back.
    if (q.error) return reply.redirect('/#/?signin=cancelled');

    const expected = req.cookies?.[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/' });
    if (!q.code || !stateMatches(q.state, expected)) {
      return reply.redirect('/#/?signin=failed');
    }

    const who = await exchangeCode(cfg, q.code, redirectUri(req as never));
    if (!who) return reply.redirect('/#/?signin=failed');

    // Matched on `sub` first, because that is the identity. Email is only the
    // fallback for an account that already existed before Google was linked,
    // and it is safe here *only* because exchangeCode refuses an unverified
    // address.
    let candidate = await prisma.candidate.findUnique({
      where: { googleId: who.sub },
      select: { id: true },
    });

    if (!candidate) {
      const byEmail = await prisma.candidate.findUnique({
        where: { email: who.email },
        select: { id: true, googleId: true },
      });
      if (byEmail) {
        // An existing account, proven to own this verified address. Link it,
        // unless it is already linked to a different Google account — in which
        // case something is wrong and the safe answer is to do nothing.
        if (byEmail.googleId && byEmail.googleId !== who.sub) {
          return reply.redirect('/#/?signin=failed');
        }
        candidate = await prisma.candidate.update({
          where: { id: byEmail.id },
          data: { googleId: who.sub },
          select: { id: true },
        });
      } else {
        candidate = await prisma.candidate.create({
          data: { email: who.email, googleId: who.sub },
          select: { id: true },
        });
      }
    }

    await startSession(reply, candidate.id, req.headers['user-agent'] ?? null);
    // Back to the app, signed in. The hash route is the app's own entry point.
    return reply.redirect('/#/jobs');
  });
}
