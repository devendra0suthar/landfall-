# Landfall — product requirements

**A worldwide job-application platform.** Upload a résumé once; Landfall finds
matching roles anywhere on earth, prepares each application from your own facts,
and hands you everything the form will ask for — with a source on every answer.

Status: **draft for approval.** Written 15 Sep 2026.

> **Amended 22 Sep 2026 — posture C, documents only.** Landfall prepares; the
> candidate applies. We do not submit applications, drive a browser on a
> candidate's behalf, or touch a logged-in session. The competitive research
> behind this decision is in `PROJECT.md`.
>
> FR ids are referenced from code, so **retired requirements keep their numbers
> and are marked retired** — nothing is renumbered and no id is ever reused.
> New requirements continue from FR-39.

---

## 1. Why this, and why now

Applying for work has become data entry. The median application form asks ~15
questions, the same nine of which cover half of every form on the market, and a
serious job search means answering them 200 times. Candidates outside the US
carry an extra tax: the roles are global, the forms are American, and the
regional boards that actually hold the jobs (Naukri in India, Seek/JobStreet
across APAC, Xing in the German-speaking market) are invisible to most tools
built in San Francisco.

A crowded field of auto-apply products already exists. Most of them solve the
typing and create a new problem: they write the candidate's claims for them.

### What exists today

| Product | Model | Applies by | Price point | Weakness to exploit |
|---|---|---|---|---|
| **LiftmyCV** | Autopilot / Copilot / **Stealth Apply** (autonomous, their cloud) / First Apply; GPT-generated résumé + letter per role | Bot submission across 12 named boards/ATSes | Free tier, $9.99/mo, $69.99 unlimited, **$0.05 per auto-apply** PAYG | Generates the candidate's claims; documents nothing about knockout questions, EEO fields, login walls or failure modes — the hard part is unaddressed. Extension has ~2,000 users |
| **jobsuit.ai** — *closest competitor under posture C* | Résumé analysis + per-JD tailoring + letters + manual tracker | **Does not apply at all** | Free (3 tailorings/mo); Pro ₹416/mo, Elite ₹833/mo on 6-month billing; interview-or-refund on 50 credits | Knows nothing about the employer's form. Rewrites the candidate's content. Claims 500k+ users, so the market is real and it is crowded |
| **Simplify Copilot** | Browser extension autofill | Human clicks submit, on 100k+ career sites | Free | No discovery, no tailoring, no record of what was sent |
| **LoopCV** | Campaign-style bulk apply | Bot + email apply | Subscription | Volume-first; quality and honesty are the user's problem |
| **Teal** | Résumé builder + tracker + GPT answers | Human | Freemium | Not automated; a workspace, not an agent |
| **AIApply / FastApply / Resumly** | "Apply while you sleep" | Bot submission | Subscription | Same fabrication risk; opaque failure |

The pattern: **everyone competes on volume, nobody competes on honesty or on
evidence of what actually happened.** Landfall's wedge is the opposite bet.

---

## 2. What we already know (measured, not assumed)

The `autoapply` research repo (Phase 0, Sep 2026) measured the ingestion problem
directly against 541 live postings from 57 employers. These numbers are the
foundation of the architecture and should not be re-derived:

| Finding | Number | What it decides |
|---|---|---|
| Greenhouse form schemas readable with no auth, no browser | **541/541 (100%)** | A whole ATS can be planned offline, cheaply |
| Reuse ratio across employers | **9.2×** | An answer bank is worth building |
| Question instances needing no LLM | **91.1%** | Per-job generation is a thin edge, not the engine |
| Unique questions covering half of all instances | **9** | The bank is small before it is useful |
| Fields filling deterministically (profile + bank + file) | **63.6%** | Two-thirds of the work needs no model at all |
| Fields only the candidate may answer (EEO, consent, health, arbitration) | **17.7%** | A human is required by design, not by weakness |
| Workday postings exposing a populated question set | **0/24 (0%)** | ~22% of postings cannot be planned offline at all |
| Fill accuracy against 60 local fixtures | **565/565 actions (100%)** | The executor works before it ever touches a live site |

**The market splits architecturally**, and the split is the single most important
engineering fact in this document:

- **Greenhouse** — plan offline, then execute a known plan.
- **Workday, Ashby, Lever, SmartRecruiters, iCIMS** — the form must be discovered
  at runtime, inside a live browser session.

### The world outside the US

- Workday runs **~39%** of Fortune 500 hiring; SAP SuccessFactors ~13%. Together
  they are over half the enterprise market — and neither publishes a form schema.
- Greenhouse dominates the venture-backed employer sample (~49% of top-rated
  employers), which is why it is the cheapest place to start and a misleading
  place to stop.
- Regional reality: **Naukri holds 62–70% of India**, Seek/JobStreet lead APAC,
  Xing matters in DACH, Indeed is the largest single pool at 130M+ listings.
  A platform that is "global" on the strength of LinkedIn alone is not global.

---

## 3. Principles

These are carried over from the Phase 0 research and are **product decisions,
not engineering preferences**. They are what makes Landfall different from the
table in §1.

1. **The candidate's words, or nothing.** Tailoring selects and orders the
   bullets they wrote. It never rewrites one and never invents one. Every
   generated document passes a verbatim integrity check before it can be sent.
2. **Attestations and consent are never automated.** "I certify this is true",
   privacy notices, EEO and demographic questions, visa and health declarations
   are always surfaced to the human. Ticking them on someone's behalf is an
   attestation they did not make. This costs ~1% of fields and is non-negotiable.
3. **Bot walls are recorded, never evaded.** CAPTCHA, rate limits and IP
   reputation checks end the automated run and hand the session to the candidate.
   We do not solve CAPTCHAs, rotate residential proxies, or spoof fingerprints.
4. **We prepare; the candidate applies.** Landfall never submits an application,
   never drives a browser in a candidate's name, and never writes into an
   employer's form. Reading a posting and its public form is unrestricted;
   acting on the candidate's behalf is not something we do at all.
5. **Every handover is archived.** The exact bytes of the document set we gave
   the candidate for a posting are stored and hashed. Three weeks later, "which
   CV did I send them?" has an answer.
6. **No claimed success without evidence.** An application is `submitted` only
   when the candidate says so, and `confirmed` only when a confirmation email or
   status poll says otherwise. Under posture C every status begins as
   self-reported, which makes this the load-bearing rule of the tracker.

---

## 4. Users

| Persona | Situation | What they need from Landfall |
|---|---|---|
| **Priya, 3 yrs experience, Jodhpur** | Applying to India + remote-global roles; every US form asks the same 15 questions | Volume without typing; honest handling of visa/relocation questions |
| **Marco, senior, Berlin** | Targeting DACH + EU remote; Xing and Personio matter more than LinkedIn | Regional coverage; GDPR clarity on where his CV lives |
| **Ade, new graduate, Lagos** | 200+ applications needed; no money for a $70/mo tool | Free tier that is genuinely useful; no fabricated claims that surface in interview |
| **Sara, career-switcher, Toronto** | Same facts aimed at two different job families | Targeting variants — one set of facts, aimed different ways |

---

## 5. Scope

### v0 — MVP ("prove the engine", target: 8 weeks)

Greenhouse only. One ATS, done completely, is worth more than five done partly.

- Résumé upload → parsed into a structured, correctable profile
- Job discovery across Greenhouse boards, with a live index
- Match scoring + readiness scoring, kept separate
- Tailored résumé per posting, with the integrity check visible
- **The Application Kit**: per posting, every question the form will ask, in form
  order, with the prepared answer and its source — plus the answer sheet of
  fields we could not resolve and the set only the candidate may answer
- Application tracker with the handover archive
- Multi-region profile fields (phone formats, address shapes, work authorisation
  per country)

### v1 — ("make it global", +12 weeks)

- Runtime form **discovery** for Workday, Lever, Ashby, SmartRecruiters — reading
  the form to build the Kit, never filling or submitting it
- Regional board adapters: Naukri, Seek/JobStreet, Xing, Indeed (via official
  routes only — see §8)
- Answer bank with per-question reuse across employers
- Targeting variants (one profile, several aims)
- Cover-letter starter built only from verified facts + explicit prompts
- Follow-up reminders on applications that have gone quiet

### v2 — ("deepen, don't automate")

- ~~Unattended submission **only** to allowlisted destinations that permit it~~
  — **retired, posture C**
- Recruiter-visible profile / inbound interest
- Interview scheduling handoff
- Salary and market signal from the index
- Kit coverage as a first-class number: per ATS, what share of the form we can
  tell the candidate about before they open it

### Explicitly out of scope, permanently

- **Submitting an application on a candidate's behalf, by any mechanism** —
  cloud executor, extension click, or emailed apply. Filling a form is not
  submitting one; the submit button stays theirs
- Solving or outsourcing CAPTCHAs
- Residential proxy rotation, fingerprint spoofing, or any evasion of a bot wall
- Writing claims the candidate did not make
- Auto-answering EEO, consent, health, or attestation questions
- Any automated traffic at all to a destination that has asked us to stop

---

## 6. Functional requirements

### Profile and résumé

- **FR-1** A candidate can upload a résumé (PDF, DOCX, RTF, TXT, MD; ≤8 MB).
- **FR-2** The upload is parsed into structured fields — roles, dates, bullets,
  skills, contact details — each with a **confidence score**, presented for
  correction. Parsing pre-fills; it never silently becomes truth. Low-confidence
  extractions are flagged, not hidden.
- **FR-3** The candidate can edit every parsed field, and can see the résumé
  their structured profile produces, as a document, at any time.
- **FR-4** Multiple résumé files may be stored; exactly one is active per
  targeting variant.
- **FR-5** Profile completeness is reported in **form fields unlocked**, not as a
  percentage of our schema.
- **FR-6** Sensitive attributes (disability, health, demographics, religion) are
  never stored in the profile, never inferred, and never required.

### Discovery and matching

- **FR-7** Jobs are ingested from ATS APIs and official board feeds, with the
  source, fetch time and canonical URL recorded per posting.
- **FR-8** Two scores are shown and never combined: **match** (inference from the
  posting) and **readiness** (what fraction of this form we can actually fill).
- **FR-9** Filters must include country, work authorisation, remote policy,
  language, salary where published, and posting age.
- **FR-10** A remote posting that is remote-in-one-country-only is not shown as
  an opening for a candidate who cannot take it.

### Preparing an application

- **FR-11** Each posting compiles into a **fill plan**: an ordered list of
  actions, each with a recorded source (profile / bank / file / generated / human).
- **FR-12** The tailored résumé keeps only bullets the candidate wrote; an
  integrity failure blocks the render rather than degrading it.
- **FR-13** Questions needing prose get a **starter** built from verified facts
  plus explicit prompts for what only the candidate can say. Never a finished lie.
- **FR-14** Fields we cannot resolve are surfaced as an answer sheet, in form
  order, ready to copy.

### Applying — Tier A only

**Amended 22 Sep 2026 (posture C+).** FR-15 is restored. Landfall fills the
employer's own form, in the candidate's own browser, and stops — the candidate
reads what is there and presses submit. That is legal on every destination, is
what the extension was already built to do, and is the difference between
removing the typing and removing the human.

Tiers B and C stay retired. Cloud submission is what puts a candidate's account
at risk and what floods employers with applications nobody read.

- **FR-15 (Tier A — assisted autofill, the only tier).** A browser extension
  fills the employer's own form in the candidate's session from their verified
  facts; the candidate reviews and submits. The extension contains **no submit
  path**, and a test enforces that by absence rather than by a flag — a rule
  that can be switched on by a config change is not a rule.
- ~~**FR-16** (Tier B — supervised auto-apply)~~ — **Retired.** Cloud submission,
  even with a confirmation step, means our infrastructure filing an application
  in someone's name.
- ~~**FR-17** (Tier C — unattended submission)~~ — **Retired, permanently.**
- **FR-18** Any CAPTCHA, login wall or rate limit stops the fill and hands the
  page back, with the reason shown. Restored with FR-15: the extension meets
  these walls in the candidate's own session and must not paper over one.
- **FR-19** The extension fills on the candidate's explicit action, one posting
  at a time. There is no queue and no batch, because the thing that gets a
  platform blocked is volume no human reviewed.

### The handover — what replaces applying

- **FR-39** Each posting produces an **Application Kit**: the tailored résumé
  (FR-12), the letter starter (FR-13), the fill plan rendered for a person in
  form order with a source on every prepared answer (FR-11), the answer sheet of
  unresolved fields ranked by what they unlock (FR-14), and the set only the
  candidate may answer (FR-6), listed as theirs and never pre-filled.
- **FR-40** A Kit states its own coverage honestly, in three states per field
  group: resolved, unresolved, or **not knowable** — the last meaning the vendor
  publishes no readable form. `formFetchedAt == null` (we never asked) is a
  distinct state from `formReadable == false` (there is nothing to read), and the
  Kit must never present one as the other.
- **FR-41** A Kit is exportable as a bundle the candidate keeps — documents plus
  a readable answer sheet — without a Landfall account being necessary to use it
  once exported. The web Kit offers per-field copy for anyone not running the
  extension, so the product works without it (FR-15 is an accelerator, not a
  dependency).
- **FR-42** Opening a posting's Kit never contacts the employer. The form was read
  at ingest; the Kit is compiled from stored facts.
- **FR-43** Where a form cannot be read at all (0/24 Workday postings in §2), the
  Kit still ships — with the nine-question core from the answer bank and an
  explicit statement that the rest of this employer's form is unknown. A Kit that
  silently omits what it does not know is a false report.

### Tracking

- **FR-20** Every application records status, timestamps and the archived bytes of
  **the Kit we handed over**, hashed, written once. (Amended: this was "what was
  sent" when Landfall sent it. We no longer send, so the archive records what the
  candidate was given, which is what answers "which CV did I send them?")
- **FR-21** Re-marking an application never overwrites the first handover record.
- **FR-22** Status is `submitted` only on the candidate's own mark, and never
  `confirmed` without external evidence. Both transitions are candidate- or
  evidence-driven; nothing in Landfall may advance either on its own.
- **FR-23** Follow-up prompts when an application has been quiet beyond a
  configurable window.

---

### Accounts and access

- **FR-24** Sign-up with email or an OAuth provider. No account is required to
  browse; one is required before anything is stored.
- **FR-25** A candidate can export everything held about them, in a machine
  readable form, without asking a human (GDPR Art. 20, DPDP, CCPA).
- **FR-26** A candidate can delete their account from inside the product. Deletion
  is a product feature with a visible outcome, not a support ticket.
- **FR-27** Sessions expire, and a long-lived session is re-authenticated before
  a Kit is exported or the profile is edited. (Amended: this used to guard Tier B
  and C runs acting in the candidate's name. Nothing acts in their name now, so
  the guard moves to the points where their data leaves or changes.)

### Notifications

- **FR-28** Alert on new postings matching a saved search, at a frequency the
  candidate sets — including "never".
- **FR-29** Notify when a Kit is ready, and always when one **cannot be built**,
  with the reason. A silent failure is indistinguishable from a Kit nobody looked
  at, which is the worst possible state for a job seeker.
- **FR-30** Follow-up reminders (FR-23) arrive on the same channel and obey the
  same frequency setting.

### Billing

- ~~**FR-31** (nothing charged for a run that did not submit)~~ — **Retired,
  posture C.** There are no runs. Superseded by FR-44.
- **FR-32** Pricing is purchasing-power adjusted by region. A flat $69.99/month
  is roughly a week's wages in several launch markets, and a global platform that
  prices for San Francisco is not global.
- **FR-33** The free tier must produce at least one **complete, real Application
  Kit** — not a preview, not a watermarked sample. A tier that only demonstrates
  the product teaches nobody whether it works.
- **FR-34** Every charge maps to a specific application, visible in the tracker.
- **FR-44** Nothing is charged for a Kit that could not be built, and nothing is
  charged twice for the same posting. A Kit that came back "this employer's form
  is unreadable" (FR-43) is our measurement gap, not the candidate's cost.

### Operations and administration

- **FR-35** **Ingest** tiering per destination — read freely / read politely /
  do not read — is configuration, editable without a deploy, with every change
  recorded and attributed. (Amended: this used to tier submission A/B/C. There is
  no submission to tier, but reading still needs the same governance.)
- **FR-36** Any destination can be **disabled instantly**, globally, by one
  operator — the response to an employer or board asking us to stop reading.
- **FR-37** A published contact address on every automated request, and an inbox
  behind it that a human reads.
- **FR-38** Abuse controls run on our own users too: a candidate generating Kits
  far beyond human plausibility is rate-limited and reviewed. Under posture C this
  is a cost and credibility control rather than a ban-risk one — but a scraped
  index resold as a Kit farm is still what gets a destination closed to us.

## 7. Non-functional requirements

- **NFR-1 Identity.** Requests carry an honest User-Agent and contact address.
  We never present automated traffic as a human browser.
- **NFR-2 Politeness.** Global throttle ~3 req/s per destination; negative
  responses cached so 404s are not re-probed.
- **NFR-3 Internationalisation.** UI and all candidate-facing documents support
  non-Latin scripts, right-to-left layout, international phone/address/date
  formats, and per-country work-authorisation vocabularies from day one.
- **NFR-4 Data residency.** EU candidates' data stays in the EU. Region is a
  deployment property, not a config flag.
- **NFR-5 Accessibility.** WCAG 2.2 AA for the candidate-facing app.
- **NFR-6 Auditability.** Every automated action is reconstructable from logs:
  what was sent, where, when, and on whose instruction.
- **NFR-7 Cost.** Deterministic paths must stay deterministic — the 63.6% that
  needs no model must never quietly start calling one.
- **NFR-8 Security.** Résumés and profiles encrypted at rest; secrets in a managed
  store, never in config; a published vulnerability-disclosure route; penetration
  test before the first paid user. We hold complete professional identities —
  name, address, phone, work history — which is a credential-grade dataset even
  though it contains no passwords.
- **NFR-9 Telemetry.** We measure the funnel, not the content. Which fields fail
  to resolve is a product metric; what a candidate wrote in them is not, and is
  never logged.
- **NFR-10 Availability.** 99.5% for the app. A missed run is rescheduled, never
  silently dropped — every queued run either completes, fails loudly, or is
  cancelled by the candidate.
- **NFR-11 Verification against fixtures.** Every plan-compiler, adapter and
  field-matcher change is proved against local fixtures before it ships. Phase 0
  ran 565 fill actions against 60 fixtures with zero failures — **that harness
  survives posture C intact**, because what it actually measures is whether we
  correctly identify which form field a stored answer belongs to. That is now the
  Kit's accuracy gate rather than an executor's.

---

## 8. Legal and compliance — the part most competitors skip

| Constraint | What it means for us |
|---|---|
| **LinkedIn User Agreement §8.2** bans bots and unauthorised automated access; 2025–26 saw ban waves against extensions, and 2025 added detection for human-impossible application velocity | LinkedIn is **deep-link only**. We do not read it, autofill it, or submit to it. Posture C removes candidate ban risk entirely — a tool that never touches their account cannot get it restricted |
| **Indeed / Glassdoor** forbid robots and scrapers | Official partner routes or nothing. No scraping |
| **EU Database Directive** protects listings against substantial extraction | Ingest via APIs and feeds we are permitted to use; no bulk extraction of a board's database |
| **GDPR** — we are a **controller**, often jointly with the candidate | Explicit consent before processing a CV; documented lawful basis; access, erasure and portability implemented as product features, not support tickets |
| **GDPR Art. 9** — CVs can contain health, union, religious data | Never required, never inferred, never used for matching. Flagged and excluded on parse |
| **Third parties in a CV** (referees, managers) | Transparency obligation; we do not process referee data beyond storing the document |
| **EU AI Act** — employer-side hiring AI is high-risk; **candidate-side tools are not restricted by it** | We are candidate-side. Say so plainly; do not market as a hiring-decision system |
| **India DPDP Act / CCPA** | Same rights surface, region-aware retention |
| **Fraud** — knowingly false statements in an application | The honesty principles in §3 are the compliance control. A platform that writes claims for a user manufactures this risk; we architecturally cannot |

### Retention, erasure, and a real conflict inside this document

FR-20 says the bytes of every handover are archived and **never overwritten**.
FR-25 and FR-26 say a candidate can take their data and erase their account. Both
are correct and they collide, so the resolution belongs here rather than in a bug
report six months from now:

> **Posture C makes this materially easier.** The archive is no longer a record of
> what *we* transmitted to a third party — it is a set of documents we generated
> for the candidate and gave to them. It has no independent legal life, no
> counterparty with an interest in it, and deletes cleanly.

- **Erasure wins.** Deleting an account deletes the archives with it. The archive
  exists to serve the candidate's own memory of what they sent — it is not a
  compliance record we are obliged to keep, and there is no lawful basis for
  keeping a CV after the person withdraws consent.
- **Immutability holds while the account lives.** "Written once" is a rule about
  our code never rewriting history, not a claim that the candidate cannot end it.
- **Retention default: 24 months** from the send, then automatic deletion, with
  the candidate able to shorten it. An application older than two years is
  history, not a live thread.

**Position:** Landfall does not apply on anyone's behalf. Every destination's
terms permit what we do, because what we do is read public postings and prepare
the candidate's own answers for them. The value comes from removing the *lookup* —
knowing what will be asked and having the answer ready — not from removing the
human, and not from volume.

---

## 9. Architecture — static front end, no executor

```
ingest/          ATS + board adapters; schema probes; live index
profile/         structured facts, variants, résumé files, parse + confidence
plan/            deterministic fill-plan compiler (no browser, no model)
compose/         bullet selection, integrity check, starters (thin LLM edge)
kit/             assembles the Application Kit; renders the fill plan for a human
record/          application tracker, handover archive, hashes, follow-ups
trust/           consent, retention, erasure, region routing, rate limits
```

Phase 0's TypeScript adapters, schema probes and fill-plan compiler port directly
into `ingest/` and `plan/` — roughly a third of v0 already measured and working.

### The front end is static, and that is a decision

The candidate-facing app ships as static assets behind a CDN, talking to a
regional API. No server-side rendering.

- **It is a logged-in tool, not a content site.** SEO is irrelevant behind the
  login, so SSR buys nothing and costs a render tier. Marketing pages are a
  separate static site and can be indexed properly.
- **Data residency gets easier** (NFR-4). Static assets are global; the API and
  the database are regional. An EU candidate's data never leaves the EU because
  their API origin never does.
- **The cost is honest:** search and the job index must be real API endpoints
  rather than server-rendered pages, and the first paint needs an empty-state
  that is genuinely useful rather than a spinner.

### There is no executor, and that is the largest consequence of posture C

The original design put anything that drives a browser in a one-shot container,
one per application run, with per-region egress and credential injection. **All of
it is retired.** Nothing in Landfall opens a browser in a candidate's name, so
there is no session to contain, no credential to inject, and no egress footprint
to defend.

What that removes, concretely: the per-run container pool, the per-region executor
deployment (§14), credential containment as a design problem, and the whole
class of failure where a hung Chromium half-submits an application and we cannot
tell whether the employer received it. That last one was the worst state in the
old design and it no longer exists.

**Playwright survives in one narrowed role: reading.** Runtime form discovery for
the ATSes that publish no schema (§2 — Workday, Lever, Ashby, SmartRecruiters)
still needs a real browser to see the form. That is a read against a public page,
on our own infrastructure, rate-limited and identifiable (NFR-1, NFR-2), with no
candidate session and no credentials anywhere near it. It runs on a schedule to
populate the index, not per candidate and not per application.

**Everything else is a pure function over stored facts** — the plan compiler,
matching, tailoring, the integrity check, Kit assembly. No browser, no network.
Which is why 63.6% of every form resolves with no model and no page fetch, and why
opening a Kit never contacts the employer (FR-42).

## 10. Success metrics

| Metric | Target at v0 exit |
|---|---|
| Deterministic field coverage (no model, no human) | ≥60% |
| Kits prepared per candidate-hour | ≥12 (vs ~4 manual applications) |
| Fabricated-claim incidents | **0** — enforced by the integrity check, measured by audit |
| **Kit coverage** — share of a form's questions we can state before the candidate opens it | ≥80% on Greenhouse |
| **Kit honesty** — fields presented as resolved that were wrong | **0** (FR-40) |
| Kit → candidate-marked `submitted` | ≥70% |
| Median time from "found a role" to "Kit in hand" | <4 min |

Deliberately **not** a metric: applications submitted per day. That number is
what produces spam, and every product in §1 optimises for it. Under posture C we
could not measure it honestly even if we wanted to — we do not submit, so any
number we published would be candidate self-report dressed as telemetry.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Posture C is a crowded market** — jobsuit claims 500k users and there are a hundred résumé tools below it | **High** | The Kit is the differentiator, not the tailoring (`PROJECT.md` §3–4). If the Kit is not visibly better than a résumé tool, C has no product |
| **Candidates want the submission we declined to build** | **High** | Position from the first screen: we tell you what will be asked and have the answer ready. Measure churn against this specifically — it is the decision most likely to need revisiting |
| Destination bans automated traffic outright | Low | We read public postings, identifiably and politely, and submit nothing. FR-36 disables a destination instantly if asked |
| Workday/SuccessFactors never expose schemas | Certain | Runtime discovery is v1 scope, budgeted. FR-43 makes an unreadable form a stated Kit limitation rather than a silent gap |
| Résumé parsing quality disappoints | **Medium→High under C** | Parse quality is now a larger share of the whole product. Confidence scores + mandatory correction step; parsing pre-fills, never decides |
| Regional board partnerships are slow | Medium | v0 ships Greenhouse-only; regional coverage is a v1 commercial workstream, started now |
| LLM cost creep | Medium | 91.1% of instances need no model; enforce with a budget alarm per Kit |

---

## 12. Naming — checked, not guessed

**Recommended: Landfall.** The first sight of land after a long crossing. That
is what the end of a job search actually feels like, and the metaphor keeps
working as the product grows past auto-apply. It spells itself by ear in every
launch market, which "Azimuth" does not.

Availability was verified against RDAP (the authoritative registry protocol) on
15 Sep 2026:

| Candidate | Domains | Trade-class conflicts found | Verdict |
|---|---|---|---|
| ~~Meridian~~ | `.com` (1997), `.ai`, `.jobs`, `.work`, `.careers`, and every use/try/join/get prefix — **all taken**; `.work` and `.careers` registered Feb 2026 | — | **Dropped.** Contested inside our own category |
| ~~Kestrel~~ | `kestrelapply.com`, `applykestrel.com`, `kestrel.jobs` free | **Kestrel Recruitment** (UK) and **Kestrel Recruitment** (AU) | **Dropped.** Same trade class |
| ~~Sextant~~ | `sextantapply.com`, `applysextant.com`, `sextantjobs.com`, `sextant.jobs` free | **Sextant Consulting Group** runs recruitment practices | **Dropped.** Same trade class, and the first syllable is a liability in several launch markets |
| **Landfall** | **`landfalljobs.com` and `landfall.jobs` free** | None found | **Recommended** |
| Azimuth | `azimuthapply.com`, `azimuth.jobs` free | None found | Runner-up |

**Known mark against Landfall:** in US and Indian press, "landfall" is what a
cyclone makes. Weigh that against a name people can spell after hearing it once.

### Still outstanding

- `.jobs` is a **restricted TLD** with eligibility rules that have not been
  verified. Plan on `landfalljobs.com` as the real address and treat
  `landfall.jobs` as a bonus.
- **A domain check and a web search are not trademark clearance.** An official
  register search in each launch country, by a lawyer, comes before any spend on
  branding.

## 13. Decisions — settled 22 Sep 2026

All four are now decided. Rationale in `PROJECT.md`; recorded here because they
constrain the schema.

1. **Business model — credit-metered Kits, with a free tier that produces a real
   one.** Posture C removes the "charge only on successful submission" question
   entirely (FR-31 retired), which makes jobsuit's credit model the natural fit:
   a credit buys a Kit. Purchasing-power adjusted per region (FR-32), one real
   Kit free (FR-33), nothing charged for a Kit we could not build (FR-44).
2. **Launch region — global-English-first, Greenhouse-first, as originally
   written.** India is the first expansion, not the launch. The reason is
   §2: 541/541 Greenhouse schemas are already measured and the adapters already
   exist. India-first would mean building Naukri ingest from zero and discarding
   the only part of this product with evidence behind it. Noting the tension —
   jobsuit is clearly India-priced and will be the direct competitor there, so
   the expansion is a commercial workstream that starts now, not later.
3. **Tier C — no.** Answered by posture C, and more broadly than the question
   asked: there are no tiers at all. The submit allowlist mechanism is not built
   empty, it is not built.
4. **Résumé parsing — build on an open parser, in TypeScript, first.** Buying an
   extraction API would put every candidate CV through a third party, and §8
   would then have to account for a processor holding credential-grade data
   (NFR-8) for the one input the entire product depends on. Under posture C parse
   quality is a larger share of total value, which argues for owning it rather
   than renting it. §14's "honest exception" for a Python parsing service behind
   an HTTP boundary stays available but unexercised — revisit only if measured
   quality is insufficient, not on suspicion that it will be.

---

## 14. Technology

**TypeScript on both ends.** Not a preference — the decision is close to forced by
what already exists.

| Layer | Choice | Why this one |
|---|---|---|
| Front end | TypeScript · React · Vite | Static build to a CDN, which §9 commits to. Familiar from guidetrack, so the concepts port |
| API | TypeScript on Node — Fastify or Hono | Phase 0's adapters, schema probes, plan compiler and integrity check are already TypeScript |
| ~~Executor~~ | ~~Node · Playwright, one container per run~~ | **Retired, posture C** (§9) |
| Form discovery | Node · Playwright, scheduled, read-only | Reads public forms to populate the index. No candidate session, no credentials, not per-application |
| Database | Postgres · Prisma | Same stack already deployed once on guidetrack |
| Queue | pg-boss (Postgres-backed) | One datastore rather than two, until volume argues otherwise |
| Styling | Tailwind | Fast, and the design tokens live in one place |

**The decisive argument.** Rewriting Phase 0 in Python or Go discards the only
part of this product that has been measured — 541 postings, 565 fill actions,
zero failures. The types in `plan/` and `ingest/` *are* the specification;
porting them means re-deriving that for no gain.

**One honest exception.** If §13's decision 4 goes toward *building* résumé
parsing rather than buying it, Python wins on merit — `pdfplumber`, `spaCy`
and the extraction ecosystem live there. That is one service behind an HTTP
boundary, not a second language through the codebase. Buying the API keeps the
stack single-language.

**Deliberately not used:** Next.js. §9 rules out server-side rendering, so running
it purely for a static export carries a render framework we have decided not to
use. Vite does that job with less.

### Hosting shape, per region

Data residency (NFR-4) is the constraint that decides the topology:

| Tier | Deployment | Notes |
|---|---|---|
| Static assets | One global CDN | No candidate data in them, so no residency question |
| API + Postgres | **Per region** — EU, US, India to start | A candidate's origin is regional, so their data never crosses a border it should not |
| ~~Executor containers~~ | ~~**Per region**, pooled, one-shot~~ | **Retired, posture C.** The hosting shape collapses to CDN + regional API/DB/storage |
| Form-discovery workers | Central, or one per region for latency only | They hold no candidate data, so residency does not constrain them — only NFR-1's honest, inspectable footprint does |
| Object storage | Per region | Résumé files and send archives live beside their region's database |

Adding a country means adding a region, not re-architecting. That is the whole
reason for keeping rendering out of the server tier.

---

## Sources

Market scan: [LiftmyCV pricing](https://www.liftmycv.com/pricing/) ·
[Simplify Copilot](https://simplify.jobs/copilot) ·
[LoopCV](https://www.loopcv.pro/) ·
[Teal](https://www.tealhq.com/tools/autofill-job-applications) ·
[AIApply](https://aiapply.co/) · [FastApply](https://fastapply.co/us) ·
[Resumly](https://www.resumly.ai/)

Legal: [LoopCV — is it legal to automate job applications](https://www.loopcv.pro/guides/is-it-legal-to-automate-job-applications/) ·
[TakeMeUp — is auto-apply legal in the EU](https://takemeup.cv/en/guides/is-auto-apply-to-jobs-legal-eu) ·
[JobApplyAI — LinkedIn ToS](https://jobapplyai.in/blog/is-auto-applying-linkedin-jobs-against-tos/)

Market share: [ATS market share 2026](https://resumegeni.com/research/ats-market-share-2026) ·
[Jobscan ATS usage report](https://www.jobscan.co/blog/fortune-500-use-applicant-tracking-systems/) ·
[Naukri market position](https://bestjobsearchapps.com/articles/en/best-job-sites-in-india-2026-top-picks-naukri-vs-linkedin-vs-indeed-and-complete-guide)

Internal: `C:\Users\D\Downloads\autoapply-phase0\autoapply\README.md` (Phase 0
measurements, 10 Sep 2026) and its `docs/DECISIONS.md`.
