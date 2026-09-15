# Landfall — working rules

A worldwide job-application platform. Requirements: `docs/REQUIREMENTS.md`.
Interactive prototype of the four screens: `design/Main.dc.html`.

## Layout

```
api/    Fastify + Prisma. Ingest adapters, plan compiler, records.
web/    Vite + React, static build. Talks to the API, renders nothing server-side.
docs/   REQUIREMENTS.md is the spec. Numbered FR-/NFR- ids are referenced in code.
design/ The prototype canvas (Design Components format).
```

## Rules that are not style preferences

These come from `docs/REQUIREMENTS.md` §3 and are the product. Code that breaks
one is wrong even when it passes review on every other axis.

1. **Never write a claim on the candidate's behalf.** Tailoring selects and
   orders bullets they wrote. Any code path that edits bullet text is a bug.
2. **Never auto-answer an attestation, consent or demographic question.** There
   is no column for one in `schema.prisma`; keep it that way.
3. **Never evade a bot wall.** CAPTCHA, rate limit or login wall ends the run
   and hands the session back. No solving services, no proxy rotation, no
   fingerprint spoofing.
4. **Submission is allowlisted.** `Board.submitAllowed` ships false. Reading is
   unrestricted; submitting is not.
5. **Archive what was sent, once.** `SentRecord` is written on the first
   transition into APPLIED and never updated — but it is deleted with the
   candidate, because erasure wins over immutability.
6. **`submitted` is not `confirmed`.** Only external evidence changes that.

## Conventions

- **Three states, not two.** Unknown is a state. `formFetchedAt == null` means
  we have not asked; `formReadable == false` means the vendor publishes none.
  Collapsing them turns a measurement problem into a false report — Phase 0
  caught exactly this with Workday's questionnaire pointer.
- **Every answer carries its source** (`AnswerSource`). A value with no
  recorded provenance does not go on a form.
- **A parse is a proposal, never a fact.** `profile/parse.ts` returns a
  confidence and a reason per field and writes nothing. It becomes true when a
  person confirms it through `PUT /api/profile`, and not before.
- **Nullable beats wrong.** `countryOf()` returns null rather than guessing; a
  wrong country shows someone a role they cannot take.
- Comments explain *why*, especially where the obvious implementation is the
  wrong one. Match the density already in the file.
- TypeScript strict, `noUncheckedIndexedAccess` on. `pnpm typecheck` before
  anything is called done.

## Commands

```
pnpm dev            api (:5175) and web (:5174) together
pnpm ingest -- <board-token>   pull a Greenhouse board into the index
pnpm db:push        apply schema.prisma
pnpm typecheck      both packages
```

Local Postgres: role `landfall`, database `landfall`, see `api/.env.example`.

## This machine

- **Vite binds IPv6 `::1` only.** Use `http://localhost:5174`; `127.0.0.1:5174`
  refuses the connection. The API binds `127.0.0.1:5175`, and Vite proxies
  `/api` to it server-side, so the mismatch never reaches the browser.
- **Smart App Control blocks Rollup's native `.node` binary.** `pnpm-workspace.yaml`
  overrides `rollup` with `@rollup/wasm-node`. Do not "fix" this by disabling
  Smart App Control — on Windows Home it cannot be re-enabled without
  reinstalling the OS.
- Stop the API before `prisma generate`: a running server holds the query-engine
  DLL open and generation fails with EPERM.
