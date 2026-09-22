# Deploying Landfall

**Status: not yet deployed.** This document is the honest version of what that
takes, including the two things that must be fixed before this can face the
public internet at all.

---

## 1. Two blockers, before anything else

### 1.1 There is no authentication

`currentCandidateId()` — in `api/src/routes/*.ts` — returns **the first
candidate row in the database**. There is no login, no session, no ownership
check on any endpoint. FR-24 (sign-up), FR-27 (session expiry) are unbuilt.

On a laptop that is fine: one person, one profile. On a public URL it means
anyone who finds the address can:

- read the profile — full name, email, phone, home city, work history
- **download the résumé** (`GET /api/resume` serves the file)
- edit or delete the profile, and delete the account
- see every application and its archived documents

That is a complete professional identity, which §8 of the requirements calls a
credential-grade dataset. **Do not deploy this publicly with real data in it
until accounts exist.** It is not a hardening task that can follow launch; it is
the reason the launch cannot happen.

Interim options, in order of how much work they are:

| Option | Work | Good enough for |
|---|---|---|
| Keep it local (`pnpm dev`) | none | one person, today |
| Deploy with **no real data** — empty database, demo profile only | none | showing the product |
| Put the whole thing behind HTTP basic auth at the host | ~an hour | a private demo for a few people |
| Build real accounts (FR-24, FR-26, FR-27) | days | actual users |

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

The shape on any of them:

1. Build: `pnpm install && pnpm --filter ./api exec prisma generate && pnpm --filter ./web build`
2. Serve `web/dist` as static files from the same Fastify process that serves
   `/api` — a few lines with `@fastify/static`, and it keeps the single origin.
3. Migrate: `pnpm db:push` against the managed Postgres.
4. Environment: `DATABASE_URL`, `PORT`, `LANDFALL_CONTACT`.
5. Seed the index: `pnpm ingest -- <board tokens>` then `pnpm forms -- --limit=2000`.

`api/src/server.ts` currently binds `127.0.0.1`. A container needs `0.0.0.0`, or
nothing outside it can connect — one line, but the kind that costs an evening.

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

1. `gh auth login`, create the private repo, push. CI starts running.
2. Decide what "deployed" is for: a private demo, or something with real users.
3. If real users: build accounts first (§1.1). Nothing else is safe.
4. Single-origin host (§2), managed Postgres, ingest the index.
5. Only then consider a public URL.
