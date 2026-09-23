# Landfall — working rules

A worldwide job-application platform. Requirements: `docs/REQUIREMENTS.md`.

**Posture C+, 22 Sep 2026: Landfall fills; the candidate submits.** The extension
fills the employer's own form in the candidate's own browser (FR-15) and stops.
Our servers never file an application, and Tiers B and C — cloud submission,
attended or not — stay retired. The decision record and its competitive research
are in `docs/PROJECT.md`, which amends the spec — read both.

## Layout

```
api/       Fastify + Prisma. Auth, ingest adapters, plan compiler, records. Everything
           here is deterministic except src/suggest/, which is the only code in
           the product that calls a model — and is optional (FR-48).
web/       Vite + React, static build. Talks to the API, renders nothing server-side.
extension/ Tier A autofill, restored 22 Sep 2026 (FR-15). Fills the employer's
           own form in the candidate's session; contains no submit path, and a
           test enforces that by absence — extension/test/no-submit.test.ts.
           Keep that test whatever else changes. `pnpm build:extension`, then
           load extension/dist/ unpacked.
docs/   REQUIREMENTS.md is the spec; PROJECT.md amends it and wins where they
        disagree. Numbered FR-/NFR- ids are referenced in code — retired ids keep
        their numbers and are never reused.
design/ HISTORICAL ONLY. The prototype canvas predates posture C *and* the
        visual rebuild, so its screens, typefaces and palette all disagree with
        the product. The design system is web/src/styles.css; the screens that
        exist are docs/PROJECT.md §8. Do not treat it as a reference.
```

## Rules that are not style preferences

These come from `docs/REQUIREMENTS.md` §3 and are the product. Code that breaks
one is wrong even when it passes review on every other axis.

1. **Never write a claim on the candidate's behalf.** Tailoring selects and
   orders bullets they wrote. Any code path that edits bullet text *on its own*
   is a bug. There is exactly one path where a machine's wording can end up in
   a bullet — `src/suggest/` (FR-45…FR-48) — and it is not an exception to this
   rule, it is the rule implemented: the model only ever proposes, every
   proposal is checked by `suggest/verify.ts` for invented numbers, tools,
   names and claims of credit *before a human sees it*, and the text changes
   only when the candidate accepts, which makes the edit theirs. Keep those
   tests. Tailoring itself still never writes, and `integrity.allVerbatim` is
   still computed against the stored profile — do not "simplify" this by
   letting a proposal write straight through.
2. **Never auto-answer an attestation, consent or demographic question.** There
   is no column for one in `schema.prisma`; keep it that way.
3. **Never evade a bot wall.** CAPTCHA, rate limit or login wall stops the read.
   No solving services, no proxy rotation, no fingerprint spoofing.
4. **Never submit. Fill only in their own browser.** The extension fills the
   employer's form in the candidate's own session and stops (FR-15); the submit
   button is theirs. Landfall's servers never file an application. Any code path
   that submits — or that fills from our infrastructure rather than their
   browser — is wrong. `extension/test/no-submit.test.ts` enforces the first half
   by absence; keep it.
5. **Archive what was handed over, once.** `SentRecord` is written on the first
   transition into APPLIED and never updated — but it is deleted with the
   candidate, because erasure wins over immutability.
6. **`submitted` is not `confirmed`.** `submitted` comes from the candidate's own
   mark; only external evidence makes it `confirmed`. Nothing advances either on
   its own.
7. **One way to know who is asking.** `requireCandidate(req, reply)` — or
   `requireFreshAuth` where data leaves or changes (FR-27) — from
   `src/auth/session.ts`. Nothing else. This rule exists because the thing it
   replaced was fifteen hand-copied `currentCandidateId()` helpers that each
   returned `findFirst()`, and a route that forgets to check must now be a
   deliberate act rather than a copy-paste. A new endpoint touching candidate
   data and not calling one of those two is wrong. Browsing the job index is
   the one deliberate exception (FR-24) and uses `sessionFromRequest`, which
   may return null.
8. **A Kit states what it does not know.** Presenting an unread form as having no
   questions, or an unresolved field as resolved, is the worst bug this product
   can ship — it sends someone into an interview unprepared while telling them
   they are ready.

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
- TypeScript strict, `noUncheckedIndexedAccess` on. `pnpm typecheck` AND
  `pnpm test` before anything is called done — every bug this project has
  actually shipped type-checked perfectly. A test that encodes a rule from the
  list above is worth more than one that covers a line.

## Commands

```
pnpm dev            api (:5175) and web (:5174) together
pnpm ingest -- <board-token>   pull a Greenhouse board into the index
pnpm db:push        apply schema.prisma
pnpm typecheck      both packages
pnpm migrate dev --name <x>    a schema change as a real migration
pnpm build          production build (prisma generate + web)
pnpm start          migrate deploy, then serve API + web on one origin
pnpm test           107 tests, no network — fixtures in api/test/fixtures/
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
