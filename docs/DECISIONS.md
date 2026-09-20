# Decisions log

Append-only. One entry per decision. Status: **Approved** (PM said so), **Working default** (our reading; PM has not objected; change freely), **Open** (needs the client or PM).

The original documents in `Documentation/` (Product Design Document, `sample-creation-information.md`, `CLAUDE.md`) still describe a School + College sample. Where this log disagrees with them, **this log wins** until those documents are rewritten.

---

## 2026-09-20

**D-001 Institution structure.** Approved (PM: "that is the final").
Royal Softech College has only Grade 11 and 12 (+2) and three bachelor's degrees. There is no Nursery to Grade 10 school. Grade 11 and Grade 12 are one year each. Each bachelor's degree is four years.
Supersedes: School (Nursery to 10) + College sections, and the placeholder faculty names, in the original documents.

**D-002 This is the real product, not a throwaway sample.** Approved.
"We will be building the entire website on this." Supersedes `sample-creation-information.md` section 5.2 and `CLAUDE.md` section 2 (sample mode: no backend, fake in-memory data, throwaway code, 2 to 3 day time-box).
A demo is a deployment of the real product loaded with invented data. It shows a "Sample, fake data" banner. It is never a separate code path.

**D-003 All data originates from role screens.** Approved.
"The data should be added by the Co-ordinator as per the design." Nothing is hard-coded into screens. A demo or test data set is loaded by a script that calls the same service functions the screens call, so every rule, permission and audit entry applies to it too. No direct SQL inserts.

**D-004 Co-ordinator and Accountant scope is institution-wide for now.** Approved, with a design constraint.
PM: keep it the same now, design so it can differ later.
Constraint: permissions stay expressed as role + action + scope, and a role assignment carries a scope (whole institution, or one section). Today every Co-ordinator and Accountant is assigned whole-institution scope. Splitting later is a data change, not a code change. Permission tests run under both configurations from the first day. Ranking (Top 20) and receipt numbering stay keyed per section so a later split renumbers nothing.

**D-005 Stack.** Approved (PM: "Stack is B").
Django (modular monolith, PostgreSQL, JSON API with OpenAPI schema) + Next.js (TypeScript) front end with a generated typed client. Two managed deployables behind one domain.
Supersedes `CLAUDE.md` section 4 ("no separate front-end app and no separate API layer in V1"). Everything else in `CLAUDE.md` section 4 stands: no Redis, no microservices, Postgres-backed job queue, private object storage with signed links, one deployment per school.

**D-006 Levels and terms.** Working default. Open with the client.
A programme has an ordered list of levels. +2 programmes: Grade 11, Grade 12. Bachelor's: Year 1 to Year 4. Each level is one academic year, assessed by terminals (yearly, with terminals).
Not modelled: semesters. PM said "4 year" and "1 year each"; whether any bachelor's runs semester-wise inside those four years has not been confirmed. The level and term structure is data, so semesters can be added without a rewrite.

**D-007 Brand assets.** Approved.
The client will supply logo, colours and photos. Until then: a neutral wordmark and a restrained accent. No assets are taken from the client's Facebook page without PM approval.

---

**D-008 This is a school-website product, configured for one school first.** Approved direction (PM).
PM: "a school website product which is modified for one school", like SAP: out of the box, then adjusted through defined enhancement spots. Royal Softech is customer one and the sample for other schools. A new school should take little effort.
Working design (details awaiting PM): variation is handled in order of cost. Configure, then apply a template, then theme, then a code extension at a named extension point, and only last change the core (for everyone). The core never names a school. Portal layout stays identical for every school (original docs), with slots for extra cards, tabs and menu items. Extends, does not replace, the original rule "add a setting only when a second school asks": we cut the seam now where a variation is already visible, and build a settings screen only when a second school needs it.

**D-009 Permanent second-school test.** Working default, awaiting PM.
A fictional "Sample Basic School" (Nursery to Grade 10, percentage grading, monthly fees, different theme) runs every flow in CI beside Royal Softech. This is the original documents' School structure, kept as a template and test fixture. It is also the demo to show other schools, so Royal's data is never shown to prospects.

**D-010 Tenancy and extensions.** Working default, awaiting PM.
Keep one deployment per school (original docs). Do not build multi-tenancy; revisit at about 30 schools. Extensions are written and reviewed by us only, no customer-uploaded code.

---

**D-011 Forget the sample; build the product in phases.** Approved direction (PM).
PM: the client demo is the PM's concern. The build is the reusable product, foundation first, then easy and visible modules for momentum, then difficult and paid parts last, finished as fast as is sound. The Thursday demo-link deadline is dropped. Phase order and estimates are in `build-plan.md`, proposed and awaiting approval. Where a hard piece is a dependency of an early one (permissions, audit, approvals, dates), it is built early in its smallest generic form.

---

**D-012 Build plan, installs and repo approved.** Approved (PM: "all approve").
Phase order in `build-plan.md`, installs of Python (via `uv`) and PostgreSQL 17, and a private GitHub repo. Phase 0 started 2026-09-20.

**D-013 Toolchain and API conventions.** Approved (PM: "approve", 2026-09-20).
Python 3.12 (via `uv`), Django 6.1, Django REST Framework, PostgreSQL 17, Next.js 16, strict TypeScript. Plain CSS with design tokens (no Tailwind), so colours and fonts can only come from tokens. Typed API client generated from the OpenAPI contract (`openapi-typescript`, `openapi-fetch`); CI fails if the contract or generated types are stale. Every API route ends in a slash and `APPEND_SLASH` is off, so a missing slash is a 404 and never a redirect (browsers cache redirects permanently). Requests run in a transaction (`ATOMIC_REQUESTS`); the health check opts out so it can report a database failure as 503. Every view must declare its permissions or it is denied, and a test enforces it. Demo mode is refused when `ENV=production`.

**D-014 BS dates: verify by year, not by library.** Approved (PM: "approve", 2026-09-20). Details in `spikes/bs-dates.md`.
The two candidate libraries agree on every BS year up to 2083 and disagree on every year from 2084, because no official calendar exists that far ahead. Use `nepali-datetime` inside a date module that converts only for verified BS years (currently 2000 to 2083) and refuses the rest. Add each year to the verified list when its official calendar is published and checked. Dates of birth store AD and BS as entered.

**D-015 Job queue: Procrastinate.** Working default. Details in `spikes/job-queue.md`.
Django 6.1 has no production task worker. Procrastinate 3.9 passed retry and duplicate-guard tests on PostgreSQL 17. Wrap it in `core.jobs`. Outbox events are written in the same transaction as the business write, and a job drains them.

**D-016 Login session and CSRF rules.** Working default (proven in a spike). Details in `spikes/session-csrf.md`.
Set `CSRF_TRUSTED_ORIGINS` to the web origin in every environment. Never enable `USE_X_FORWARDED_HOST`. The web client re-reads the `csrftoken` cookie on every request, because login rotates it. Server-side calls must forward the session cookie explicitly.

**D-017 PDF documents: HTML rendered by Chromium.** Working default, partly verified. Details in `spikes/pdf-devanagari.md`.
Devanagari renders correctly on screen; the PDF text layer is unreliable for copy and search, so the database is always the record. Embed a self-hosted Noto Sans Devanagari. Confirm in a real PDF viewer in Phase 6. WeasyPrint is the fallback.

**D-018 Free-first hosting; no native app for now.** Working default, awaiting PM go on the test.
PM: whole-project budget 50K a year (assumed NPR, about US$350), no spend on servers, run free as a starter, talk subscriptions later. Direction: start free. Run a one-day test of an all-Cloudflare build; if it passes, propose replacing the Django backend (this would supersede D-005's backend); if it fails, keep Django on free tiers (Cloudflare Pages and R2, Northflank Sandbox, Neon Singapore). Front end is static export either way. Nightly database copy to R2, because free tiers give little backup. Hosting cost moves into the yearly subscription later. No native Android app now (iOS is about a quarter of Nepal mobile use); the site is installable. Supabase not used. Research, sources and the test plan: `spikes/hosting-options.md`.

---

## Open items carried forward

- **Official BS calendar source.** Need one the client trusts, to check BS 2083 before go-live and to verify each later year. PM or client to supply.

- **Demo link deadline (Thursday 2026-09-24): dropped** by the PM. See D-011.
- **Exact +2 streams.** Sources disagree (see `client-profile.md`). Working list is the CollegeNP list of six.
- **Optional subjects** (docs open point 10, default "not modelled"). +2 Science has Biology / Mathematics / Computer Science options and the BSc has five specialisations, so marks grids must list only the students who take a subject. Recommendation: model a minimal elective group. Needs PM approval because the docs say not to decide open points.
- **NEB ranking tie-break** for the +2 Top 20 (NEB gives subject-wise grades and a GPA, no total, so ties are common). Ask the client.
- **Scholarship discount reason.** The client publishes "up to 50% for Dalit students after verification". Default reason list (Scholarship, Sibling, Staff child, Other) has no matching entry. Suggest adding one. Needs PM approval.
- **Admission documents.** Client's process lists transcripts, character certificate, photographs and citizenship copy. The design has a single certificate upload. Suggest multiple typed documents. Needs PM approval.
- **Release scope.** Superseded by the phased plan in `build-plan.md`; awaiting PM approval of the phase order.
- **Contract and IP with Royal Softech.** As the first customer of a reusable product, the contract must let us reuse the platform for other schools, keep their data and branding out of the core, and say what "yearly subscription" covers. The original docs list this as a pre-pitch item. Settle before building on their project. PM matter.
- **Modules and editions.** Which modules are optional per school (attendance, homework, notes, and so on) and whether they map to subscription tiers. PM matter.
- **Extension-point list v1.** Proposed to PM; awaiting approval.
