# Deploying Landfall

**Status: ready to deploy, not yet deployed.** Both blockers this document was
written around are fixed — accounts exist (FR-24, FR-27), and the front end is
served from the API process on one origin. What is left is §4, which starts with
a GitHub login only you can do.

---

## 1. Two blockers, before anything else

### 1.1 ~~There is no authentication~~ — fixed, 2026-09-23

Accounts are built. `requireCandidate()` in `api/src/auth/session.ts` is now the
only way a route learns who is asking, replacing the fifteen copies of
`currentCandidateId()` that each returned the first row in the database.

- **Sign-up and sign-in** (FR-24) — email and password, scrypt-hashed with the
  cost parameters stored alongside each hash, so they can be raised later
  without locking every existing account out.
- **Sessions** are opaque random tokens in an `httpOnly`, `SameSite=Lax` cookie.
  Only the SHA-256 is stored, so a dump of the `Session` table is a list of
  expiry dates rather than a set of working credentials. They are revocable,
  which is what makes FR-26's "delete my account" true rather than decorative.
- **Re-authentication** (FR-27) — a password proof older than 12 hours is
  refused at the three points where data leaves or changes: `GET /api/export`,
  `DELETE /api/account`, `PUT /api/profile`. The front end asks for the password
  in place rather than dumping someone back at a login screen.
- **Browsing still needs no account**, exactly as FR-24 says. The job index is
  public and reports `match: null` when nobody is signed in.
- **Account enumeration is refused.** Sign-up and sign-in give the same answer
  whether or not an email exists, the wrong-password path still runs the KDF so
  both cost the same wall-clock, and `/api/auth/*` is rate limited to 10
  requests a minute — without which the first two are decoration.

The seeded demo candidate has no password. The first sign-up using that address
claims the existing row rather than creating a second account, so the seeded
profile is not stranded.

**What is still not built:** password reset by email (there is no mail sender in
the product yet), OAuth providers, and any second factor. A forgotten password
today needs database access. Say that out loud before inviting anyone who is not
you.

### 1.2 GitHub Pages cannot host this

Pages serves static files. It has no server process and no database. Landfall is
three moving parts:

```
web/    static  → Pages can host this
api/    Node + Fastify, long-running  → Pages cannot
        Postgres                      → Pages cannot
```

Deploying only `web/` to Pages produces a site where every screen renders
"Could not load this", because there is no API behind it. That is worse than not
deploying.

There is a second, quieter problem. `web/src/api.ts` uses **relative paths on
purpose** — §9 of the requirements commits to it, so that which region a
candidate reaches is decided by where they loaded the page, never by an origin
baked into the bundle. Splitting the front end onto Pages and the API onto
another host breaks that: it needs a hardcoded API origin and CORS, which
contradicts the architecture rather than merely complicating it.

---

## 2. What to do instead

**Host the web app and the API together, on one origin.** Relative paths keep
working, §9's model is preserved, and there is no CORS. GitHub stays the source
of truth and runs CI.

Any of these work and have a free tier:

| Host | Notes |
|---|---|
| **Render** | Web service (Node) + managed Postgres. Deploys from the GitHub repo on push. Closest to the shape this app already has |
| **Railway** | Same shape, similar effort |
| **Fly.io** | More control, regional deploys — which is the one host that matches NFR-4's per-region data residency if that becomes real |

**`render.yaml` in the repo root is a Blueprint** declaring the web service and
its Postgres together, so none of the below is assembled by hand any more. What
it implements:

1. Build: `pnpm run build` — install, `prisma generate`, build the front end.
2. Serve `web/dist` from the same Fastify process that serves `/api`. **Done** —
   `server.ts` registers `@fastify/static` when a build is present, and falls
   back to `index.html` for deep links while still 404ing unknown `/api/` paths
   as JSON.
3. Migrate: `pnpm run start` runs `prisma migrate deploy` before listening.
   **Done** — `prisma/migrations/0_init` is a real migration now. `db:push`
   stays a development convenience; against a live database it silently drops
   columns.
4. Environment: `DATABASE_URL`, `PORT`, `HOST=0.0.0.0`, `TRUST_PROXY=true`,
   `LANDFALL_CONTACT`, and optionally `ANTHROPIC_API_KEY`.
5. Seed the index: `pnpm ingest -- <board tokens>` then `pnpm forms -- --limit=2000`.

`api/src/server.ts` binds `127.0.0.1` by default and reads `HOST`; the blueprint
sets `0.0.0.0`. The safe value stays the default, so a laptop is never exposed by
accident.

**One caveat configuration does not fix.** Uploaded résumés are written to the
filesystem, and Render's is ephemeral: every deploy wipes them while the database
keeps the rows naming them, so the export path would report a file whose bytes
are gone — precisely the "quiet lie" it was written to avoid. The `disk:` block
in `render.yaml` fixes it and needs a paid instance. On the free tier, treat
uploads as disposable.

Two more free-tier facts worth knowing before you send anyone a link: the web
service sleeps after 15 minutes idle and takes about 30 seconds to wake, and
free Postgres expires after 30 days.

---

## 3. What GitHub is already good for here

Committed and working today:

- **`.github/workflows/ci.yml`** — typecheck, the 58-test suite and the
  extension build on every push. The suite needs no database and no network, so
  it can gate every commit rather than run nightly.

To put the repo on GitHub:

```bash
gh auth login                  # interactive — you have to run this yourself
gh repo create landfall --private --source=. --remote=origin --push
```

**Private is the right default.** The repo carries no secrets — `.env` and
`storage/` are gitignored, and that is verified — but it does carry the product
thinking in `docs/`, and a public repo is a decision to make deliberately rather
than by flag.

---

## 4. Order of work

Steps 1 and 2 are yours — both need a browser login nobody else can do.

1. **`gh auth login`** — interactive, so run it yourself. Then:
   ```bash
   gh repo create landfall --private --source=. --remote=origin --push
   ```
   CI starts running on that first push.
2. **Render → Blueprints → New Blueprint Instance**, point it at the repo. It
   reads `render.yaml` and creates both the web service and the database. Set
   `LANDFALL_CONTACT` when prompted; set `ANTHROPIC_API_KEY` only if you want
   rewording suggestions (FR-48 — everything else works without it).
3. **First deploy runs the migration itself.** The database starts empty, which
   also means the job index is empty.
4. **Fill the index**, from the Render shell or locally against `DATABASE_URL`:
   ```bash
   pnpm ingest -- stripe gitlab databricks cloudflare
   pnpm forms -- --limit=2000
   ```
5. **Sign up on the live site.** The first account is yours; nothing is stored
   until one exists.

Before inviting anyone else: there is no password reset (§1.1), and on the free
tier uploaded résumés do not survive a deploy (§2).
