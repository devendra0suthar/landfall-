# Landfall

A worldwide job-application platform. Upload a résumé once; Landfall finds
matching roles anywhere, prepares each application from your own facts, and
hands you everything the form will ask for — with a source on every answer.

**Landfall prepares; you apply.** We do not submit applications, drive a browser
on your behalf, or touch a logged-in session. See `docs/PROJECT.md`.

- **Requirements:** `docs/REQUIREMENTS.md` (14 sections, 44 FRs, 11 NFRs)
- **Decision record:** `docs/PROJECT.md` — competitive research, and the
  documents-only posture that amends the spec
- **Prototype:** `design/` — the four core screens, clickable (predates the
  posture change; the Application Kit screen is not in it yet)
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
| Tier A extension — fills the employer's form, never submits | built, untested, and **superseded by posture C** (FR-15 retired). To be reworked as a read-only companion or removed — see `docs/PROJECT.md` §7 |
| Application Kit — the posture-C deliverable | working (`/api/jobs/:id/kit`, `#/kit/:id`) — FR-39…FR-43 |
| Kit on an unreadable form — ships anyway, states the gap | working (FR-43; `fields: null`, never 0) |
| Kit is the single apply view | the old `Prepare` screen folded into it; `#/prepare/:id` redirects |
| Tests — 54, against real captured fixtures | `pnpm test` |

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
