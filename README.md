# Landfall

A worldwide job-application platform. Upload a résumé once; Landfall finds
matching roles anywhere, prepares each application from your own facts, and
hands you everything the form will ask for — with a source on every answer.

**Landfall prepares; you apply.** We do not submit applications, drive a browser
on your behalf, or touch a logged-in session. See `docs/PROJECT.md`.

- **Requirements:** `docs/REQUIREMENTS.md` (14 sections, 48 FRs, 11 NFRs)
- **Decision record:** `docs/PROJECT.md` — competitive research, and the
  documents-only posture that amends the spec
- **Deployment:** `docs/DEPLOY.md` — and `render.yaml`
- **Prototype:** `design/` — **historical only.** It predates both the posture
  change and the visual rebuild, so its screens, typefaces and palette all
  disagree with the product. The design system is `web/src/styles.css`.
- **Working rules:** `CLAUDE.md`

## Status — v0, in progress

| | |
|---|---|
| Greenhouse ingest → Postgres | working (2,400+ postings across 6 boards, descriptions and skills) |
| Form schemas captured | working — `pnpm ingest` reads the first 25 per board, `pnpm forms` backfills the rest |
| Form coverage | **92% of the index readable** (was 13% — ingest's `FORM_BATCH` cap was never backfilled) |
| `GET /api/jobs`, `/api/jobs/:id` | working, with country/remote/age filters, `offset`/`limit` paging and a true `total` |
| Profile + answer bank (`pnpm seed`) | working |
| Fill plan — a source recorded per field | working (`/api/jobs/:id/plan`) |
| Match scoring, with its signals | working (on `/api/jobs` and `/api/jobs/:id`) |
| Tailored résumé + PDF, integrity-checked | working (`/api/jobs/:id/resume[.pdf]`) |
| Cover-letter starters — facts plus prompts | working (`/api/jobs/:id/letter`) |
| Answer bank + gap report, ranked by reach | working (`/api/gaps`, `/api/bank/:key`) |
| Résumé upload, download, replace, delete | working (`/api/resume`) |
| Applications + tracker | working (`/api/applications`) |
| Handover archive — written once, hashed | working (`/api/applications/:id/sent`) |
| Follow-ups on applications gone quiet | working (`/api/followups`) |
| Web front end — five screens, real data | working (`pnpm dev`, :5174) |
| Profile — read and edit, strictly validated | working (`GET/PUT /api/profile`) |
| Résumé parsing — confidence per field, corrected before saving | working (`POST /api/resume/parse`) |
| Targeting variants — one set of facts, aimed differently | working (`/api/variants`) |
| Export everything, machine-readable | working (`GET /api/export`) |
| Erasure — rows, files and archives | working (`DELETE /api/account`) |
| Fill matcher — plan onto a rendered form, two renderings | working (`api/src/fill/match.ts`) — now the Kit's accuracy gate, not an executor's |
| Tier A extension — fills the employer's form, never submits | built, **restored under posture C+** (FR-15 un-retired): Landfall fills, the candidate submits. Still **unverified in a real browser** — load `extension/dist/` unpacked to confirm the in-page fill |
| Application Kit — the posture-C deliverable | working (`/api/jobs/:id/kit`, `#/kit/:id`) — FR-39…FR-43 |
| Kit on an unreadable form — ships anyway, states the gap | working (FR-43; `fields: null`, never 0) |
| Kit is the single apply view | the old `Prepare` screen folded into it; `#/prepare/:id` redirects |
| Résumé rewording — Claude proposes, you accept line by line | working (`POST /api/suggest`, `#/improve`) — FR-45…FR-48 |
| …and a verifier that refuses invented facts | working (`api/src/suggest/verify.ts`) — a proposal that adds a number, a tool, a name or a claim of credit is discarded before you see it |
| …optional to the deployment | with no `ANTHROPIC_API_KEY` the feature switches off and says so; nothing else calls a model |
| Accounts — sign-up, sign-in, sessions | working (`/api/auth/*`) — FR-24; scrypt, `httpOnly` cookie, only the token hash stored |
| …every route scoped to the signed-in candidate | `requireCandidate()` in `api/src/auth/session.ts` is the only way a route learns who is asking — the 15 copies of `currentCandidateId()` are gone |
| …re-auth before data leaves or changes | working (FR-27) — export, erasure and profile edits refuse a password proof older than 12h |
| …browsing still needs no account | FR-24; the index is public and reports `match: null` signed out |
| Rate limiting | 10/min on `/api/auth/*`, 20/min on `/api/suggest`, 600/min overall |
| One origin — API serves the built front end | working (`@fastify/static`), so §9's relative paths hold in production |
| Deployment — Render blueprint, real migrations | `render.yaml` + `prisma/migrations/0_init`; see `docs/DEPLOY.md` |
| …and a test that proves every route is guarded | `api/test/routes-guarded.test.ts` reads the route table and fails naming any endpoint with no auth check — public ones are an explicit, reasoned allowlist |
| First run — a new account gets an explanation, not eight empty screens | `#/welcome`, shown until a profile exists |
| Tests — 94, against real captured fixtures | `pnpm test` |

## Running it

```bash
pnpm install
createdb landfall            # or see api/.env.example
pnpm db:push
pnpm ingest -- addepar1      # any Greenhouse board token(s)
pnpm forms -- --limit=400    # read the forms ingest did not ask for
pnpm dev                     # api on :5175, web on http://localhost:5174
```

**Note for this machine:** Vite binds IPv6 `::1` only, so open
`http://localhost:5174` — `http://127.0.0.1:5174` will not connect. Rollup's
native binary is blocked by Smart App Control, so `pnpm-workspace.yaml`
overrides it with the WebAssembly build.

Reading employers' public job data is unrestricted. Submitting is not something
Landfall does at all — see `CLAUDE.md` and `docs/PROJECT.md`.
