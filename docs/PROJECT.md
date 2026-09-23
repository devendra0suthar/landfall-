# Landfall — competitive research and the documents-only pivot

**Date:** 2026-09-22
**Status:** Decision record. **Amendments applied to `REQUIREMENTS.md`** — see §6.
**Decided this session:** (1) this is landfall, not a new project; (2) posture **C — documents only**; (3) the four §13 decisions, and the extension's fate.

> `REQUIREMENTS.md` remains the spec and now carries these amendments directly.
> Retired FR ids keep their numbers and are marked retired — nothing was renumbered
> and no id was reused, because ids are referenced from code. New requirements
> (FR-39…FR-44) continue from the end.

---

## 1. What I studied

Two reference platforms, both read live today.

### 1.1 jobsuit.ai — **not** an auto-apply product

The headline finding: jobsuit does not apply to anything. No extension, no board
integration, no submission path anywhere on the site. It is a resume optimizer with a
manual tracker attached — and it is now our closest competitor, because posture C puts
us in its market rather than LiftmyCV's.

- **Positioning:** "Stop getting ignored. Start getting interviews." / "Jobsuit
  analyzes, tailors, and improves your resume for every job so you can pass ATS
  filters, stand out to recruiters, and land more interviews."
- **Features:** resume analysis (ATS fit, missing keywords, content gaps) · per-JD
  tailoring · a chat "Resume Agent" framed as a career counsellor · ATS-friendly
  templates · cover letter generator · manual application tracker.
- **Flow:** Create (upload PDF or build) → Analyze → Tailor.
- **Pricing — credit-metered, quoted in INR:** Free = 3 tailorings + 3 analyses + 3
  cover letters/month. Pro ₹416/mo on 6-month billing (₹911 true monthly). Elite
  ₹833/mo (₹1,828 monthly), unlimited.
- **Risk reversal:** 50 tailoring credits across 50 applications, no interviews → 100%
  refund. Falsifiable, and it anchors their whole funnel.
- **Claim:** "Trusted by 500,000+ job-seekers worldwide."

**What they don't have:** any knowledge of the *form*. They tailor a document and stop.
That is the gap posture C can still own — see §4.

### 1.2 liftmycv.com — the full-autonomy benchmark

This is the product landfall was implicitly benchmarking against, and posture C now
declines to compete with it directly.

- **Positioning:** "Your personal AI job search & auto-apply agent" — "scans
  1,750,317+ openings across 12+ job boards and ATS platforms … and applies through the
  workflow you choose – even while you sleep."
- **Pipeline:** Select → AI Match → Prepare → Auto-apply → Track.
- **Four modes:** **Copilot** (pauses before submit for review) · **Autopilot**
  (submits unattended) · **Stealth Apply** (fully autonomous via *their* cloud, no
  extension, no browser open) · **First Apply** (postings <24h old, emailed).
- **Coverage:** LinkedIn, Greenhouse, Glassdoor, Lever, Monster, Workable, Wellfound,
  Recruitee, Breezy, Ashby, Workday, SmartRecruiters.
- **Pricing:** Free · Basic **$9.99/mo** · Unlimited **$69.99/mo** · PAYG **$0.05 per
  auto-apply** (<$0.01 on Unlimited) · one-time "Lift" bundles.
- **Claims:** 20,546+ seekers · ~38 min saved per application · 10× faster. To their
  credit: "LiftmyCV cannot guarantee interviews or job offers."
- **Extension reality check:** Chrome Web Store v2.5.9, 715 KiB, **~2,000 users**, 4.6★
  from 36 ratings. Discloses collecting PII, authentication information, user activity.
  Operator: Fortunestack LTD. White-label offering for agencies/outplacement.

**Their Tier C is our permanently-out-of-scope list.** Stealth Apply is unattended
submission driving a logged-in session — `REQUIREMENTS.md` §5 rules that out forever,
and posture C now rules out submission of any kind.

**The gap they leave:** their own `/ai-auto-apply/` page says *nothing* about knockout
questions, screening questions, EEO/demographic fields, login walls, CAPTCHAs, or
failure modes. That is exactly where auto-apply breaks. It is undocumented because it
is unsolved.

### 1.3 Market conditions

- Applications **+45.5%** while postings fell **10.6%** on LinkedIn; the average
  posting now draws **~242 applicants** (~0.4% chance of standing out). More volume
  tooling is a losing race — which is an argument *for* C.
- **Platforms are enforcing.** LinkedIn's User Agreement prohibits bots, automated
  access and headless browsers; 2025 added detection for "human-impossible application
  velocity" (100+/hr). Accounts get restricted before banned. Tools that draft and let
  the user click send are ToS-compliant; session-driving extensions are not; tools that
  never touch the user's account carry **no ban risk at all** — that is posture C.
- **Employers are filtering** floods of generic AI applications, and some are adding
  AI-free interview policies. The criticism in the coverage is of *indiscriminate*
  automation, not automation as such.

---

## 2. Posture C — documents only

**Decided.** Landfall prepares; the candidate applies. We never submit anything, drive
any browser, or touch a logged-in session.

| | Retired | Kept |
|---|---|---|
| Submission | All three tiers (A/B/C), the sandboxed executor, submission rate caps | — |
| Ingest | — | ATS APIs and official board feeds, politely and identifiably |
| Documents | — | Parse, profile, variants, tailoring, integrity check, letters, PDF |
| Form knowledge | Filling it | **Knowing it** — the fill plan and answer sheet |
| Tracking | Archived bytes of what *we* sent | Tracker on candidate self-report |

### What this costs

Being straight about it: C is the crowded market. jobsuit claims 500,000 users and
there are a hundred resume tools below it. C also discards the most distinctive thing
landfall had measured — Phase 0's 565 fill actions against real employer forms with
zero failures, and the Tier A extension shell in `extension/`.

### What this buys

- **The entire executor disappears.** `REQUIREMENTS.md` §9's `execute/` layer, the
  per-region one-shot Playwright containers, the 60-fixture verification harness gate
  (NFR-11), and the regional egress IP footprint requirement all go. That was the most
  expensive, most operationally fragile, and most legally exposed third of the system.
- **Hosting collapses.** §14's per-region executor container pools are gone. Static
  CDN + regional API/Postgres/object storage remains, which is ordinary.
- **Zero ban risk for candidates**, and no automated traffic to employers at all —
  which retires most of §8's exposure and all of the §5 evasion temptations.
- **Billing gets simple.** No "charged only on successful submission" (FR-31) edge
  cases; jobsuit's credit model maps directly onto tailorings.
- **v0 ships sooner.** Roughly the 8-week v0 minus assisted-apply, plus the answer
  sheet promoted to a first-class deliverable.

---

## 3. The one thing that must not be lost

Posture C only has a defensible product if we keep the form knowledge and sell it to
the human instead of acting on it.

**jobsuit tailors a document and stops. LiftmyCV fills the form and won't tell you how.
Landfall under C tells the candidate exactly what the form will ask and hands them a
prepared, sourced answer for every field.** Nobody in this market does that.

Concretely, the deliverable per posting — call it the **Application Kit**:

1. The tailored resume, with the integrity check visible (FR-12).
2. The cover letter starter, built only from verified facts (FR-13).
3. **The fill plan, rendered for a person** (FR-11): every question this employer's form
   will ask, in form order, with the prepared answer and where it came from.
4. **The answer sheet** (FR-14): the fields we could not resolve, ranked by what they
   unlock — the candidate's to-do list, not a silent failure.
5. The flagged set: EEO, consent, health and attestation questions, listed as *theirs to
   answer*, never pre-filled. Under C this is no longer a restraint we're exercising on
   their behalf — it's simply the honest boundary of the product.

The fill-plan compiler in `plan/` is deterministic, already built, and already measured.
Under C it stops being plumbing and becomes the thing we sell.

---

## 4. Positioning against jobsuit

| | jobsuit.ai | landfall (C) |
|---|---|---|
| Tailored resume | Yes | Yes, with a visible integrity check |
| Knows the employer's form | No | **Yes — fill plan per posting** |
| Answer sheet for unresolved fields | No | **Yes, ranked by fields unlocked** |
| Job discovery / live index | No | Yes, from ATS APIs |
| Match vs readiness | Single ATS score | Two scores, never combined (FR-8) |
| Provenance on every answer | No | Yes (`AnswerSource`) |
| Writes claims for you | Yes, rewrites content | **Never** — selects and orders your own bullets |
| International correctness | Not addressed | Work authorisation, phone/address shapes, remote-in-one-country (FR-10) |
| Pricing | Credits, INR | Open — §7 |

The honest headline: *"We don't write your resume and we don't apply for you. We tell
you exactly what every application will ask, and have your answer ready."*

---

## 5. Language and stack — confirmed, not revisited

`REQUIREMENTS.md` §14 already settled this: **TypeScript on both ends**, and its
argument holds independently of posture. I re-derived the same answer from scratch
before reading it, so treat it as confirmed:

| Layer | Choice | Unchanged by C? |
|---|---|---|
| Front end | TypeScript · React · Vite, static to CDN | Yes |
| API | TypeScript · Node · Fastify | Yes |
| Database | Postgres · Prisma | Yes |
| Queue | pg-boss (Postgres-backed) | Yes |
| Styling | Tailwind | Yes |
| **Executor** | ~~Node · Playwright, one container per run~~ | **Retired** |
| Playwright | Retained **only** for reading public postings and public forms during ingest and form discovery — never a logged-in session | Narrowed |
| AI | `@anthropic-ai/sdk`, `claude-opus-5`, `thinking: {type: "adaptive"}` | Yes — see below |

The decisive argument from §14 is if anything stronger under C: the types in `plan/` and
`ingest/` *are* the specification, and those are the two directories C keeps whole.

**On the AI edge.** It stays thin, as `compose/` already has it. `claude-opus-5` with
adaptive thinking for the two jobs needing judgement — mapping an arbitrary form field
to a profile answer, and selecting which of the candidate's own bullets to surface.
Both are accuracy-critical and low-volume per candidate. Match *pre-filtering* is the
one high-volume path; if you want a cheaper second model there later,
`claude-haiku-4-5` is the current-gen option, but that is a cost decision to make
against measurements, not up front. Use `strict: true` tool definitions for structured
field mappings, and prompt-cache the profile prefix — it is stable across every posting
for a given candidate, which is close to ideal caching shape. NFR-7 still applies: the
deterministic 63.6% stays deterministic.

---

## 6. Amendments — applied 2026-09-22

All of the following are now in `REQUIREMENTS.md`. Also updated: `README.md` (status
table, the "submitting is allowlisted" closing line) and `CLAUDE.md` (rule 4 replaced,
rule 7 added, layout notes on `extension/` and on PROJECT.md winning where the two
documents disagree).

New requirements added: **FR-39** (the Kit), **FR-40** (three-state coverage honesty),
**FR-41** (export + read-only companion), **FR-42** (opening a Kit never contacts the
employer), **FR-43** (unreadable forms still ship a Kit, with the gap stated),
**FR-44** (nothing charged for a Kit we could not build).

**Retired outright:**

- **FR-15, FR-16, FR-17** — Tier A/B/C submission. All three.
- **FR-18** — CAPTCHA/login-wall run termination. No runs to terminate.
- **FR-19** — per-candidate submission rate caps.
- **FR-31** — "nothing charged for a run that did not submit."
- **NFR-11** — executor verification before live traffic.
- **§5 v2** — "autopilot, carefully" in full.
- **§9** — the `execute/` layer.
- **§13 decision 3** — "Tier C at all?" Answered: no tiers at all.

**Rewrite:**

- **FR-20 / FR-21** — the archive is no longer "the bytes we sent" but *the document set
  we handed the candidate*, versioned and immutable per posting. FR-21's
  never-overwrite rule carries over intact.
- **FR-22** — survives and matters **more**: status is `submitted` only on candidate
  confirmation, `confirmed` only on external evidence. Under C every status is
  self-reported, so the three-state discipline is the only thing keeping the tracker
  honest.
- **FR-14** — promoted from fallback to primary deliverable (§3).
- **FR-11** — the fill plan gains a human-facing rendering, not just a machine format.
- **FR-35, FR-36** — destination tiering and the global kill switch now govern *ingest*
  only, not submission.
- **NFR-1, NFR-2** — identity and politeness still apply, to ingest and form discovery.
- **§5 v0/v1** — drop assisted apply from v0; promote the Application Kit into it.
- **§14** — strike the executor row and the per-region container pool from the hosting
  table.

**Newly moot:** §8's retention-vs-erasure conflict gets easier — there is no send
archive with an independent legal life, only documents we generated for the candidate,
which delete with them cleanly.

---

## 7. Decisions taken

1. **`extension/` becomes a read-only companion — display, never fill.** It shows the
   Kit beside the employer's form with per-field copy, and writes nothing into the DOM
   (FR-41). Rationale: it keeps the distribution surface and the posting-identification
   code, and it holds a bright line that is easy to test by absence. Autofill was FR-15,
   which posture C retires.
   **This is the one place C costs real user value** — autofill in the candidate's own
   browser is legal everywhere and is Simplify's entire free product. If churn shows
   candidates want it, reverting to Tier A is a contained change: the fill matcher
   (`api/src/fill/match.ts`, 565 measured actions) is retained either way, because the
   Kit needs the same field mapping to tell a human which answer goes where. Nothing
   measured is thrown away by this decision, which is why it is safe to take now and
   revisit later.
2. **Pricing: credit-metered Kits, PPP-adjusted, one real Kit free.** A credit buys a
   Kit. Recorded as §13.1, FR-33 and FR-44.
3. **Region: global-English-first, Greenhouse-first.** India is the first expansion, not
   the launch — 541/541 Greenhouse schemas are already measured and the adapters exist,
   while India-first would mean discarding the only evidenced part of the product.
   Recorded as §13.2. The tension is real and noted: jobsuit is India-priced and will be
   the direct competitor there.
4. **Interview-or-refund: not at launch.** It is a strong, falsifiable wedge, but under C
   we do not submit, so the causal chain from our work to an interview runs through
   unverifiable candidate self-report — an unbounded refund liability on a number we
   cannot audit. Revisit once §10's Kit-coverage and Kit→submitted metrics have real
   data. The honest version of the same promise, available now, is FR-44: we do not
   charge for a Kit we could not build.
5. **Résumé parsing: build on an open parser, in TypeScript.** Under C parse quality is a
   larger share of total value, and buying an extraction API would route every candidate
   CV — credential-grade data under NFR-8 — through a third party for the one input the
   product depends on. §14's Python-service exception stays available but unexercised.
   Recorded as §13.4.

6. **AI rewording: the model proposes on the candidate's own lines, and a verifier
   stands between it and the CV.** Decided 2026-09-23, resolving the tension §4 left
   open. jobsuit's tailoring rewrites and invents bullets to insert the keywords a
   posting asks for; principle 1 forbids exactly that, and the gap had been blocking
   résumé templates and the chat agent behind it.
   The resolution is not a compromise between the two. The model gets to change
   *words* and never *facts*, and that line is drawn mechanically rather than by
   prompting: `api/src/suggest/verify.ts` rejects any proposal that introduces or
   drops a number, a technology, a named entity, or a claim of scope or credit, and it
   does so **before the candidate sees it** — a warning next to an accept button is a
   warning that gets clicked past. The technology check runs on `termsIn`, the same
   vocabulary the job extractor and scorer use, so the exact keyword a posting asks
   for is the exact keyword we can prove was inserted. Keyword stuffing is not
   discouraged here; it is unrepresentable.
   Nothing is applied in bulk, an accepted line is reversible, and what the candidate
   originally wrote is retained. The count of discarded proposals is shown rather than
   hidden — it is the only place a drift in model behaviour would surface.
   The feature is optional to the deployment (FR-48): with no credentials it switches
   off and says so, and the rest of the product stays deterministic and offline.
   Recorded as FR-45…FR-48.

---

## 8. Screens

Superseding the four-screen prototype in `design/Main.dc.html`, which was built around
assisted apply.

**v0 core loop:**

1. **Upload & confirm parse.** A parse is a proposal, not a fact (FR-2, FR-3).
   Per-field confidence, one-tap accept, bulk-accept for high-confidence groups. This
   screen is where trust is won or lost.
2. **Profile.** Roles, dates, bullets, variants, per-country fields. Completeness shown
   in **form fields unlocked**, never a percentage (FR-5). Sensitive attributes never
   requested (FR-6).
3. **Job feed.** Ranked postings; **match and readiness shown separately and never
   combined** (FR-8). Every score legible — if we can't explain it, we don't show it.
   Filters for country, work authorisation, remote policy (FR-9, FR-10).
4. **Application Kit** — the centerpiece, and the screen that defines posture C (§3).
   Tailored resume with integrity check · letter starter · the fill plan as a readable,
   printable, copyable list of every question the form will ask with its prepared
   answer and source · the answer sheet of unresolved fields ranked by what they unlock
   · the flagged set the candidate must answer themselves. Export as a bundle.
5. **Tracker.** Candidate-marked status. `submitted` and `confirmed` visually distinct,
   never conflated (FR-22). Follow-up prompts when quiet (FR-23).
6. **Account.** Export everything (FR-25), delete everything (FR-26).

**Design primitives**, because they encode the rules rather than decorating them:

- **Provenance chip** on every field value — `AnswerSource`, everywhere, consistently.
- **Three-state indicators.** Unknown / readable / unavailable, visually distinct.
  `formFetchedAt == null` is not `formReadable == false`. Never two states where there
  are three.
- **Integrity check as a visible artifact**, not a modal afterthought: the tailored
  resume shown as *selection and reordering of the candidate's own words*.
- **Blocking flags** on questions that are theirs to answer — cannot be dismissed by
  accident.
- **Honest failure states.** "This employer publishes no readable form" is a designed
  state with a real rendering, not a spinner that never resolves.

Desktop-first, information-dense, responsive to tablet. WCAG 2.2 AA (NFR-5) and full
internationalisation (NFR-3) are requirements, not polish.

**Deliberately not building:** an agent persona (LiftmyCV's "Luna"), fake live activity
("91 jobs auto-applied in the last hour"), or an autonomy dashboard whose job is to
imply the product is working while you sleep. Those sell a posture we have declined.

---

## Sources

- [jobsuit.ai](https://jobsuit.ai/) · [pricing](https://jobsuit.ai/pricing)
- [liftmycv.com](https://www.liftmycv.com/) · [ai-auto-apply](https://www.liftmycv.com/ai-auto-apply/) · [compare](https://www.liftmycv.com/compare/) · [vs JobCopilot](https://www.liftmycv.com/compare/jobcopilot/) · [Chrome Web Store listing](https://chromewebstore.google.com/detail/liftmycv-ai-job-search-au/pdachidppohpjnepdkdheaomgoibolom)
- [Jobscan — AI auto-apply for jobs: are these tools worth it in 2026?](https://www.jobscan.co/blog/auto-apply-job-tools/)
- [jobstrack.io — Why AI job application tools hurt your job search (2026 data)](https://jobstrack.io/blog/ai-job-application-tools)
- [LoopCV — Is it legal to automate job applications?](https://www.loopcv.pro/guides/is-it-legal-to-automate-job-applications/)
- [JobApplyAI — Is auto-applying to LinkedIn jobs against ToS?](https://jobapplyai.in/blog/is-auto-applying-linkedin-jobs-against-tos/)
- [Northlight — LinkedIn automation rules 2026: banned vs. safe tools](https://northlight.ai/blog/is-linkedin-automation-against-the-rules)
