# Current Context — Build Session

Living log of session state across context compactions. Purpose: let a fresh
chat pick up the build without re-deriving history. Update this file at each
compaction (or major milestone) rather than relying on memory.

Backend Phase 2 is fully shipped (see below). Work has since moved to the
frontend, built slice-by-slice through the same brainstorm → spec → plan →
execute cycle (see "How we work"). See "Frontend slices" further down for
that workstream's state.

---

## Where we are — Backend (Phase 2, complete)

**Phase 2 items shipped and merged to `main` (local only, not pushed):**

1. Analytics (completed prior session, before this doc existed)
2. File Repository — `backend/src/files/`
3. Meeting Minutes — `backend/src/minutes/`
4. Asset Management — `backend/src/assets/`
5. Public Club Page — `backend/src/gallery/`, `backend/src/achievements/`, `backend/src/public/`
6. Email Notifications — `backend/src/notifications/`
7. Certificate Generator — `backend/src/certificates/generation/`
8. Branding & Themes — `backend/src/organizations/` (+`bannerKey`/`secondaryColor` on `Organization`)
9. Event Feedback + NPS — `backend/src/feedback/` (+`FeedbackResponse` model,
   `Event.requireFeedbackForCertificate`, cert-gating in
   `CertificateGenerationService`/`EventsService.complete()`, two new
   analytics endpoints)
10. Committee Handover Pack — `backend/src/handover/` (on-demand PDF export,
    no new model/column — direct cross-cutting Prisma reads across
    Membership/MeetingMinutes/Asset/OrgFile/Event, `AnalyticsService`-style)
11. Consent-versioned re-prompt — `JwtAuthGuard` hard-blocks (403) any
    authenticated request when the caller's account `ConsentRecord` doesn't
    match `CURRENT_POLICY_VERSION`; `@SkipConsentCheck()` exempts
    `PdpaController` wholesale; new `POST /me/consent` cures staleness; `login`/
    `refresh` responses carry `consentStale`. No new model/column.

**Remaining Phase 2 roadmap items:** none. All 11 items on `docs/roadmap.md`
are shipped and merged to `main`.

`main` is 42 commits ahead of `origin` (verified via `git rev-list --count origin/main..main`). No push has happened or
been requested — per standing preference, "finish branch" means merge to
main locally and delete the feature branch, nothing more.

---

## How we work (the repeating cycle)

Each Phase 2 item goes through this exact cycle, one item at a time (user's
explicit preference — asked once whether to plan all items up front vs.
one-by-one; chose one-by-one):

1. **Brainstorm** (`superpowers:brainstorming`) — clarifying questions one at
   a time → 2-3 approaches with a recommendation → design presented in
   sections (Architecture, Data model, Endpoints, RBAC+audit+testing) with
   approval requested after each section.
2. **Write spec** → `docs/superpowers/specs/YYYY-MM-DD-<feature>-design.md`,
   commit, self-review (placeholder scan, internal consistency, scope,
   ambiguity — fix inline), then user reviews the committed file.
3. **Write plan** (`superpowers:writing-plans`) → `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`,
   self-review (spec coverage, placeholder scan, type consistency), commit.
   User is then asked to choose execution mode — **this session, the answer
   is always "2" (inline execution)**, never subagent-driven.
4. **Execute** (`superpowers:executing-plans`, inline, on a new feature
   branch) — after the plan is committed and the branch created, **pause and
   wait for explicit go-ahead** before starting Task 1 (added as a standing
   preference during Event Feedback + NPS). Then TDD per task: failing test
   → verify red → implement → verify green → run full unit+e2e suite →
   commit. One commit per task.
5. **Pause before docs sync** — standing user preference. After all
   implementation tasks pass, stop before the docs-sync steps (updating
   `docs/database.md` / `docs/security.md`) and wait for "continue"/"resume".
6. **Docs sync** — append an entity section to `docs/database.md` and an
   "As built — `<feature>` (shipped)" section to `docs/security.md`, commit.
7. **Finish branch** (`superpowers:finishing-a-development-branch`) — verify
   tests, then **always merge to main locally and delete the branch** — user
   gave this as a standing answer once ("always merge to main, and then
   commit for the end of all task"), so this step no longer needs asking.

Approvals during section-by-section design review come back tersely: "ok",
"good", "continue" — these all mean "approved, proceed to the next section
or step," consistent with the whole session.

---

## Architecture patterns established (apply to future features too)

- **Tenant isolation**: every tenant-owned Prisma model gets `organizationId`
  and must be added to `TENANT_SCOPED_MODELS` in
  `backend/src/prisma/tenant-scope.middleware.ts` (throws if a scoped query
  lacks an org filter). Current list: `Membership, AuditLog, Event,
  Registration, Attendance, Certificate, OrgFile, MeetingMinutes, Asset,
  GalleryPhoto, Achievement`.
- **RBAC**: `@Roles()` + `RolesGuard`, role groups from `role-groups.ts`
  (`MANAGE_EVENTS`, `MANAGE_MEMBERS`, etc). Pattern used across all four
  features: committee-tier writes, any-ACTIVE-member reads.
- **Audit**: every mutation calls `AuditService.record({ organizationId,
  actorUserId, action, targetType, targetId, metadata }, tx?)` with a
  dot-namespaced action name (`file.upload`, `minutes.create`, `asset.update`,
  `gallery.delete`, `achievement.create`, ...). Reads are never audited.
- **Storage**: `StorageService.putObject/getSignedDownloadUrl(key, ttl)/deleteObject`
  against one private MinIO/S3 bucket. Storage quota = running sum across
  `Certificate.fileSizeBytes + OrgFile.fileSizeBytes + GalleryPhoto.fileSizeBytes`
  (extend this sum if a future feature adds another stored-file model).
- **DTO validation**: `class-validator`/`class-transformer` — `@IsEnum`,
  `@ValidateIf` for optional-but-validated PATCH fields, `@ValidateNested`+`@Type()`
  for nested object arrays (precedent: `registrations/dto/upsert-registration-form.dto.ts`).
- **Public (unauthenticated) routes**: `PublicModule` at
  `/public/organizations/:orgId/*` is the *only* route surface with zero
  guards (no `JwtAuthGuard`/`TenantGuard`/`RolesGuard`). Each service method
  does its own `organization.findUnique` existence check (404 if missing)
  since there's no `TenantGuard` populating `req.organizationId`. Reconciles
  CLAUDE.md's "files are private" rule with a public feature: storage stays
  private (signed URLs only, same bucket), only the *route* has no auth.
  Public-facing list endpoints that render "all at once" (e.g. a photo grid)
  embed signed URLs directly in the list response, unlike internal
  metadata-only lists (File Repository) that require a separate per-item
  download call — the distinction is render-all vs. browse-then-fetch-one.
- **Pagination**: use when a collection is an unbounded archive (Meeting
  Minutes — page/pageSize, default 25/max 100, sorted `meetingDate desc`,
  mirrors `AuditService.list`). Skip pagination when the collection is
  inherently bounded (Asset Management inventory — unpaginated, sorted
  `name asc`).
- **Async work (new with Email Notifications)**: BullMQ queue (`notifications`)
  against the `redis` container, `@nestjs/bullmq`. `NotificationsService`
  exposes `enqueue*`/`scheduleEventReminder`/`cancelEventReminder`, called
  *after* the triggering `$transaction` commits (never inside `tx` — a queue
  push isn't part of the DB transaction). `NotificationsProcessor` extends
  `WorkerHost`, one `process(job)` method switching on `job.name` — BullMQ's
  `@nestjs/bullmq` has no per-kind `@Process(kind)` decorator (that's the
  older `@nestjs/bull` API). **BullMQ custom job ids reject `:`** — use `-`
  as the separator (`reminder-<eventId>`, not `reminder:<eventId>`).
  `PrismaService` now implements `OnModuleDestroy` (`$disconnect()`) —
  without it every e2e suite leaked its Prisma connection pool until the
  jest worker process exited, and BullMQ's worker pushed pool growth past
  Postgres `max_connections` across the full parallel suite; `DATABASE_URL`
  now carries `&connection_limit=5`. Actor-less audit rows (e.g.
  `notification.email`) are excluded from the Basic Dashboard's capped
  `activityFeed` (they'd crowd out actor activity) but remain queryable via
  `GET /organizations/:orgId/audit-logs`.
- **Dev-only email catcher**: `mailpit` added to `docker-compose.yml` (SMTP
  `:1025`, web UI `:8025`) — `nodemailer` in `MailerService` points at it via
  `MAIL_HOST`/`MAIL_PORT` env vars (defaulted in `env.validation.ts`).
- **A second BullMQ queue is normal, not a code smell** (Certificate
  Generator): `certificates` queue alongside `notifications`, both on the
  same Redis connection registered once in `AppModule` — each feature
  registers its own `BullModule.registerQueue({ name })` in its own module.
  `CertificateGenerationService`/`Processor` live in a `generation/`
  subfolder of the existing feature module (`certificates/generation/`),
  not a new top-level module — mirrors "extend the module that owns the
  underlying resource" rather than always spinning up a new module per
  queue.
- **PDF generation**: `pdf-lib` (pure JS, no native/browser deps) for
  programmatic single-page PDFs — `CertificatePdfService.render(data)` is a
  plain injectable with zero Prisma/Storage dependencies, kept that way on
  purpose so it's testable via `PDFDocument.load(buffer)` round-trips alone.
  Image embedding (`embedPng`/`embedJpg`) can throw on malformed bytes —
  always wrap in try/catch and degrade gracefully (skip the image) rather
  than fail the whole render.
- **Fan-out-at-enqueue for batch background work**: when one trigger needs
  to process N independent items (e.g. one certificate per `PRESENT`
  attendee), enqueue N separate jobs at the producer, not one big job that
  loops internally — mirrors Email Notifications' `registration.new`
  fan-out. Keeps each item's retry independent (one bad render doesn't
  block the rest) and keeps worker methods simple (one item per `process()`
  call).
- **Race-guard re-checks in processors**: any background job whose
  eligibility could change between enqueue and execution (e.g. a manual
  action creating the same row the job is about to create) should
  re-verify its precondition as the first thing `process()` does, and
  return silently (no error, no audit row) if it's no longer applicable.
  Cheaper and more robust than trying to prevent the race at enqueue time.
- **Quota/limit checks inside a background job**: log and skip (no throw,
  no audit row) rather than throw — there's no HTTP response to throw into,
  and BullMQ's retry-with-backoff won't help if the condition (e.g. a
  storage quota) won't change on its own between retries.
- **Single-slot file fields vs. accumulating collections** (Branding &
  Themes): not every uploaded file belongs in the shared storage-quota
  aggregate. `Organization.logoKey`/`bannerKey` are overwritable slots (one
  per org, old object deleted on replace) rather than a growing collection
  like `Certificate`/`OrgFile`/`GalleryPhoto` — a flat per-upload size cap
  is enough, and the shared `SUM(fileSizeBytes)` quota logic in
  `files.service.ts`/`certificates.service.ts`/`gallery.service.ts` was
  deliberately left untouched rather than extended. Deterministic key
  includes the extension (`branding/<orgId>/<kind>.<ext>`), so a
  format-changing re-upload writes the new object *before* deleting the
  old one (never the reverse — a failed upload must never leave the org
  logo-less). Delete is idempotent (no-op, no audit row, if already unset).
- **Per-event opt-in flags that change a downstream background job's
  eligibility** (Event Feedback + NPS): `Event.requireFeedbackForCertificate`
  is a plain boolean added to the existing `UpdateEventDto`/edit-lock — no
  new endpoint. The consuming service (`CertificateGenerationService`)
  grows an `opts` parameter (`{ onlyWithFeedback? }`) on its existing batch
  method rather than a parallel gated method, and the triggering call site
  (`EventsService.complete()`) branches once on the flag. A delayed BullMQ
  "give up waiting" fallback job (same queue, hyphen-separated custom job
  id per the `reminderJobId` precedent) re-runs the *ungated* version of the
  same batch method — since that method already skips existing rows, the
  fallback and the immediate-unlock re-check (fired from the submitting
  service on every write) are both just idempotent re-calls, not new code
  paths.
- **A service resolving raw storage keys to signed URLs belongs on the
  *read* path, not duplicated per caller**: `OrganizationsService.findOne()`
  now resolves `logoKey`/`bannerKey` → `logoUrl`/`bannerUrl` itself (never
  returns raw keys), so every caller (authenticated dashboard, and
  `public.service.ts` which follows the same resolve-before-return shape)
  gets a consistent, already-safe response — this was a pre-existing gap
  (`findOne()` returned raw keys) fixed as part of this feature, not a new
  pattern invented from nothing (public.service.ts already did this).
- **Cross-cutting reads over already-shipped data belong to the**
  **`AnalyticsService` pattern, not a mutation-triggering cross-module**
  **import** (Committee Handover Pack): when a feature only *reads* several
  other features' models to build a report, query them directly via the
  (global) `PrismaService` inside the new service — don't import
  `MembershipsModule`/`MinutesModule`/`AssetsModule`/`FilesModule`/`EventsModule`
  just to call their existing `list()` methods. Reserve cross-module service
  injection (like Feedback → `CertificateGenerationService`) for when the
  call actually *triggers a mutation* in the other feature.
- **On-demand generated files that are never stored** (Committee Handover
  Pack) use Nest's `StreamableFile` + `@Header()` decorators on the
  controller method, not the signed-URL-from-storage shape every other
  file-serving endpoint in this app uses (`Certificate`/`OrgFile`/`GalleryPhoto`
  all persist first, then sign a MinIO URL). No new pattern needed for
  storage/quota since nothing is written to MinIO at all.
- **pdf-lib cannot extract rendered text back out of a PDF** — every PDF
  test in this codebase (`certificate-pdf.service.spec.ts`,
  `handover-pdf.service.spec.ts`) verifies structure only (`getPageCount()`),
  never rendered content. When a future feature needs to assert *what* got
  rendered (not just that rendering succeeded), verify at the data-gathering
  service layer with mocked Prisma (assert the exact object passed to
  `render()`), not by parsing the PDF bytes in an e2e test.
- **A cross-cutting export of multiple people's data is the one exception**
  **to "reads are never audited"** (Committee Handover Pack's
  `handover.generate`, alongside Event Feedback + NPS's still-read-only
  `/summary` and analytics endpoints staying unaudited) — the line drawn
  this session: audit when a single request surfaces *other people's* data
  in bulk (a roster, an inventory, a file manifest) as a report; don't audit
  reads that only ever return the requester's own view or an aggregate with
  no underlying rows attributable to a person.
- **A global auth-guard override is the right enforcement point for a**
  **cross-cutting per-request check that has nothing to do with RBAC**
  (Consent-versioned re-prompt): `JwtAuthGuard` (already applied everywhere)
  grew an overridden `canActivate()` rather than adding a check to every
  controller or registering a new `APP_GUARD` — a fresh global guard would
  run *before* Passport populates `req.user`, so it couldn't reach
  `req.user.userId`. Skippability reused the existing `Reflector` +
  `SetMetadata` pattern `RolesGuard`/`@Roles()` already established, applied
  at the class level on `PdpaController` so a blocked user is never fully
  locked out of viewing/exporting/deleting their own account. The shared
  staleness helper (`isAccountConsentStale`) is called from two unrelated
  places (`JwtAuthGuard`, `AuthService.issueTokens()`) — a plain exported
  function, not a service, since neither caller needed DI beyond `PrismaService`
  it already had access to.

---

## Working style / standing preferences (don't re-ask these)

- One-by-one feature planning, not all-at-once.
- Inline execution (not subagent-driven) — chosen every time this session.
- Pause before executing Task 1 every time, right after the plan is
  committed and branch created; resume on "continue"/"resume".
- Pause before docs-sync steps every time; resume on "continue"/"resume".
- Finish-branch: always merge to main locally, delete branch, never push,
  never ask — this is now default behavior.
- Every spec and every plan gets a genuine self-review pass before being
  handed to the user — this caught real bugs in 4 of 5 reviews this session
  (not pro forma).
- Verify the current e2e baseline with an actual test run before writing any
  plan's task-numbering/test-count arithmetic (a past arithmetic mistake
  during the Analytics phase is why this rule exists).
- **Operational gotcha, not a preference:** the `docker compose` stack
  (postgres/minio/redis/mailpit) has stopped between a plan pause and
  resume more than once this session (nothing in this repo restarts it —
  likely the host machine sleeping/restarting). Symptom: e2e failures with
  `PrismaClientInitializationError`/`AWS SDK error wrapper` at
  `onModuleInit`. Fix is always `docker compose up -d` before re-running
  tests after resuming from a pause, not a code bug.

---

## Test baseline (as of Consent-versioned re-prompt merge, commit `1cc32db`)

- Unit tests: 101/101 passing
- E2E tests: 326/326 passing (5 new, added by this feature — `pdpa.e2e-spec.ts`
  grew a `consent-versioned re-prompt` describe block; no new spec file)

A second-mid-session-flake pattern was noted twice earlier (Event Feedback +
NPS, Committee Handover Pack) — `pdpa`/`certificates-list-download` timing out
on a back-to-back full run under load, clean in isolation and on the next
full run. Not seen again during this feature's execution. Still read as
resource contention, not a regression.

Re-verify with `npm test` / `npm run test:e2e` in `backend/` before trusting
these numbers if significant time has passed.

---

## Where we are — Frontend (slices, in progress)

Backend Phase 2 finished with zero frontend work done — `frontend/` didn't
exist. The user chose to build the frontend next (not Phase 3 backend items),
explicitly ruled out generic AI-SaaS-template look ("not typical dark
design... more colourful but calm, not distracting"), and asked for the
`ui-ux-pro-max` skill + Google Stitch MCP + 21st.dev MCP to inform the design.

**Design system:** `design.md` was fully rewritten (see git history) to
"Warm Editorial Neutral" — warm neutral canvas (never cold slate/zinc, never
pure black), color enters only through org branding + seven per-domain hues
(icons/tags only, never backgrounds) + semantic status. Palette/typography
were derived from `ui-ux-pro-max` domain searches (style/color/typography/
google-fonts), not invented from scratch. Full rationale and rejected
alternatives (Linear-style cinema-dark, generic Blue-600+Zinc SaaS look) are
in `docs/superpowers/specs/2026-07-17-frontend-design-system-design.md`.

**MCP servers added this session:**
- **Stitch** (`claude mcp add stitch --transport http https://stitch.googleapis.com/mcp --header "X-Goog-Api-Key: <key>" -s user`)
  — user-scoped. `claude mcp list`'s health check shows "tools fetch failed"
  for it but this is a false negative — actual `mcp__stitch__*` calls work
  fine (verified: `list_projects`, `list_screens` both succeeded).
- **21st.dev** (`claude mcp add --transport http 21st https://21st.dev/api/mcp --header "x-api-key: <key>"`)
  — project-scoped, connects clean.
- Both required a full Claude Code restart after `claude mcp add` before
  their tools became callable in-session — expected, not a bug.

**Stitch usage (as design reference only, not copy-paste source):** found a
pre-existing Stitch project "Design Project Framework"
(`projects/4830595420065198851`) that was an earlier, unrelated attempt at
this same platform using the generic Blue-600/Zinc-900/Geist look — left
untouched per user instruction ("i made that one myself"). The user then
built their own Stitch project named "University Club Management"
(`projects/6028687154741083710`) using our `design.md` as the uploaded
DESIGN.md reference, with screens for Admin Dashboard, Event Management,
Member Directory, Analytics Dashboard, QR Scanner, Check-in Successful,
Public Club Page. These were reviewed (screenshots downloaded and read, not
just metadata) and used to extract *layout ideas* — sidebar composition,
member-directory 3-panel pattern, KPI card treatment, QR viewfinder — never
copied as HTML/CSS, since the Stitch screens were explicitly incomplete (e.g.
Analytics Dashboard had an empty body) and contained scope the platform
doesn't have (a "Revenue YTD" KPI — payments are Phase 3, not built).

**Slicing decision:** user picked "Foundation slice first" (not admin-only,
not all-screens-thin) — build tokens+shell+auth+org-context+dashboard fully
before touching any other feature area. Same one-at-a-time discipline as the
Phase 2 backend items.

### Frontend Slice 1 — Foundation (shipped, `feature/frontend-slice1-foundation`)

Spec: `docs/superpowers/specs/2026-07-18-frontend-slice1-foundation-design.md`.
Plan: `docs/superpowers/plans/2026-07-18-frontend-slice1-foundation.md`.
Full architecture as built: `docs/uiux.md`.

6 tasks, one commit each: scaffold+tokens+dark-mode (`5d27a77`), API
client+auth store+single-flight refresh (`6bc2264`), auth pages+consent
gate+backend CORS (`4c23745`), org context+branding+contrast fallback
(`1f36568`), app shell (`4fb21d1`), dashboard (`590e0ee`).

**Notable implementation snags (all resolved, documented so they aren't
re-discovered):**
- `npx shadcn@latest init -d -f` added `shadcn` itself to *runtime*
  `dependencies` (not dev), which drags in Babel packages with peer-version
  pins that immediately ERESOLVE-conflict with Next 16's own Babel deps.
  Fix: `npm uninstall shadcn` then reinstall as `-D` with `legacy-peer-deps=true`
  in `.npmrc`. The CSS import `@import "shadcn/tailwind.css"` in
  `globals.css` is real and needed (629 lines of custom variants the
  generated components depend on) — don't try to inline/vendor it.
- This shadcn generation uses `@base-ui/react` primitives, not Radix —
  `SheetTrigger`/etc. don't take `asChild`, they take `render={<Element/>}`
  or accept `className`/`aria-*` directly like a native element.
- Next 16 + Turbopack: a leftover dev server process on port 3000 doesn't
  die cleanly and causes the *new* dev server to 500 on RSC requests
  ("Jest worker encountered 2 child process exceptions") — symptom looked
  like an app bug but was `taskkill /PID <old> /F` territory.
- `@testing-library/react` needs `@testing-library/dom` as an explicit
  peer — scaffolded test setup didn't pull it in automatically.
- Zod's `.literal(true, message)` is the v4 way to require a checkbox
  consent field with a custom error message (not `.refine()`).

**Test baseline:** frontend 28/28 (Vitest+RTL) — token-level logic only
(auth store, API client refresh/consent branches, contrast math, org-slug
resolution, audit-action formatting), no snapshot tests, Playwright e2e
explicitly deferred (spec decision) until a real multi-page flow exists.
Backend suites re-verified green after the one-line CORS change: 101 unit /
326 e2e — unchanged from the Phase 2 baseline.

**What's real after Slice 1:** scaffold, full token system (light+dark),
auth flow incl. consent re-prompt, org switcher/create-org/branding, app
shell (sidebar with domain-hue nav + topbar + mobile drawer), dashboard
(role-branching: committee gets real KPIs/widgets, everyone else gets a
participant landing).

**Placeholder routes (nav item exists, page doesn't):** Members,
Attendance, Certificates, Feedback, Analytics, Workspace, Settings — each
render `PlaceholderPage` (domain-hue icon + "Coming in a later slice") —
honest, not a fake empty state. (Events graduated out of this list in
Slice 2, below.)

### Frontend Slice 2 — Events (shipped, `feature/frontend-slice2-events`)

Spec: `docs/superpowers/specs/2026-07-18-frontend-slice2-events-design.md`.
Plan: `docs/superpowers/plans/2026-07-18-frontend-slice2-events.md`.
Full architecture as built: `docs/uiux.md` (Slice 2 section).

**Scoping decision:** offered "Events + Registrations combined" vs "Events
only" — user picked Events only (registration form builder + self-
registration + approve/reject carved out to Slice 3, since the dynamic form
builder alone is real scope, ~8-9 tasks combined vs ~5 split).

5 tasks, one commit each: data layer — status helpers/schema/role
tiers/query hooks (`9ef8fe7`), list — search/filter/upcoming-past
(`9718cb1`), detail — lifecycle actions/404 handling (`5c59174`),
create/edit form (`974310d`); Task 5 (live verification) found zero bugs,
so no commit — verified the full create→publish→edit→complete→cancel→delete
cycle, DRAFT-404 as a second (participant) account with zero data leak, both
themes, against the real dev backend.

**Two things caught during the spec's self-review, before any code was
written** (documented so they aren't re-discovered): (1) cancel/delete are
gated `MANAGE_MEMBERS` on the backend, one tier stricter than the
`MANAGE_EVENTS` tier every other event action uses — a naive "committee can
do everything" frontend would have shipped a Cancel/Delete button that 403s
on click for COMMITTEE-role users; (2) a status filter option that can never
match anything (Draft, for a non-committee viewer) is confusing UI, not
transparency — omitted entirely for them rather than always-empty.

**Test baseline:** frontend 40/40 (12 new — role-tier truth table,
event-status-transition truth table mirroring `EventsService` exactly,
date-range/capacity schema edge cases). Backend untouched, baseline
unchanged: 101 unit / 326 e2e.

**What's real after Slice 2:** everything from Slice 1, plus full Events
CRUD + lifecycle (create, edit while non-terminal, publish, complete,
cancel with confirm, delete with confirm), role-gated per the two-tier
split, DRAFT visibility handled correctly end-to-end.

**Placeholder routes remaining (before Slice 3):** Members, Attendance,
Certificates, Feedback, Analytics, Workspace, Settings.

### Frontend Slice 3 — Registrations (shipped, `feature/frontend-slice3-registrations`)

Spec: `docs/superpowers/specs/2026-07-18-frontend-slice3-registrations-design.md`.
Plan: `docs/superpowers/plans/2026-07-18-frontend-slice3-registrations.md`.
Full architecture as built: `docs/uiux.md` (Slice 3 section).

**Scope:** the piece carved out of Slice 2 — committee-defined registration
forms, self-registration (register/status/cancel), committee registration
management (list + reject). No manual "approve" exists anywhere in this UI:
approval/waitlisting is capacity-driven and automatic, waitlist promotion is
automatic on cancel/reject — verified against the actual
`RegistrationsController`/`RegistrationFormController` source during
brainstorming before any code was written.

8 code tasks, one commit each: data layer (`cb8f366`), answer-schema
builder (`3eee4f4`), answers-formatting helper (`2a42276`), status badge +
register dialog (`f5f5f57`), self-registration panel (`9e03b0c`), form
builder editor (`4ad70d8`), committee registrations table (`6f879fd`),
event-detail tab wiring (`9454cdf`); Task 9 (live verification) found and
fixed one real bug (`4f1fcc6`).

**The bug, worth remembering for any future feature with dynamic
form-driven answers:** `RegistrationsService.validateAnswers` reads
`answers[field.id]`, not `answers[field.label]` — confirmed by reading the
backend source during brainstorming, but the first implementation of
`buildAnswerSchema`/`RegisterDialog`/`formatAnswers` still keyed everything
by label. Unit tests passed (fixtures matched the same wrong assumption)
and the build was clean — only driving the real dialog against the real
running backend surfaced `400 Missing required field: Name` on a filled-in
field. Fixed by threading a `SavedFormField` type (`FormField & { id:
string }`) through the register path; the form-builder editor was
unaffected (full-replace PUT has no ids to get wrong — the backend assigns
fresh ones on every save).

**Other implementation notes:** no new shadcn components added (Tabs,
Select, Checkbox) — event-detail tabs are a local-state segmented-button
row, SELECT/CHECKBOX are plain native elements, following the precedent the
events list already set for its status filter; CHECKBOX values are
validated as native-checkbox booleans and converted to the backend's
`'true'/'false'` strings only at submit time (react-hook-form's `register()`
yields `checked: boolean` for a bare checkbox input, not a string).

**Test baseline:** frontend 54/54 (14 new — `buildAnswerSchema` per-type
validation including the id-vs-label case, form-editor schema validation,
`formatAnswers` id-to-label mapping with stale-key fallback). Backend
untouched, baseline unchanged: 101 unit / 326 e2e.

**What's real after Slice 3:** everything from Slices 1–2, plus full
Registrations — committee builds a custom form (TEXT/TEXTAREA/SELECT/
CHECKBOX, reorderable, required flags, SELECT options), participants
register through it with live validation, capacity/waitlist and
auto-promotion on cancel/reject all correctly reflected in the UI, committee
reviews registrations with a status filter and rejects individually.

**Placeholder routes remaining (before Slice 4):** Members, Attendance,
Certificates, Feedback, Analytics, Workspace, Settings.

### Frontend Slice 4 — Members (shipped, `feature/frontend-slice4-members`)

Spec: `docs/superpowers/specs/2026-07-18-frontend-slice4-members-design.md`.
Plan: `docs/superpowers/plans/2026-07-18-frontend-slice4-members.md`.
Full architecture as built: `docs/uiux.md` (Slice 4 section).

**Scope:** full CRUD against `MembershipsController` — list (search +
server-side role/status filter), add member, detail (profile + committee
history), edit profile/status, change role, remove. No new backend
endpoints.

7 code tasks, one commit each: data layer + two type fixes (`996448a`),
add/edit schemas (`1a37b8f`), badges + not-found (`51504d0`), list
(`d6c5029`), add page (`b6d986f`), detail + change-role dialog + remove
(`6c9e373`), edit page (`5396840`); Task 8 (live verification) found zero
bugs — the only fixes this slice were caught earlier, during
brainstorming/design, not live.

**Two real type bugs, caught before any UI code, not live:** `types/api.ts`'s
`MembershipRole` carried a stray `'ALUMNI'` (backend has 9 roles, none of
them ALUMNI — that's a status, not a role) and `MyMembership.status`
carried a stray `'INACTIVE'` (backend status is `ACTIVE | ALUMNI` only).
Both had shipped silently since Slice 1 — nothing had ever exercised the
wrong branch. Found by cross-checking `types/api.ts` against the Prisma
schema directly during this slice's brainstorming, before writing the data
layer.

**Architecture constraint:** no `GET /members/:id` exists — the detail and
edit pages both find their target row inside the already-fetched
(unfiltered) member list rather than a dedicated single-fetch hook.

**Three-tier RBAC** (a first for this frontend — Slices 2–3 only ever
needed two): `canManageRoles` (President/VP only) is new, gating role
change and remove one tier stricter than `canManageMembers` (add/edit).

**Test baseline:** frontend 64/64 (10 new — `canManageRoles` truth table,
add/edit-member schema validation). Backend untouched, baseline unchanged:
101 unit / 326 e2e.

**What's real after Slice 4:** everything from Slices 1–3, plus full member
management — add by email (existing accounts only, no user-creation flow),
list/filter/search, profile + status editing, role changes with a confirm
step, removal, and the last-active-president guardrail correctly surfaced
in all three places it can fire (status→ALUMNI, role change, remove).

**Placeholder routes remaining (before Slice 5):** Attendance, Certificates,
Feedback, Analytics, Workspace, Settings.

### Frontend Slice 5 — Attendance / QR Check-in (shipped, `feature/frontend-slice5-attendance`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice5-attendance-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice5-attendance.md`.
Full architecture as built: `docs/uiux.md` (Slice 5 section).

**Scope:** full attendance feature — participant's own QR check-in code
(extends Slice 3's `MyRegistrationPanel`), committee/volunteer camera-based
scanner (native `BarcodeDetector`, feature-detected, manual-entry
fallback), checked-in roster with client-side name resolution, mark-absent.
No new backend endpoints — verified against the live
`AttendanceController`/`AttendanceService` during brainstorming.

7 code tasks, one commit each: data layer + `MANAGE_ATTENDANCE` tier
(`5840b6f`), name-resolution helper (`e834566`), status badge (`4ba5648`),
QR display + first new runtime dependency `qrcode` (`66da81a`), scanner
(`21c2c34`), roster + mark-absent (`dc60473`), page wiring (`3501f90`);
Task 8 (live verification) found zero bugs.

**First frontend feature giving `VOLUNTEER` any capability:** every prior
role-tier excluded VOLUNTEER; `canManageAttendance` mirrors the backend's
`MANAGE_ATTENDANCE` group exactly (`MANAGE_EVENTS` tier + VOLUNTEER).

**Client-side name resolution, same pattern as Slice 3:** neither
`GET /attendance` nor `GET /registrations` joins a participant's name —
`resolveParticipantName` chains `Attendance.registrationId` →
`Registration.userId` → `Member.user.fullName` over two already-fetched
lists, falling back to a raw id on a lookup miss rather than crashing.

**Test baseline:** frontend 68/68 (4 new — `canManageAttendance` truth
table, `resolveParticipantName`'s three cases). Live verification: full
register→approve→QR-display→scan→409-on-resubmit→mark-absent cycle driven
against the real dev backend (manual-entry fallback exercises the same
`useScanAttendance` mutation the camera path would — camera scanning isn't
drivable under headless Playwright), non-eligible PARTICIPANT correctly
sees an explainer at `/attendance`, both themes screenshotted with no
domain-hue leakage onto status badges. Backend baseline unchanged: 101 unit
/ 326 e2e (zero backend files touched).

**What's real after Slice 5:** everything from Slices 1–4, plus full
Attendance — participant QR display, committee/volunteer scan (camera +
manual fallback), checked-in roster with real names, mark-absent.

**Placeholder routes remaining (before Slice 6):** Certificates, Feedback,
Analytics, Workspace, Settings.

### Frontend Slice 6 — Certificates (shipped, `feature/frontend-slice6-certificates`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice6-certificates-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice6-certificates.md`.
Full architecture as built: `docs/uiux.md` (Slice 6 section).

**Scope:** full certificates feature — participant's own certificate
download (extends the event detail page), committee per-event management
(list, manual upload as an admin fallback, remove). Generation is fully
automatic on `EventsService.complete()`; this slice only builds the
viewing/managing surface, no new backend endpoints.

5 code tasks, one commit each: data layer + `apiUpload` — this frontend's
first multipart upload (`dc53550`), name resolution (`8ee2035`),
participant download panel (`5b4b9ef`), committee manager — list/upload/
remove (`f610e87`), page wiring (`b0ef5d0`); Task 6 (live verification)
found and fixed **two** real bugs — a first for this project (every prior
slice's live-verification task found either zero or one).

**Bug 1 (frontend):** the "Download certificate" anchor stretched
full-width — a bare `buttonVariants` link as a direct child of a
`flex-col` parent inherits `align-items: stretch` by default. Fixed by
adding `w-fit` (`47c5abe`).

**Bug 2 (backend, genuine pre-existing defect, not introduced this
slice):** removing a certificate that had ever been downloaded — including
via the owner's own `GET /me` call, which every participant's certificate
view triggers — 500'd. `CertificateDownload.certificateId` is a required
FK defaulting to Prisma's `Restrict` delete behavior, and the existing
e2e suite (`certificates-delete.e2e-spec.ts`) never called `GET /me`
before deleting, so the path was never exercised until live-driving the
real flow end-to-end hit it. Fixed in `certificates.service.ts#remove()`
by clearing `CertificateDownload` rows in the same transaction before the
delete, plus a new e2e regression case (`029dc94`). This is the one
exception to this slice's "backend untouched" planning assumption — a real
bug found mid-slice overrides a scoping constraint written before the bug
was known.

**Test baseline:** frontend 76/76 (5 new — `apiUpload`'s three behavioral
cases, `resolveMemberName`'s two cases, `validateCertificateFile`'s three
cases). Live verification: full
complete→auto-generate→download→list→remove→(hit bug)→fix→remove→
re-upload cycle driven against the real dev backend, eligible-attendee
filtering confirmed both directions, non-committee explainer confirmed,
both themes screenshotted with no domain-hue leakage. Backend: 101 unit /
327 e2e (326 baseline + 1 new regression case).

**What's real after Slice 6:** everything from Slices 1–5, plus full
Certificates — participant download, committee list/upload/remove,
correctly filtered eligible-attendee picker.

**Placeholder routes remaining:** Feedback, Analytics, Workspace, Settings.

### Frontend Slice 7 — Feedback (shipped, `feature/frontend-slice7-feedback`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice7-feedback-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice7-feedback.md`.
Full architecture as built: `docs/uiux.md` (Slice 7 section).

**Scope:** full frontend surface for the backend's already-shipped Event
Feedback + NPS feature (Phase 2) — participant feedback submission
(event-detail panel, extending Slices 3/5/6's pattern), committee aggregate
summary (`/feedback` nav page + event picker, mirroring
Certificates/Attendance), and the `requireFeedbackForCertificate` gate
toggle added to the event create/edit form — a backend field that had
existed since Phase 2 with zero frontend control until this slice. No new
backend endpoints.

7 code tasks, one commit each: types + window helper (`cfeb839`), feedback
Zod schema (`94d07af`), panel-state resolver (`4b5f259`), RatingScale
(`a302f38`), hooks + participant panel wired into event detail
(`9c516fe`), committee summary page + event picker (`2d22f65`),
`requireFeedbackForCertificate` toggle on the event form (`6a8430a`); Task
8 (live verification) found zero bugs in this slice's own surface — no
commit.

**Two small implementation snags, both fixed within their tasks (not
separate commits):** (1) `vitest.setup.ts` never registered
testing-library's `afterEach` cleanup (no vitest `globals: true`) — a
latent gap invisible until `RatingScale`'s test became the first file in
this codebase to render the same component multiple times and query
globally across `it()` blocks; fixed by adding `afterEach(cleanup)`,
folded into the RatingScale commit since it was discovered mid-task. (2)
`z.boolean().default(false)` on the new event-form field splits Zod's
input/output types for the first time in this codebase — `EventForm`'s
`useForm` needed the three-generic form
(`useForm<EventFormValues, unknown, EventFormInput>`) instead of the
one-generic form every prior form used, to satisfy both the resolver
(validates optional-field input) and `onSubmit` (always receives the
field as a required boolean).

**One pre-existing, unrelated bug surfaced incidentally, not fixed:**
while switching test accounts during live verification, clicking the
sidebar account menu threw a Base UI runtime error
(`MenuGroupContext is missing`) from `components/ui/dropdown-menu.tsx`
(`DropdownMenuLabel`) via `components/shell/user-menu.tsx` — reproducible
with a genuine click, confirmed not a test artifact. This is Slice 1 shell
code, untouched by Slice 7 and unrelated to feedback — flagged to the user
rather than fixed here (would be scope creep), left open for a dedicated
pass.

**Test baseline:** frontend 97/97 (21 new — `isFeedbackWindowOpen`'s 3
boundary cases, `feedbackFormSchema`'s 6 validation cases,
`resolveFeedbackPanelState`'s 6-case full truth table,
`RatingScale`'s 4 rendering/interaction cases — this codebase's first
direct component test, every prior slice's presentational components
having been live-verification-only — plus 2 cases extending the existing
event-schema test file). Live verification: full PRESENT-attendee
submit→recap→reload-persists cycle, committee summary page matching
averages/response-count/comment, non-attendee sees no panel, non-committee
sees the `/feedback` explainer, gate toggle round-trips both directions
through a real save+reload, both themes screenshotted with no domain-hue
leakage — all against the real dev backend. Backend untouched: 101 unit /
327 e2e (Slice 6's baseline, unchanged).

**What's real after Slice 7:** everything from Slices 1–6, plus full
Feedback — participant submission with a four-state panel (hidden / form /
recap / window-closed), committee aggregate summary, and the
`requireFeedbackForCertificate` gate now controllable from the event form.

**Placeholder routes remaining (before Slice 8):** Analytics, Workspace, Settings.

### Frontend Slice 8 — Analytics (shipped, `feature/frontend-slice8-analytics`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice8-analytics-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice8-analytics.md`.
Full architecture as built: `docs/uiux.md` (Slice 8 section).

**Scope:** full dashboard for the backend's 7 already-shipped, read-only
analytics endpoints — KPI row, trend/demographic/committee-activity/
feedback sections, 7/30/90-day range control. This frontend's first chart
library (`recharts` via shadcn's `chart.tsx` wrapper) and first use of the
`dataviz` skill for chart form/color/mark decisions. No new backend
endpoints.

10 code tasks, one commit each: chart infra + color tokens + `formatPercent`
(`19cdf64`), bar-chart shaping helpers (`ad8d35d`), event-title resolver
(`387ffa7`), `HorizontalBarChart` (`e419d49`), `SingleSeriesLineChart`
(`e2c77d0`), `RatingsTrendChart` (`267495c`), data hooks +
`KpiCard` null/formatter support (`61b9f1e`), `FeedbackTable`
(`e0f8eb3`), page wiring (`fd52913`); Task 10 (live verification) found
and fixed one real bug (`77bbd27`).

**The bug:** Recharts' `dot={false}` + `connectNulls={false}` renders an
isolated non-null value (surrounded by nulls) as a zero-length,
**invisible** path — silently dropping a real data point rather than just
styling it minimally. Affected NPS Trend and Ratings Trend, whose 30-day
windows had only one day with actual feedback data. Fixed by giving every
`<Line>` an explicit dot spec (`r: 4`, background-color ring) in both
`single-series-line-chart.tsx` and `ratings-trend-chart.tsx`, per
`dataviz`'s own marker-size/ring guidance. A second concern raised during
the same pass (bar charts looked empty in a full-page screenshot) was a
false alarm — `browser_evaluate` confirmed correct SVG geometry and
computed fill colors; the screenshot was just too compressed to show
20px-tall bars.

**Chart color tokens are new, not reused domain hues:** three literal hex
values (`--chart-1/2/3`, green/blue/gold) added to `:root` only — validated
via `dataviz`'s `validate_palette.js` against both light and dark surfaces,
passing unmodified in both, so no dark-mode override was added. The
existing domain-hue tokens' dark variants were tested too and failed the
dark lightness band for chart use specifically, confirming these needed to
be separate tokens, not shared ones.

**Test baseline:** frontend 106/106 (9 new — `formatPercent`,
`toBarData`/`committeeActivityToBarData`, `resolveEventTitle`). Live
verification: full dashboard render against real data, date-range control
confirmed scoping only day-windowed sections, non-committee explainer
confirmed, both themes screenshotted clean. Backend untouched: 101 unit /
327 e2e (Slice 7's baseline, unchanged).

**What's real after Slice 8:** everything from Slices 1–7, plus a full
Analytics dashboard — KPIs, registration/member-growth trends,
faculty/programme demographics, committee activity ranking, NPS/ratings
trends, per-event feedback table.

**Placeholder routes remaining:** Settings. (Workspace is now a real
tabbed page — Files tab shipped in Slice 9, Minutes/Assets tabs remain
honest placeholders, next up as their own sub-slices.)

### Frontend Slice 9 — Workspace: File Repository (shipped, `feature/frontend-slice9-workspace-files`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice9-workspace-files-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice9-workspace-files.md`.
Full architecture as built: `docs/uiux.md` (Slice 9 section).

**Scoping decision:** "Workspace" bundles three independent backend
subsystems (File Repository, Meeting Minutes, Asset Management) behind one
nav placeholder — combined, easily 15+ tasks, same shape of problem as
Events+Registrations in Slice 2, split the same way. User picked File
Repository first (of the three) as the simplest mental model, reusing
Slice 6's `apiUpload` multipart pattern directly. `/workspace` becomes a
real tabbed page (Files / Minutes / Assets, local-state tabs mirroring
Slice 3's event-detail pattern) — this sub-slice builds the Files tab
fully, Minutes/Assets stay as honest "coming in a later sub-slice" text.

7 code tasks, one commit each: data layer (`77a91ec`), uploader-name
resolution (`7326f15`), upload validation (`98329d4`), `FileCategoryBadge`
(`c71a837`, folded in a test-fixture fix caught by `tsc` — an invalid
`'MEMBER'` role value vitest doesn't typecheck but the build does),
`UploadFileDialog` (`92d73a8`), `FileList` (`7a9745e`), page wiring
(`d980796`); Task 8 (live verification) found and fixed **two** real bugs
(`d12c7bd`, `cb0352e`) — both frontend-only, both discovered by actually
driving the flow rather than any static check.

**Bug 1:** `UploadFileDialog`'s Cancel button called the raw
`onOpenChange(false)` prop directly instead of the Dialog's own wrapped
handler that calls `reset()` first — so a failed/partial attempt's
title/category/error state leaked into the next time the dialog opened.
Fixed by routing Cancel through the same reset-then-close path every other
close route already used.

**Bug 2:** a genuine security-adjacent UX leak — `GET
/organizations/:orgId/files` is open to any org member, but the uploader
name resolution depends on `GET /organizations/:orgId/members`, which is
`VIEW_MEMBERS`-gated (committee-only). For a plain participant that query
403s, and `resolveUploaderName`'s "member not found" fallback — meant for
a rare deleted-row edge case — fired on every row instead, showing raw
internal user ids to any non-committee viewer. Found by switching to a
participant test account. Fixed at the `FileList` call site: render
"Committee member" when the members query errors, rather than falling
through to the raw-id fallback.

**Test baseline:** frontend 111/111 (5 new — `resolveUploaderName`'s 2
cases, `validateUploadFile`'s 3 cases). Live verification: upload
(valid + rejected-type, confirmed zero network calls for the rejected
attempt), category filter round-trip, download opens a real 5-minute
signed MinIO URL, remove-with-confirm, non-committee account sees the
list/Download but no Upload/Remove, both themes screenshotted clean.
Backend untouched: 101 unit / 327 e2e (Slice 8's baseline, unchanged).

**What's real after Slice 9:** everything from Slices 1–8, plus the
Workspace Files tab (upload, category filter, download, remove, correct
RBAC). Minutes and Assets remain the next two Workspace sub-slices.

### Frontend Slice 10 — Workspace: Asset Management (shipped, `feature/frontend-slice10-workspace-assets`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice10-workspace-assets-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice10-workspace-assets.md`.
Full architecture as built: `docs/uiux.md` (Slice 10 section).

**Scope:** second of three Workspace sub-slices — full frontend surface
for the already-shipped `AssetsController` (create/list/edit/remove), a
plain inventory CRUD with no file storage. User picked modal dialogs over
dedicated pages for add/edit, proportionate to the 5-field form. No new
backend endpoints.

6 code tasks, one commit each: data layer (`5469761`), form schema
(`021d4b4`), `AssetConditionBadge` (`e801f93`), `AssetDialog` (`5cb8b84`),
`AssetList` (`0132d70`), page wiring (`4731c1a`); Task 7 (live
verification) found **zero** bugs — a first since Slice 5, and the first
time in this project a slice's design phase pre-empted the exact bug
class its predecessor hit live.

**Design choice that structurally avoided a repeat of Slice 9's bug:**
`AssetDialog` takes no `open` prop — the caller conditionally *mounts* it
only while in use, rather than keeping one instance alive with manual
reset logic (which is what broke in Slice 9's `UploadFileDialog` Cancel
button). A fresh mount always starts from its own `defaultValues`, so
there's no reset path to get wrong. Verified live: type into "Add asset,"
Cancel, reopen — genuinely blank, no stale state.

**A second Slice 9 bug class caught at design time, not live:** Slice 9's
`FileList` leaked a raw uploader UUID to non-committee viewers because
`GET /members` is `VIEW_MEMBERS`-gated (committee-only) while the file
list itself was visible to any member. `AssetList`'s "added by" resolution
hits the identical shape of risk (`createdByUserId` resolved the same way,
same any-member-visible list) — the spec and plan built in
`members.isError ? 'Committee member' : resolveMemberName(...)` from the
start. Live verification confirmed a participant account saw "Committee
member," not a raw id.

**Test baseline:** frontend 117/117 (6 new — `assetFormSchema`'s
validation cases). Live verification: one asset added per condition value
(GOOD/DAMAGED/LOST) with the badge colors confirmed (green/amber/red),
edit round-trip (quantity + condition), remove with confirm, non-committee
account correctly gated, both themes screenshotted clean. Backend
untouched: 101 unit / 327 e2e (Slice 9's baseline, unchanged).

**What's real after Slice 10:** everything from Slices 1–9, plus the
Workspace Assets tab — add/edit via modal, condition tracking with
semantic-colored badges, remove, correct RBAC. Meeting Minutes remains the
last Workspace sub-slice.

### Frontend Slice 11 — Workspace: Meeting Minutes (shipped, `feature/frontend-slice11-workspace-minutes`)

Spec: `docs/superpowers/specs/2026-07-19-frontend-slice11-workspace-minutes-design.md`.
Plan: `docs/superpowers/plans/2026-07-19-frontend-slice11-workspace-minutes.md`.
Full architecture as built: `docs/uiux.md` (Slice 11 section).

**Scope:** third and last Workspace sub-slice — completes the split first
made in Slice 9's spec. Full frontend surface for the already-shipped
`MinutesController`: create, paginated list, read-only detail, edit,
remove. Unlike Files/Assets, needed dedicated routes
(`/workspace/minutes/new`, `/[id]`, `/[id]/edit`) mirroring Events' route
shape one level deeper — the agenda/action-item arrays need real editing
space a modal can't hold. No new backend endpoints.

9 code tasks, one commit each: data layer (`74440b0`), form schema
(`1251c06`), attendee-name resolution (`3d91d54`), `MinutesForm`
(`b13e4d7`), `MinutesList` (`cfc490e`), page wiring (`5e09391`), new-minutes
page (`406845e`), minutes detail page (`01329cb`), edit-minutes page
(`ab3b595`); Task 10 (live verification) found **zero code bugs** — the
one real problem hit was an environment/cache issue, not the shipped code
(see below).

**Two firsts for this frontend:** `useMinutesList`/`MinutesList` are the
first genuinely paginated list (`{data, total, page, pageSize}` from the
backend, Prev/Next + "Page X of Y", no library) and `useMinutes(orgId,
minutesId)` is the first single-item fetch calling `GET /:id` directly —
every prior detail page (Members, Certificates) instead filtered an
already-fetched *unpaginated* list, which pagination breaks.

**A third occurrence of the Files/Assets authorization-leak class, again
designed in from the start:** `GET /members` is `VIEW_MEMBERS`-gated
(committee-only) but the minutes detail page is visible to any org
member. `resolveAttendeeNames` (matching by `Membership.id`, a new
resolver shape — every prior resolver keys by `userId`) stays a pure
mapper; the `members.isError → 'Committee member'` guard lives at the
detail-page call site, same placement as Slice 9/10's fixes. Live
verification confirmed a participant saw "Committee member, Committee
member," never raw membership ids.

**Operational gotcha (not a code bug), logged for next time:** the docker
stack and dev servers had stopped between Slice 10's merge and this
slice's live verification (host sleep/restart). Restarting them produced a
genuine 404 on every `/workspace/minutes/*` route — looking exactly like a
routing bug. Root cause: a `taskkill` targeted the wrong PIDs, so two
frontend dev-server processes ended up racing over the same `.next`
persistent cache, corrupting Turbopack's route manifest. Killing every
process actually bound to the ports in use, clearing `.next`, and starting
one clean instance fixed it immediately — no code touched, confirmed by
the same route returning `200` right after. Worth checking for a
stale/racing dev-server cache before assuming a post-restart 404 is a real
routing regression.

**Test baseline:** frontend 126/126 (9 new — `minutesFormSchema`'s 6
cases, `resolveAttendeeNames`'s 3 cases). Live verification: full
create→view→edit→remove cycle with attendees/agenda/action items;
pagination confirmed across 2 pages (12 seeded rows); non-committee gating
confirmed on list, detail, and both direct-navigation redirects; both
themes clean. Backend untouched: 101 unit / 327 e2e (Slice 10's baseline,
unchanged).

**What's real after Slice 11:** everything from Slices 1–10, plus the
complete Workspace surface — Files, Assets, and Meeting Minutes. All three
Workspace sub-slices are shipped; Settings is the only remaining unscoped
placeholder in the entire frontend.

---

## Next step

Frontend Slice 11 (Workspace — Meeting Minutes) merged to `main` —
docs-synced, tests green, branch deleted (see finish-branch below for
confirmation this actually happened by the time you're reading this).

**No frontend slice 12 has been picked yet.** Settings is the only
remaining unscoped placeholder in the whole frontend. Ask/confirm before
starting the next brainstorm.

Backend Phase 2 remains fully shipped (11/11 items, see above); Phase 3
backend items are still unscoped and untouched — the user's focus remains on
the frontend. Slice 6 remains the only frontend slice to have touched a
backend file (one real bug fix, `certificates.service.ts` + its e2e test);
Slices 7 through 11 all held "zero backend files."

Standing preferences remain in force for whatever comes next: pause before
Task 1, pause before the live-verification task too (added as a standing
preference during Slice 5), pause before docs sync, always merge-to-main
on finish, self-review every spec/plan, verify the test baseline before
writing plan task-numbering (frontend `npm test`/`npm run build` alongside
backend `npm test`/`npm run test:e2e`). Live-driving the actual flow (dev
server + Playwright) as the real verification step for page-level
correctness, rather than component unit tests, remains essential — it
caught nothing in Slices 1, 2, 4, 5, 10, and 11, one bug each in Slices 3
and 8 (field-id-vs-label mismatch; invisible sparse-line dots), one
*unrelated*-but-flagged bug in Slice 7 (account-menu crash, fixed
separately), **two** in Slice 6 (one frontend, one backend), and **two**
in Slice 9 (Cancel-button state leak, uploader-UUID authorization leak) —
Slice 6 remains the only slice where a live-verification pass surfaced a
backend defect rather than only frontend gaps. Slice 4 additionally showed
the inverse: cross-checking types against the Prisma schema *during
brainstorming* caught two real bugs before any code existed — design-time
schema cross-checks, live-driving after code exists, and cross-stack
correctness checks are all worth keeping for future slices, since they
catch different failure classes. Slice 8 adds one more: a "looks broken"
observation during live verification (empty-looking bar charts) can be a
screenshot-compression artifact, not a real bug — confirm via DOM/computed-
style inspection before treating a visual impression as a defect. Slice 9
established a pattern that Slices 10 *and* 11 then proved out twice in a
row: when a future feature resolves names/labels by joining against
another endpoint's data, check whether that other endpoint's RBAC tier is
a subset of the current feature's visibility, and design the guard in
before writing code — zero live bugs in either slice as a direct result.
Slice 11 adds a second, unrelated lesson: a **second operational gotcha**
alongside the existing docker-compose one — after any host sleep/restart,
a dev-server restart can itself go wrong (stray PIDs surviving a kill,
multiple processes racing over `.next`'s persistent cache) and produce a
404 that looks exactly like a real routing regression. Root-cause this
class of failure by checking for actually-listening ports and process
counts before assuming new route code is broken — confirmed twice now
(docker stack, dev-server cache) that "environment came back wrong after
a restart" is a real and recurring category on this machine, not a one-off.

This doc itself (`docs/current-context.md`) is untracked (`git status` shows
it as `??`) — it has never been committed. Keep updating it in place; whether
to commit it is the user's call, not assumed.
