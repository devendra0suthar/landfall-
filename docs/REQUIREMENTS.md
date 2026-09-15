# Landfall — product requirements

**A worldwide job-application platform.** Upload a résumé once; Landfall finds
matching roles anywhere on earth, prepares each application from your own facts,
and files it wherever it is allowed to — recording exactly what was sent.

Status: **draft for approval.** Nothing is built yet. Written 15 Sep 2026.

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
| **LiftmyCV** | Autopilot / Copilot toggle, GPT-generated résumé + letter per role | Bot submission across ~10 boards | Free tier, $9.99/mo, $69.99 unlimited; credit ("Lifts") metering, only successful submits charged | Generates the candidate's claims; coverage is board-shaped, not ATS-shaped |
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
4. **Submission is allowlisted; reading is not.** A destination becomes
   submittable by explicit configuration, never by default.
5. **Every send is archived.** The exact bytes that went to the employer are
   stored and hashed. Three weeks later, "which CV did they see?" has an answer.
6. **No claimed success without evidence.** A submission is `submitted`, not
   `confirmed`, until a confirmation email or status poll says otherwise.

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
- **Assisted apply**: Landfall fills the form in the candidate's own browser;
  the candidate reviews and clicks submit
- Application tracker with the sent-document archive
- Multi-region profile fields (phone formats, address shapes, work authorisation
  per country)

### v1 — ("make it global", +12 weeks)

- Runtime form discovery for Workday, Lever, Ashby, SmartRecruiters
- Regional board adapters: Naukri, Seek/JobStreet, Xing, Indeed (via official
  routes only — see §8)
- Answer bank with per-question reuse across employers
- Targeting variants (one profile, several aims)
- Cover-letter starter built only from verified facts + explicit prompts
- Follow-up reminders on applications that have gone quiet

### v2 — ("autopilot, carefully")

- Unattended submission **only** to allowlisted destinations that permit it
- Recruiter-visible profile / inbound interest
- Interview scheduling handoff
- Salary and market signal from the index

### Explicitly out of scope, permanently

- Solving or outsourcing CAPTCHAs
- Residential proxy rotation, fingerprint spoofing, or any evasion of a bot wall
- Writing claims the candidate did not make
- Auto-answering EEO, consent, health, or attestation questions
- Mass-submitting to employers who have asked automated traffic not to

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

### Applying — three tiers, by destination

- **FR-15 (Tier A — assisted, default everywhere).** A browser extension fills
  the employer's own form in the candidate's session; the candidate reviews and
  submits. Legal on every destination and the only tier permitted on boards whose
  terms prohibit automated access.
- **FR-16 (Tier B — supervised auto-apply).** Landfall drives a browser, fills,
  and pauses for a single confirmation before submit. Available only where the
  destination's terms permit it.
- **FR-17 (Tier C — unattended).** Submission with no per-application review.
  Allowed **only** for destinations on the submit allowlist. Ships empty.
- **FR-18** Any CAPTCHA, login wall or rate limit ends the run and hands the
  session back, with the reason recorded.
- **FR-19** Per-candidate submission rate is capped (default ≤25/day/destination),
  configurable downward, never upward by the candidate.

### Tracking

- **FR-20** Every application records status, timestamps and the archived bytes
  of what was sent, hashed, written once.
- **FR-21** Re-marking an application never overwrites the first send record.
- **FR-22** Status is `submitted`, never `confirmed`, without external evidence.
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
- **FR-27** Sessions expire; a long-lived session is re-authenticated before any
  Tier B or Tier C run, because that run acts in the candidate's name.

### Notifications

- **FR-28** Alert on new postings matching a saved search, at a frequency the
  candidate sets — including "never".
- **FR-29** Notify when a run finishes, and always when one **fails**. A silent
  failure in an apply queue is indistinguishable from a submitted application,
  which is the worst possible state for a job seeker.
- **FR-30** Follow-up reminders (FR-23) arrive on the same channel and obey the
  same frequency setting.

### Billing

- **FR-31** Nothing is charged for a run that did not submit. A CAPTCHA, a login
  wall or a rate limit is our failure to route around honestly, not the
  candidate's cost.
- **FR-32** Pricing is purchasing-power adjusted by region. A flat $69.99/month
  is roughly a week's wages in several launch markets, and a global platform that
  prices for San Francisco is not global.
- **FR-33** The free tier must complete a real application end to end. A tier that
  only demonstrates the product teaches nobody whether it works.
- **FR-34** Every charge maps to a specific application, visible in the tracker.

### Operations and administration

- **FR-35** Destination tiering (A / B / C) is configuration, editable without a
  deploy, with every change recorded and attributed.
- **FR-36** Any destination can be **disabled instantly**, globally, by one
  operator — the response to an employer or board asking us to stop.
- **FR-37** A published contact address on every automated request, and an inbox
  behind it that a human reads.
- **FR-38** Abuse controls run on our own users too: a candidate firing
  applications far beyond human plausibility is rate-limited and reviewed, because
  their behaviour is what gets the whole platform blocked.

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
- **NFR-11 Verification before live traffic.** Every executor change is proved
  against local fixtures before it touches a real destination. Phase 0 ran 565
  fill actions against 60 fixtures with zero failures; that harness is the
  regression gate, not an anecdote.

---

## 8. Legal and compliance — the part most competitors skip

| Constraint | What it means for us |
|---|---|
| **LinkedIn User Agreement §8.2** bans bots and unauthorised automated access; 2025–26 saw ban waves against extensions | LinkedIn is **Tier A only** — assisted autofill in the user's own session, user clicks submit. No LinkedIn bot submission, ever |
| **Indeed / Glassdoor** forbid robots and scrapers | Official partner routes or nothing. No scraping |
| **EU Database Directive** protects listings against substantial extraction | Ingest via APIs and feeds we are permitted to use; no bulk extraction of a board's database |
| **GDPR** — we are a **controller**, often jointly with the candidate | Explicit consent before processing a CV; documented lawful basis; access, erasure and portability implemented as product features, not support tickets |
| **GDPR Art. 9** — CVs can contain health, union, religious data | Never required, never inferred, never used for matching. Flagged and excluded on parse |
| **Third parties in a CV** (referees, managers) | Transparency obligation; we do not process referee data beyond storing the document |
| **EU AI Act** — employer-side hiring AI is high-risk; **candidate-side tools are not restricted by it** | We are candidate-side. Say so plainly; do not market as a hiring-decision system |
| **India DPDP Act / CCPA** | Same rights surface, region-aware retention |
| **Fraud** — knowingly false statements in an application | The honesty principles in §3 are the compliance control. A platform that writes claims for a user manufactures this risk; we architecturally cannot |

### Retention, erasure, and a real conflict inside this document

FR-20 says the bytes of every send are archived and **never overwritten**. FR-25
and FR-26 say a candidate can take their data and erase their account. Both are
correct and they collide, so the resolution belongs here rather than in a bug
report six months from now:

- **Erasure wins.** Deleting an account deletes the archives with it. The archive
  exists to serve the candidate's own memory of what they sent — it is not a
  compliance record we are obliged to keep, and there is no lawful basis for
  keeping a CV after the person withdraws consent.
- **Immutability holds while the account lives.** "Written once" is a rule about
  our code never rewriting history, not a claim that the candidate cannot end it.
- **Retention default: 24 months** from the send, then automatic deletion, with
  the candidate able to shorten it. An application older than two years is
  history, not a live thread.

**Position:** Landfall's default is assisted, not unattended, because the default
destination's terms say so. Volume comes from removing typing, not from removing
the human.

---

## 9. Architecture — static front end, sandboxed executor

```
ingest/          ATS + board adapters; schema probes; live index
profile/         structured facts, variants, résumé files, parse + confidence
plan/            deterministic fill-plan compiler (no browser, no model)
compose/         bullet selection, integrity check, starters (thin LLM edge)
execute/         Tier A extension · Tier B sandboxed browser · Tier C allowlisted
record/          application tracker, sent-bytes archive, hashes, follow-ups
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

### The executor is sandboxed, per session, and disposable

Anything that drives a browser runs in a **one-shot container**: created for a
single application run, destroyed after it, with no shared cookie jar, no shared
profile and no reused browser state between candidates.

| | Tier A — assisted | Tier B — supervised | Tier C — unattended |
|---|---|---|---|
| Runs in | The candidate's own browser, via extension | Sandboxed container, one per run | Sandboxed container, one per run |
| Network identity | Their IP, their session | Regional egress, honest UA, rate-limited | Same, plus allowlist |
| Candidate sees | Their own form, filled | Live view, one confirm before submit | Nothing live; full recording after |
| Credentials | Never leave their machine | Injected per run, never persisted | Injected per run, never persisted |
| Where it is allowed | Everywhere | Where terms permit | Allowlist only — ships empty |

**Why sandboxing is a requirement and not an optimisation:**

1. **Credential containment.** Tier B may hold an ATS login for the length of one
   run. A shared, long-lived browser profile would pool candidates' sessions in
   one process — one bug from a cross-candidate leak.
2. **Hostile-page containment.** We load employer pages we do not control, with
   their scripts. That belongs in a disposable container, not next to the API.
3. **Honest network identity.** One egress per region with an honest User-Agent
   is a fixed, inspectable footprint. A rotating residential proxy pool is what
   an evasion product looks like, and §3 rules it out anyway.
4. **Failure isolation.** A hung Chromium kills its own container and one
   application, not a queue.

**What it costs.** A run is roughly 60–180 seconds of one vCPU and ~1.5 GB. At
commodity container pricing that lands near **half a cent per application** —
compute is not the constraint. The real cost is engineering: runtime form
discovery has to be written and maintained **per ATS**, and that is the v1
budget line that matters, not the hosting bill.

**What stays outside the sandbox:** the plan compiler, matching, tailoring and
the integrity check. They are pure functions over stored facts — no browser, no
network — which is why 63.6% of every form resolves before a container is ever
started, and why most applications never need one at all.

## 10. Success metrics

| Metric | Target at v0 exit |
|---|---|
| Deterministic field coverage (no model, no human) | ≥60% |
| Applications prepared per candidate-hour | ≥12 (vs ~4 manual) |
| Fabricated-claim incidents | **0** — enforced by the integrity check, measured by audit |
| Bot-wall evasion incidents | **0** |
| Assisted-apply completion rate (prepared → submitted) | ≥70% |
| Median time from "found a role" to "submitted" | <4 min |

Deliberately **not** a metric: applications submitted per day. That number is
what produces spam, and every product in §1 optimises for it.

---

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Destination bans automated traffic outright | High | Tier A works within their terms; tiering is per-destination config, not code |
| Workday/SuccessFactors never expose schemas | Certain | Runtime discovery path is v1 scope, budgeted, not a surprise |
| Résumé parsing quality disappoints | Medium | Confidence scores + mandatory correction step; parsing pre-fills, never decides |
| A candidate expects "apply to 1000 jobs while I sleep" | High | Position honestly from the first screen; Tier C is narrow and visibly so |
| Regional board partnerships are slow | Medium | v0 ships Greenhouse-only; regional coverage is a v1 commercial workstream, started now |
| LLM cost creep | Medium | 91.1% of instances need no model; enforce with a budget alarm per application |

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

## 13. Decisions needed before build starts

1. **Business model** — free tier + subscription (LiftmyCV sits at $9.99–$69.99),
   or credit metering charged only on successful submission? This shapes the
   schema and the whole execute path.
2. **Launch region** — India-first (Naukri integration is then v0, not v1) or
   global-English-first (Greenhouse-first as written above)?
3. **Tier C at all?** Shipping unattended submission, even allowlisted, is the
   line between "fast assistant" and "the thing boards ban". Recommendation:
   build the allowlist mechanism in v0, ship it empty, decide with real data.
4. **Résumé parsing** — build on an open parser, or buy an extraction API?
   Buying is faster and puts candidate CVs through a third party, which §8 then
   has to account for.

---

## 14. Technology

**TypeScript on both ends.** Not a preference — the decision is close to forced by
what already exists.

| Layer | Choice | Why this one |
|---|---|---|
| Front end | TypeScript · React · Vite | Static build to a CDN, which §9 commits to. Familiar from guidetrack, so the concepts port |
| API | TypeScript on Node — Fastify or Hono | Phase 0's adapters, schema probes, plan compiler and integrity check are already TypeScript |
| Executor | Node · Playwright, one container per run | Playwright's first-class language is Node, and the 60-fixture harness is already written against it |
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
| Executor containers | **Per region**, pooled, one-shot | Regional egress gives each region one honest, inspectable IP footprint (NFR-1) |
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
