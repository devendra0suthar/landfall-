# Landfall

A worldwide job-application platform. Upload a résumé once; Landfall finds
matching roles anywhere, prepares each application from your own facts, and
files it wherever it is allowed to — recording exactly what was sent.

- **Requirements:** `docs/REQUIREMENTS.md` (14 sections, 38 FRs, 11 NFRs)
- **Prototype:** `design/` — the four core screens, clickable
- **Working rules:** `CLAUDE.md`

## Status — v0, in progress

| | |
|---|---|
| Greenhouse ingest → Postgres | working (260 postings, 2 boards, descriptions and skills) |
| Form schemas captured | working (681 questions across both boards) |
| `GET /api/jobs`, `/api/jobs/:id` | working, with country/remote/age filters |
| Profile + answer bank (`pnpm seed`) | working |
| Fill plan — a source recorded per field | working (`/api/jobs/:id/plan`) |
| Match scoring, with its signals | working (on `/api/jobs` and `/api/jobs/:id`) |
| Tailored résumé + PDF, integrity-checked | working (`/api/jobs/:id/resume[.pdf]`) |
| Cover-letter starters — facts plus prompts | working (`/api/jobs/:id/letter`) |
| Answer bank + gap report, ranked by reach | working (`/api/gaps`, `/api/bank/:key`) |
| Résumé upload, download, replace, delete | working (`/api/resume`) |
| Applications + tracker | working (`/api/applications`) |
| Sent-record archive — written once, hashed | working (`/api/applications/:id/sent`) |
| Follow-ups on applications gone quiet | working (`/api/followups`) |
| Web front end — four screens, real data | working (`pnpm dev`, :5174) |
| `GET /api/profile` | working |

## Running it

```bash
pnpm install
createdb landfall            # or see api/.env.example
pnpm db:push
pnpm ingest -- addepar1      # any Greenhouse board token
pnpm dev                     # api on :5175, web on http://localhost:5174
```

**Note for this machine:** Vite binds IPv6 `::1` only, so open
`http://localhost:5174` — `http://127.0.0.1:5174` will not connect. Rollup's
native binary is blocked by Smart App Control, so `pnpm-workspace.yaml`
overrides it with the WebAssembly build.

Reading employers' public job data is unrestricted. Submitting is allowlisted
and the allowlist ships empty — see `CLAUDE.md`.
