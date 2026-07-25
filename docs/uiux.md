# Frontend Implementation — As Built

Documents the frontend as actually implemented, slice by slice. `design.md`
is the design-language source (tokens, philosophy, why); this file documents
how that system is wired into code. Update after each slice ships.

---

## Slice 1 — Foundation (shipped)

Stack as scaffolded: Next.js 16 (App Router, Turbopack), TypeScript,
Tailwind v4, shadcn/ui (Base UI primitives — this shadcn generation uses
`@base-ui/react`, not Radix), TanStack Query, Zustand, React Hook Form + Zod,
Lucide, Vitest + React Testing Library.

### Token architecture

Single source: `frontend/app/globals.css`. Three CSS-variable layers:

1. **`:root` / `[data-theme="dark"]`** — the Warm Editorial Neutral palette
   from `design.md`: neutral canvas (`--background`, `--surface`,
   `--surface-secondary`, `--border`, `--foreground*`), platform brand
   defaults (`--primary`, `--brand-secondary`), the seven domain hues
   (`--domain-*`), semantic status (`--success`/`--warning`/`--danger`/
   `--info`). Dark mode swaps values, not structure — same variable names,
   warm-neutral values on both sides (never cold slate, never pure black).
   shadcn's expected tokens (`--card`, `--muted`, `--sidebar*`, etc.) are
   mapped onto these in the same block so every added `components/ui/*`
   renders on-system with zero per-component overrides.
2. **`@theme inline`** — Tailwind v4's bridge from CSS variables to utility
   classes (`bg-domain-events`, `text-foreground-muted`, `shadow-card`, etc).
3. **Per-org override** (`OrgProvider`, see below) — inline `style` on a
   wrapper div sets `--primary`/`--brand-secondary` for the active
   organization, contrast-gated.

Dark mode toggling uses a `data-theme` attribute on `<html>`, not Tailwind's
`.dark` class convention — chosen so the pre-hydration inline script in
`app/layout.tsx` can set it before React ever runs (no flash). `useTheme`
(Zustand, persisted to `ucm-theme-preference`) is the source of truth at
runtime; it also mirrors the resolved value into the plain
`localStorage['ucm-theme']` key the inline script reads on next load.

Fonts: Hanken Grotesk (`--font-hanken`, headings) + Inter (`--font-inter`,
body/UI), both via `next/font/google` in the root layout — never a CSS
`@import`, so Next self-hosts and subsets them.

### Auth & token flow

`lib/api.ts` is the only place that calls `fetch` against the backend.
Contract:

- Access token lives in `useAuthStore` (Zustand) **in memory only** — never
  localStorage, never read by any other module. Refresh token persists to
  `localStorage['ucm-refresh']`.
- Every authenticated call attaches `Authorization: Bearer <access>`. A 401
  triggers exactly one refresh attempt, single-flight (`refreshInFlight`
  promise shared across concurrent callers — the backend rotates refresh
  tokens on use, so two parallel refreshes with the same token would 401 the
  second one and log the user out spuriously). Refresh success retries the
  original request once; refresh failure clears the session and calls
  `onAuthFailure` (wired in `app/(app)/layout.tsx` to redirect `/login`).
- A 403 with the backend's exact consent-staleness message
  (`"Account consent must be renewed"`) sets `consentStale` in the store and
  calls `onConsentStale` (wired to redirect `/consent?next=<path>`) — no
  refresh attempted, since consent staleness isn't an auth problem.
- On boot, `useSessionRestore` exchanges a persisted refresh token for a
  fresh pair using a raw `fetch` (deliberately bypassing `lib/api.ts` — this
  is the one call that must not recurse into the 401 cycle).

### Org context & branding

`OrgProvider` (`features/orgs/org-provider.tsx`), mounted in
`app/(app)/[orgSlug]/layout.tsx`, resolves the `orgSlug` route param against
`GET /organizations`, exposes `{org, membership}` via React context
(`useOrg()`), and:

- Redirects an unknown slug to the user's first org (if any) or `/welcome`
  (zero orgs).
- Applies the active org's `primaryColor`/`secondaryColor` as inline
  `--primary`/`--brand-secondary` overrides on a wrapper div — but only if
  `features/orgs/contrast.ts`'s WCAG relative-luminance check clears a 3:1
  ratio against the *current theme's* canvas color. Re-evaluated on theme
  change via a `MutationObserver` on `data-theme`. A failing org color
  silently falls back to the platform default rather than shipping illegible
  buttons.
- Role tier (`features/orgs/roles.ts`, `COMMITTEE_ROLES` mirroring backend
  `role-groups.ts`'s `MANAGE_EVENTS`) gates both nav visibility and which
  dashboard variant renders.

### App shell

`components/shell/`: `Sidebar` (desktop, 260px, `bg-sidebar` token) +
`SidebarNav` (shared content, also used inside a `Sheet` for the <1024px
mobile drawer) + `Topbar` (breadcrumb + mobile hamburger + reserved ⌘K slot).
Nav items (`nav-items.ts`) carry a `minTier` and an optional domain-hue class
— exactly the seven hues from `design.md`; Members/Dashboard/Settings stay
neutral rather than borrowing an eighth color, keeping the hue system
restrained to its seven defined domains.

Unbuilt feature routes (`events`, `members`, `attendance`, `certificates`,
`feedback`, `analytics`, `workspace`, `settings`) render a shared
`PlaceholderPage` — domain-hue icon, feature name, "Coming in a later
slice." Real routes, real nav entries, honest empty state — no dead links.

### Dashboard

`app/(app)/[orgSlug]/page.tsx` branches on role: committee tiers get
`CommitteeDashboard` (wired to `GET /organizations/:orgId/dashboard`), everyone
else gets `ParticipantHome` (a static landing — the dashboard query is never
fired for non-committee roles, since the endpoint is server-side
MANAGE_EVENTS-gated). KPI cards show only what the backend actually returns
(activeMembers, totalEvents, activeRegistrations, certificatesIssued) — no
invented trend deltas. Widgets (`components/dashboard/widgets.tsx`) render
upcoming events, pending approvals (WAITLISTED registrations), recent
registrations, and an audit-log activity feed;
`features/dashboard/format.ts` maps raw audit action strings
(`event.publish`) to short readable phrases and renders relative timestamps.

### What's real vs. placeholder after Slice 1

**Real:** scaffold, full token system (light+dark), auth (register/login/
refresh/logout), consent re-prompt gate, org switcher + create-org,
per-org branding, app shell, dashboard.

**Placeholder routes (nav exists, page doesn't yet):** Events, Members,
Attendance, Certificates, Feedback, Analytics, Workspace, Settings — each a
future slice.

**Not started:** public club page, mobile QR scanner flow, any
event/registration/certificate mutation UI, command palette (topbar slot
reserved only), Playwright e2e (deferred per spec until a multi-page flow
exists worth driving).

### One backend change this slice

`backend/src/main.ts` — `app.enableCors({ origin: process.env.FRONTEND_ORIGIN
?? 'http://localhost:3000' })`, locked to a single known origin. No other
backend file touched.

---

## Slice 2 — Events (shipped)

Replaces the Events placeholder with list/detail/create/edit + full
lifecycle management, against the live `EventsController`. No backend
changes this slice.

### Role tiers — the MANAGE_EVENTS / MANAGE_MEMBERS split

Slice 1's `isCommittee()` (`features/orgs/roles.ts`) covers the
MANAGE_EVENTS tier (President, VP, Secretary, Treasurer, Event Director,
Committee) — enough for create/edit/publish/complete. Cancel and delete are
gated one tier stricter on the backend (MANAGE_MEMBERS, excludes COMMITTEE),
matching the existing "create/edit vs destructive split" documented in
`docs/security.md` for this exact module. Added `canManageMembers()`
alongside `isCommittee()` — any UI gating a destructive event action must use
the stricter check, not `isCommittee()`.

### Status-driven UI, never disabled buttons for illegal transitions

`features/events/status.ts` — five pure predicates
(`canEdit`/`canPublish`/`canComplete`/`canCancel`/`canDelete`) mirroring
`EventsService`'s transition table exactly. `LifecycleActions`
(`components/events/lifecycle-actions.tsx`) renders only the buttons whose
predicate *and* role check both pass — an illegal transition's button simply
doesn't exist on the page, rather than existing in a disabled state. Cancel
and delete open a `Dialog` confirm before mutating; publish/complete fire
immediately (both reversible in spirit — publish can be followed by cancel,
complete has no undo but isn't destructive in the same sense as delete).

### Status badges use semantic tokens, not the domain hue

`EventStatusBadge` maps `DRAFT→neutral`, `PUBLISHED→success`,
`COMPLETED→info`, `CANCELLED→danger`. The Events *domain hue* (violet) stays
reserved for navigation/icons per `design.md`'s restraint rule — status is a
different signal than domain, and the two must never collide on the same
page (verified visually in both themes during Task 5).

### DRAFT-404 handling, not a filtered-empty list

`GET /events/:id` 404s for a non-committee viewer requesting a DRAFT event
(backend's deliberate no-existence-leak design). `useEvent()` sets
`retry: false` (a 404 here is a meaningful answer, not a transient failure)
and the detail page renders `EventNotFound` — a small, deliberately vague
"Event not found. It may have been removed, or you don't have access to it."
— on any `ApiError` with `status === 404`. Verified live: a participant
hitting a DRAFT event's URL directly gets this page with zero data leak (not
even the title reaches the client — the 404 has no body to leak).

### List — client-side filtering, matches an established unpaginated-list precedent

`GET /events` has no pagination or query params — full array, backend
`orderBy: startAt desc`. The list page does search (substring on title),
status filter, and an Upcoming/Past split entirely client-side via
`useMemo`, the same reasoning already used for Asset Management's
unpaginated list (`docs/security.md`): a per-org collection is bounded, and
inventing a filter option that can never match anything (a "Draft" choice
for a non-committee viewer, whose data never contains DRAFT rows) is
confusing, not honest — so it's omitted for them entirely, not just
disabled.

### Test baseline

Frontend 40/40 (12 new: role-tier truth table, status-transition truth
table, form-schema date-range/capacity edge cases) — same "logic only, no
component rendering" bar as Slice 1. Page-level correctness verified live
(dev server + Playwright) instead: full create→publish→edit→complete→cancel
→delete cycle, DRAFT-404 as a second account, both-theme screenshots. No new
bugs found during that pass (Task 5 has no commit as a result — nothing to
fix). Backend baseline unchanged: 101 unit / 326 e2e.

## Slice 3 — Registrations (shipped)

Committee-defined registration forms, self-registration (register / view
status / cancel), and committee registration management (list + reject).
Carved out of Slice 2 by its "Events only" scoping decision. No new backend
endpoints — verified the existing `RegistrationsController`/
`RegistrationFormController` contract during brainstorming before writing
any frontend code.

### No manual "approve" — capacity-driven, automatic

There is no approve button anywhere in this UI, and none should ever be
added: `RegistrationsService` resolves a new registration to `APPROVED` or
`WAITLISTED` purely by capacity at registration time, and promotes the
oldest `WAITLISTED` row automatically whenever an `APPROVED` registration
is cancelled or rejected. The committee's only action on a registration is
**reject** — everything else (approval, waitlist promotion) is a read-only
consequence the UI displays, never a button it offers.

### Answers are keyed by field id, not label — a live-verification catch

`FormField.id` (present on any field read back from `GET
.../registration-form`, absent on an editor draft that hasn't been saved
yet) is the actual key `RegistrationsService.validateAnswers` reads answers
by (`answers[field.id]`), confirmed by reading the backend source, but the
first implementation of `buildAnswerSchema`/`RegisterDialog`/`formatAnswers`
keyed everything by `field.label` instead — passing unit tests (which used
matching fixtures) and TypeScript, but failing on every live submission
with a custom form with `400 Missing required field: <label>` even though
the field was filled in. Caught only by driving the real dialog against the
real backend during Task 9, not by any earlier check. Fixed in
`4f1fcc6`: `SavedFormField` (`FormField & { id: string }`) is now the type
threaded through the register dialog and the answer schema builder; the
committee-facing form-builder editor is unaffected, since full-replace PUT
never sends or needs ids (`FormFieldDto` has none — the backend assigns
fresh ids on every save, which is also why a re-saved form's ids don't
match its own prior registrations' stored answers by design, not bug).
`formatAnswers` looks up each answer's `field.id` for display purposes
(label + sort order) and falls back to showing the raw key when no field
matches — covers both "form since deleted" and "form since re-saved with
new ids" without distinguishing the two.

### Register dialog — dynamic schema, not a fixed form

`buildAnswerSchema(fields: SavedFormField[])` builds a Zod object schema at
runtime from whatever fields the event's form currently has, mirroring
`validateAnswers` field-by-field: required TEXT/TEXTAREA/SELECT must be
non-empty, SELECT must be one of its options, CHECKBOX is validated as a
**boolean** (native checkbox inputs bound via `react-hook-form`'s
`register()` yield `checked: boolean`, not a string) and converted to the
backend's `'true'`/`'false'` string shape only at submit time, after
validation. No shadcn `Select`/`Checkbox` component was added — the SELECT
field uses a plain styled `<select>` and CHECKBOX a plain
`<input type="checkbox">`, following the precedent the events list already
set (`app/(app)/[orgSlug]/events/page.tsx`'s status filter) rather than
pulling in a new dependency for one field type each.

### Form builder — plain rows, no drag-and-drop dependency

`RegistrationFormEditor` uses `useFieldArray` over a row-per-field editor
(label, type, required, and a comma-separated options input shown only for
SELECT) with move-up/move-down/remove buttons instead of a drag-and-drop
library — same reasoning as the SELECT/CHECKBOX choice above. The whole
editor renders read-only (fields as plain text, no Add/Save controls) when
`!canEdit(event.status)`, matching the backend's own 409 guard
(`Completed or cancelled events cannot have their form edited`) — avoids a
round-trip just to learn the event is locked. Verified live: editing a
COMPLETED event's form shows the read-only list, not an error.

### Event detail page — tabs via local state, not a new shadcn Tabs

Overview / Registration Form / Registrations render as a segmented button
row + conditional content, the same lightweight pattern the events list
already used for its Upcoming/Past toggle — no `npx shadcn add tabs`. Only
committee sees the tab row at all; everyone else sees Overview's content
directly, with `MyRegistrationPanel` (register button, or status badge +
cancel) inserted beneath the existing description block for every role,
including committee members themselves (self-registration isn't
committee-exempt).

### Registration status badges — a fourth semantic mapping

`RegistrationStatusBadge`: `APPROVED→success`, `WAITLISTED→warning`,
`REJECTED→danger`, `CANCELLED→neutral` — same semantic-token family as
`EventStatusBadge`, same rule that the domain hue (blue,
`--domain-registrations`) never appears on a status badge, verified visually
in both themes.

### Test baseline

Frontend 54/54 (14 new: `buildAnswerSchema` per-field-type validation
including the id-vs-label distinction, `registrationFormSchema` editor
validation, `formatAnswers` id-to-label mapping and stale-key fallback) —
same "logic only" bar as Slices 1–2. Page-level correctness verified live:
form-builder round-trip (all four field types, persistence across reload),
self-registration with validation errors, capacity-1 → WAITLISTED → reject
→ auto-promotion → reject again (no further promotion, correct terminal
state), status-filter click-through, COMPLETED-event read-only form and
no-Register-button, both-theme screenshots. One real bug found and fixed
during this pass (`4f1fcc6`, see above) — everything else passed on first
drive. Backend baseline unchanged: 101 unit / 326 e2e (zero backend files
touched this slice).

## Slice 4 — Members (shipped)

Full CRUD against the live `MembershipsController`: list (search +
server-side role/status filter), add member, detail (profile + committee
history), edit profile/status, change role, remove. No new backend
endpoints.

### Two real type bugs fixed before any UI code

`types/api.ts`'s `MembershipRole` carried a stray `'ALUMNI'` value and
`MyMembership.status` carried a stray `'INACTIVE'` value — neither exists
on the backend (`prisma`'s `Role` enum has 9 values, none of them ALUMNI;
`MemberStatus` is `ACTIVE | ALUMNI` only). Both had been present since
Slice 1 with nothing ever exercising the wrong branch, so they shipped
silently until this slice's brainstorming cross-checked the type file
against the Prisma schema directly. Fixed in the data-layer task before any
page was written, rather than discovered live — the inverse of Slice 3's
field-id bug, which *was* only caught live because its tests shared the
same wrong assumption as the code.

### Three-tier RBAC, not two

Slices 2–3 only ever needed two tiers (`isCommittee`/`canManageMembers`).
Members needed a third: `canManageRoles` (`PRESIDENT`/`VICE_PRESIDENT`
only) gates role changes and removal, one tier stricter than
`canManageMembers` (which gates add/edit-profile/status). A
`MANAGE_MEMBERS`-tier actor (e.g. Secretary) sees Edit on every member's
detail page but never Change role or Remove — verified live, not just
inferred from the guard.

### No single-member fetch endpoint

`GET /organizations/:orgId/members` has no `:id` counterpart. The detail
and edit pages both call `useMembers(orgId, {})` (unfiltered) and
`.find(m => m.id === membershipId)` rather than a dedicated `useMember`
hook — a foreign or removed id simply isn't in the list, which is also
what renders `MemberNotFound`. No separate "does this exist" round-trip
needed; the tenant-scoped list itself is the source of truth.

### The last-active-president guardrail surfaces in three unrelated places

Any write that would leave zero `ACTIVE` `PRESIDENT` memberships — status
→ ALUMNI on the edit page, role change away from PRESIDENT in
`ChangeRoleDialog`, or remove — gets the same backend `409 Organization
must have at least one president`. The frontend doesn't try to predict
this client-side (would require fetching the full list to count active
presidents, and could drift from the backend's own serializable-
transaction-guarded version); each of the three surfaces just displays
`ApiError.message` verbatim inline and leaves the form/dialog open rather
than redirecting. Verified live as the sole President against all three
triggers in one pass.

### Role badges are plain, status badges are semantic

`MemberRoleBadge` uses `variant="outline"` with no color-coding — role
isn't a success/failure signal the way event/registration/attendance
status is. `MemberStatusBadge` follows the same semantic-token family as
the other three status badges (ACTIVE=success, ALUMNI=neutral). Members
has no assigned domain hue (`nav-items.ts` keeps Dashboard/Members/
Settings neutral by design, unchanged this slice) — neither badge, nor
anything else on these pages, ever renders in a domain color.

### Test baseline

Frontend 64/64 (10 new: `canManageRoles` truth table, add/edit-member
schema validation including the "no role or email field in the edit
shape" structural-safety check). Page-level correctness verified live: add
→ list/filter/search → detail → change role with confirm → committee
history recorded → edit profile/status → all three last-president
guardrail surfaces → escalation-guard 403 as a MANAGE_MEMBERS-only actor
→ tier-gated action visibility → remove → both themes. No bugs found
during this pass (the two type fixes were caught earlier, during
brainstorming, not live). Backend baseline unchanged: 101 unit / 326 e2e
(zero backend files touched this slice).

## Slice 5 — Attendance / QR Check-in (shipped)

Full attendance feature against the live `AttendanceController`: a
participant's own QR check-in code, a committee/volunteer camera-based
scanner with a manual-entry fallback, and a checked-in roster with
mark-absent. No new backend endpoints — the full contract (`GET /me`,
`GET /`, `POST /scan`, `POST /:id/absent`) was verified against the actual
controller/service source during brainstorming, not assumed.

### First frontend feature to give VOLUNTEER any capability

Every prior role-tier (`isCommittee`, `canManageMembers`, `canManageRoles`)
excluded `VOLUNTEER` entirely. `canManageAttendance` mirrors the backend's
`MANAGE_ATTENDANCE` group exactly — `MANAGE_EVENTS` tier plus `VOLUNTEER` —
so a volunteer with no other org-management access can still scan people in
and mark them absent, matching the door-desk reality this feature serves.

### Client-side name resolution, the same pattern as Slice 3's answer-formatting

Neither `GET /attendance` nor `GET /registrations` joins a participant's
name — `GET /attendance` returns only `registrationId`, not even `userId`
directly. `resolveParticipantName(attendance, registrations, members)`
chains `Attendance.registrationId` → matching `Registration.userId` →
matching `Member.user.fullName`, client-side, over two already-fetched
lists (`useRegistrations` from Slice 3, `useMembers` from Slice 4) rather
than requesting a backend join. A missing registration or member (not
possible under the lifecycle guarantees, but not ruled out under a race)
falls back to the raw id instead of crashing or hiding the row — covered by
its own unit tests (matched lookup, missing-registration fallback,
missing-member fallback), independent of any component.

### `BarcodeDetector`, feature-detected, with a manual fallback that exercises the identical contract

`QrScanner` feature-detects `'BarcodeDetector' in window` (declared as a
minimal ambient `Window` type locally — not yet in TypeScript's default DOM
lib, and not worth pulling in a `@types` package for one interface). When
supported, it requests `getUserMedia`, decodes frames in a
`requestAnimationFrame` loop, and de-duplicates a still-in-frame value so
holding a QR code in view doesn't resubmit it every frame. When unsupported
(older Safari/Firefox) or camera access is denied, it falls back to a plain
text-entry form calling the exact same `useScanAttendance` mutation — the
door desk still functions without a camera, and this fallback path is what
live verification actually drives, since headless Playwright can't grant
camera permissions. Scan feedback (success/error) auto-clears after 2
seconds so the scanner is immediately ready for the next person without a
manual reset — a fast, repetitive flow, not a one-shot form.

### First new runtime dependency this frontend has added

`qrcode` (+`@types/qrcode` dev dependency) renders the participant's token
as a QR image (`QRCode.toDataURL`) inside `MyQrDialog`, shown from a "Show
my check-in code" button on `MyRegistrationPanel` (Slice 3) when the
caller's registration is `APPROVED`. Camera scanning deliberately uses the
browser-native `BarcodeDetector` API instead of a JS scanning library — the
one new dependency this slice needed was for encoding, not decoding.

### Route content branches on role; the nav item itself doesn't

`/attendance`'s nav link stays visible to every member (mirrors `GET /me`
being callable by anyone), but the page content branches on
`canManageAttendance`: eligible viewers get an event picker into
`/attendance/[eventId]` (scanner + roster); everyone else sees a short
explainer pointing them to their own event page instead of a dead list —
same role-branch-the-content-not-the-nav pattern the dashboard already
established in Slice 1.

### Status badges stay semantic, never the domain hue

`AttendanceStatusBadge` follows the same semantic-token family as every
other status badge in this app: REGISTERED=neutral, PRESENT=success,
ABSENT=danger. Attendance's domain hue (teal, `--domain-attendance`) stays
on the nav icon only, exactly as it already was — verified in both themes
that it never leaks onto a badge.

### Test baseline

Frontend 68/68 (4 new: `canManageAttendance` truth table,
`resolveParticipantName`'s three cases). Page-level correctness verified
live against the real dev backend: participant registers → gets approved →
opens "Show my check-in code" → QR image renders; committee account
navigates the event picker → roster resolves real names (not raw ids);
manual-entry fallback scans a fetched token → status flips to Present →
"Mark absent" correctly disappears for that row; resubmitting the same
token → 409 "already resolved" (confirmed at the network level); marking a
second, unscanned registrant absent via the confirm dialog → status flips
to Absent → action disappears; a plain PARTICIPANT account hitting
`/attendance` directly → sees the explainer, not the picker; both themes
screenshotted, badges read correctly, domain hue never appears on one. No
bugs found during this pass. Backend baseline unchanged: 101 unit / 326
e2e (zero backend files touched this slice).

## Slice 6 — Certificates (shipped)

Full certificates feature against the live `CertificatesController`: a
participant's own certificate download (shown from the event they
attended), committee per-event certificate management (list, manual
upload, remove). Generation itself is fully automatic — this slice only
builds the viewing/managing surface, adding zero new backend endpoints and
no UI to trigger generation.

### First multipart upload this frontend has needed

Every prior feature's mutations were plain JSON bodies. `lib/api.ts` grew
an `apiUpload<T>(path, formData)` sibling function rather than widening
`api()` itself — it reuses the same bearer-token injection and
401→refresh→retry cycle, but passes a `FormData` body with no manually-set
`Content-Type` header (the browser derives the multipart boundary from the
`FormData` itself; setting the header manually would omit it and break
server-side parsing). `api()` was left untouched — zero risk to any
existing JSON call site.

### No new role tier — first frontend feature without one since Slice 3

Unlike Attendance's VOLUNTEER-inclusive `MANAGE_ATTENDANCE_ROLES`,
`CertificatesController` gates every committee-only route with the
backend's plain `MANAGE_EVENTS` group, so this slice reuses `isCommittee`
from Slice 2 directly — no new truth table needed.

### One-hop name resolution, reusing Slice 5's two-hop resolver for the other list

`Certificate` carries `userId` directly (unlike `Attendance`, which only
carries `registrationId`), so the committee list's name resolution is a
new, simpler one-hop function: `resolveMemberName(userId, members)`. The
upload form's attendee picker, however, is built from `Attendance[]` (only
`PRESENT` rows, filtered further to exclude anyone already certified), so
it reuses Slice 5's existing two-hop `resolveParticipantName` as-is rather
than introducing a second name-from-attendance function.

### Client-side file validation is UX only, never the security boundary

`validateCertificateFile(file)` mirrors the backend's own
`ALLOWED_MIME`/`MAX_FILE_BYTES` (PDF, 5MB) as a fast-fail check before the
network round-trip. The backend re-validates both regardless — the client
check exists purely so a bad file gets an inline message instead of a
round-trip 400.

### A real backend bug, found only by live-driving the full lifecycle

Live verification is deliberately not backend-out-of-scope when a real
defect blocks the frontend flow it's driving. Removing a certificate that
had ever been downloaded — including by its own owner's `GET /me` call,
which every participant's own certificate view triggers — 500'd:
`CertificateDownload.certificateId` is a required foreign key with
Prisma's default `Restrict` delete behavior, and the existing
`certificates-delete.e2e-spec.ts` never called `GET /me` before deleting,
so the path was never exercised. Fixed in
`certificates.service.ts#remove()` by clearing the certificate's
`CertificateDownload` rows inside the same transaction before the delete
(download history for a certificate that no longer exists isn't
independently meaningful), plus a new e2e case
("committee deletes a certificate that was already downloaded") added to
lock in the fix. This is the one exception to "backend untouched" the
plan's global constraints stated up front — a real bug surfacing mid-slice
overrides a scoping assumption written before the bug was known, same as
Slice 3's precedent (though that one was a frontend-only fix).

### Test baseline

Frontend 76/76 (5 new: `apiUpload`'s three behavioral cases —
FormData-with-no-Content-Type, 401 refresh-and-retry, non-401 error
surfacing — `resolveMemberName`'s two cases, `validateCertificateFile`'s
three cases). Page-level correctness verified live against the real dev
backend: complete a `requireFeedbackForCertificate: false` event with two
`PRESENT` attendees → both certificates auto-generate immediately;
participant's "Download certificate" link resolves to a real signed URL;
committee list resolves real names with correct file size/date; remove →
hit the 500 bug → fixed → remove works cleanly; re-upload through the
form → reappears in the list; eligible-attendee filtering correctly
excludes certified people and includes uncertified ones in both
directions; a plain PARTICIPANT account hitting `/certificates` directly
sees the explainer, not the picker; both themes screenshotted, no
domain-hue leakage onto anything but the nav icon. Backend: 101 unit / 327
e2e (326 baseline + 1 new regression case; one backend file
(`certificates.service.ts`) and one backend test file touched this slice —
the sole exception to the "zero backend files" pattern every prior slice
held).

## Slice 7 — Feedback (shipped)

Full frontend surface for the backend's already-shipped Event Feedback +
NPS feature (Phase 2): participant feedback submission (event-detail
panel), committee aggregate summary (dedicated `/feedback` nav page +
event picker, mirroring Certificates/Attendance), and the
`requireFeedbackForCertificate` gate toggle added to the event create/edit
form — the one piece of this feature that had a backend field
(`UpdateEventDto.requireFeedbackForCertificate`) with no frontend control
to set it, until now. Zero new backend endpoints — `POST .../feedback`,
`GET .../feedback/me`, `GET .../feedback/summary` all pre-existed and were
read directly from source during brainstorming.

### Four-state panel, resolved as a pure function

`resolveFeedbackPanelState(attendanceStatus, feedback, event, now)` in
`features/feedback/panel-state.ts` returns one of `hidden | recap | form |
window-closed`, gated first on `useMyAttendance` (Slice 5's hook — a
`GET .../feedback/me` 404 alone can't distinguish "not a PRESENT attendee"
from "PRESENT but hasn't submitted yet," so the attendance check has to
run first). `window-closed` is a deliberate fourth state, not a silent
hide: a PRESENT attendee who never submitted before the 14-day window
closed sees a muted explanatory line rather than nothing, consistent with
this app's "honest, not fake-empty" placeholder philosophy. The window
math itself (`features/feedback/window.ts`) duplicates the backend's
`FEEDBACK_WINDOW_MS` constant as a plain number — no shared package
between frontend/backend anywhere in this codebase.

### RatingScale — one component for both the 0-10 and 1-5 scales

`components/feedback/rating-scale.tsx` is a parameterized button-row
(`min`/`max`/`value`/`onChange`/`label`), used for all four scores (NPS:
0-10; content/organization/venue: 1-5 each) rather than four bespoke
widgets. Wired into the form via React Hook Form's `Controller` — this
frontend's first use of `Controller`, since every prior form field bound
through native `register()` on a real `<input>`/`<select>`/`<textarea>`,
and a button-row isn't one.

### Zod `.default()` splits a schema's input and output types

`requireFeedbackForCertificate` on `eventFormSchema` uses
`z.boolean().default(false)` so every existing call site/test that omits
the field still parses successfully. This makes Zod's inferred input type
(`z.input<typeof schema>`, field optional) diverge from its output type
(`z.output<typeof schema>`, field always present) for the first time in
this codebase — `EventForm`'s `useForm` grew from the one-generic
`useForm<EventFormInput>` to the three-generic
`useForm<EventFormValues, unknown, EventFormInput>` (raw form values →
context → parsed output) to satisfy both the resolver (validates
`EventFormValues`) and `onSubmit` (always receives `EventFormInput`, field
never undefined).

### Test baseline

Frontend 97/97 (21 new: `isFeedbackWindowOpen`'s 3 boundary cases,
`feedbackFormSchema`'s 6 validation cases, `resolveFeedbackPanelState`'s 6
full-truth-table cases, `RatingScale`'s 4 rendering/interaction cases — a
first for this codebase, since every prior slice's live-verification-only
components had no direct test — plus 2 cases extending
`eventFormSchema`'s existing test file for the new field). Adding
`RatingScale`'s test also surfaced a latent gap in `vitest.setup.ts`: without
vitest's `globals: true`, testing-library never auto-registers its
`afterEach` unmount, so a test file rendering the same component multiple
times accumulated DOM across `it()` blocks — fixed by adding an explicit
`afterEach(cleanup)`, which every other test file benefits from
retroactively even though none had hit the bug yet (single-render test
files never noticed). Page-level correctness verified live against the
real dev backend: a PRESENT attendee sees the form, submits NPS 9/Content
5/Organization 4/Venue 5 + a comment, sees the exact values echoed back in
a read-only recap immediately and again after a full reload; committee's
`/feedback` → event picker → summary page shows the matching averages,
response count, and comment; a non-attendee account sees no panel at all
on the event page; a non-committee account sees the explainer at
`/feedback`; the `requireFeedbackForCertificate` checkbox round-trips both
directions (check→save→reload shows checked, uncheck→save→reload shows
unchecked); both themes screenshotted, no domain-hue leakage. No bugs
found in this slice's own surface. Backend untouched: 101 unit / 327 e2e
(zero backend files touched).

One pre-existing, unrelated bug was incidentally surfaced while switching
test accounts: clicking the sidebar account menu throws a Base UI runtime
error (`MenuGroupContext is missing`) from `components/ui/dropdown-menu.tsx`
(`DropdownMenuLabel`) via `components/shell/user-menu.tsx` — reproducible
with a genuine click, not a test artifact, but in Slice 1's shell code,
untouched by this slice and unrelated to feedback. Flagged, not fixed here
— left for a dedicated pass.

## Slice 8 — Analytics (shipped)

Full dashboard for the backend's 7 already-shipped, read-only analytics
endpoints (overview, certificates, trends, demographics, committee-activity,
feedback, feedback-trends) — a KPI row, five chart/table sections, and a
7/30/90-day range control. This frontend's first chart library and first
use of the `dataviz` skill. Zero new backend endpoints.

### First chart library — shadcn's Recharts wrapper, not a bespoke one

`npx shadcn@latest add chart` installed `recharts@3.8.0` +
`components/ui/chart.tsx` (`ChartContainer`/`ChartTooltip`/
`ChartTooltipContent`/`ChartLegend`/`ChartLegendContent`, `ChartConfig`
type) — this generation's standard chart primitive, consumed as-is rather
than hand-rolling SVG. `HorizontalBarChart`, `SingleSeriesLineChart`, and
`RatingsTrendChart` (`components/analytics/`) are the only three chart
shapes this slice needed; a fourth generalization (single→N-series line
chart) was deliberately not built since `RatingsTrendChart`'s 3 fixed
series (content/organization/venue) is the only multi-series case in this
dashboard (YAGNI, noted inline in the component).

### Chart colors are a new token trio, separate from the existing domain hues

`design.md`'s seven domain hues are icons/tags only, never chart fills —
reusing them as Recharts series colors would make a legend swatch
indistinguishable from a nav icon's meaning. Per the `dataviz` skill's
color-formula step, three new literal hex values were added to `:root` in
`app/globals.css` — `--chart-1: #3f9142` (green), `--chart-2: #2f7de1`
(blue), `--chart-3: #b8860b` (gold) — chosen to echo the Analytics/
Registrations/Certificates domain hues' *identity* without being the same
CSS variables, then validated with `dataviz`'s `validate_palette.js`
against both the light surface (`#fafaf8`) and dark surface (`#18171b`).
The same three hex values pass validation unmodified in both modes, so
they're pinned once in `:root` with **no dark-mode override** — the
existing domain tokens' own dark variants were tested too and failed the
dark lightness band for chart use specifically, confirming the two token
sets need to diverge, not share values.

### A real bug: `dot={false}` hides a truthful data point, not just a stylistic no-op

Recharts renders an isolated non-null value surrounded by `null` neighbors
(under `connectNulls={false}`) as a zero-length path segment — with
`dot={false}`, that point is **not drawn at all**, even though the data is
real (e.g. the one day in a 30-day window with actual feedback
submissions). Confirmed via `.recharts-line-curve` path inspection: the
affected lines rendered a single-point degenerate path
(`"M427,58.5Z"`) while lines with no null gaps (Registration Trend, Member
Growth) rendered full multi-point paths normally. Fixed (`77bbd27`) by
giving every `<Line>` in `single-series-line-chart.tsx` and
`ratings-trend-chart.tsx` an explicit dot spec —
`{ r: 4, strokeWidth: 2, stroke: 'var(--background)', fill: 'var(--color-*)' }`
— matching `dataviz`'s own mark spec (≥8px/r≥4 markers, a surface-color
ring for overlap legibility) rather than leaving dots off by default. Noted
but not fixed further: two series landing on the exact same value on the
same day render as one visually-overlapping dot — the ring solves
"crossing a line" legibility, not "identical coordinates," and the
tooltip/legend/table already disclose both values correctly.

### KPI cards learn to render "no data yet," not a fake zero

`KpiCard`'s `value` prop widened from `number` to `number | null` (a
brand-new org can have a null `attendanceRate` — no events yet — and `0%`
would misleadingly imply "zero attendance" rather than "no data"), with a
new optional `format?: (value: number) => string` prop (defaults to the
existing `formatCount`) so the same component now also renders
`formatPercent` output for the attendance-rate tile without a parallel
component.

### Client-side event-title resolution, the same pattern as Slices 3/5/6's name resolution

The feedback-summary and per-event feedback rows carry `eventId`, not a
title — `resolveEventTitle(eventId, events)` joins against the
already-fetched events list client-side, falling back to the raw id on a
miss, mirroring `resolveParticipantName`/`resolveMemberName` exactly rather
than inventing a new lookup shape.

### Date-range control scopes only the day-windowed sections

The 7d/30d/90d control re-fetches Registration Trend, Member Growth,
Committee Activity, NPS Trend, and Ratings Trend (all backed by `days`-
parameterized endpoints); the KPI row, Demographics, and the Feedback table
are snapshot/all-time data and don't re-fetch on range change — verified
live via the trend charts' x-axis labels changing (`2026-06-23…2026-07-19`
→ `2026-07-13…2026-07-19`) while the KPI row stayed fixed.

### Test baseline

Frontend 106/106 (9 new: `formatPercent`'s 3 cases, `toBarData`/
`committeeActivityToBarData`'s 3 cases, `resolveEventTitle`'s 2 cases).
Page-level correctness verified live against the real dev backend: full
dashboard render with real KPI/trend/demographic/committee/feedback data;
date-range control confirmed scoping only the windowed sections; a
non-committee account sees the "Analytics are for committee..." explainer
instead of the dashboard (12 expected console 403s — all 6 analytics hooks
fire before the eligibility check gates the render, the same pattern every
other role-gated page in this app already has); both themes screenshotted,
chart colors read clearly with no domain-hue leakage onto non-chart
elements. One real bug found and fixed (`77bbd27`, sparse-line dot
visibility, see above); one initial false alarm (bar charts looked empty
in a full-page screenshot — confirmed via `browser_evaluate` that the SVG
paths and computed fill colors were correct all along, the screenshot was
just too compressed to show 20px-tall bars clearly). Backend untouched:
101 unit / 327 e2e (Slice 7's baseline, unchanged).

## Slice 9 — Workspace: File Repository (shipped)

First of three Workspace sub-slices. "Workspace" bundles three independent
backend subsystems (File Repository, Meeting Minutes, Asset Management)
behind one nav placeholder — combined, easily 15+ tasks, the same shape of
problem Slice 2 hit with Events+Registrations, which was split the same
way. This sub-slice builds the **Files** tab of a new tabbed `/workspace`
page against the already-shipped `FilesController`: upload (multipart,
committee-only), list with category filter (any org member), signed
download (any org member), remove (committee-only). Meeting Minutes and
Asset Management remain unbuilt, honestly marked inline. Zero new backend
endpoints.

### `/workspace` becomes a real tabbed page for the first time

Local-state tab row (Files / Minutes / Assets), same lightweight pattern
as Slice 3's event-detail tabs — no new shadcn Tabs component. This
sub-slice wires the Files tab fully; Minutes and Assets render a "Coming
in a later sub-slice" line rather than pretending to be built.

### Two real bugs found live, both frontend-only, both fixed same-session

**Bug 1 — Cancel button skipped the dialog's own reset:** `UploadFileDialog`'s
Cancel button called the raw `onOpenChange(false)` prop directly instead of
going through the Dialog's wrapped handler (`(next) => { if (!next) reset();
onOpenChange(next); }`), so title/category/validation-error state from a
failed attempt leaked into the next time the dialog opened. Reproduced by
filling a title, triggering the "Unsupported file type" error with a bad
file, clicking Cancel, then reopening — the stale title and error were both
still there. Fixed by having Cancel call `reset()` before `onOpenChange(false)`,
matching what every other close path already did.

**Bug 2 — a raw uploader UUID leaked to non-committee viewers:** `GET
/organizations/:orgId/files` is open to any org member, but the uploader
name resolution (`resolveUploaderName`, joining against `useMembers`) relies
on `GET /organizations/:orgId/members`, which is `VIEW_MEMBERS`-gated
(committee-only, confirmed in `memberships.controller.ts` — the same tier as
`MANAGE_EVENTS` plus nothing extra). For a plain participant, that query
403s, `members.data` is `undefined`, and `resolveUploaderName`'s "member not
found" fallback — designed for the genuine rare case of a deleted/missing
row — fired instead on every single file row, displaying raw internal user
ids to anyone without committee access. Reproduced by switching to a
participant test account and finding a UUID where a name should be. Fixed
at the `FileList` call site (not in `resolveUploaderName` itself, whose
contract is correct for its actual case): when `members.isError`, render
"Committee member" instead of resolving a name at all, reserving the raw-id
fallback for when the member list loaded successfully but a specific
uploader's row is genuinely absent.

### Client-side validation UX-only, matches Slice 6's disclaimer exactly

`validateUploadFile` mirrors the backend's own `ALLOWED_MIME`/`MAX_FILE_BYTES`
(pdf/docx/xlsx/pptx/png/jpeg, 20MB) — confirmed live that an unsupported
file type never reaches the network (checked via `browser_network_requests`:
only the one successful upload POST appears, the rejected attempt fires
zero requests).

### Test baseline

Frontend 111/111 (5 new: `resolveUploaderName`'s 2 cases,
`validateUploadFile`'s 3 cases). Live verification against the real dev
backend: upload with title+category+file, category filter narrows
correctly (including back to "All categories"), unsupported file type
rejected client-side with zero network calls, download opens a real
5-minute signed MinIO URL, remove-with-confirm removes the row, a
non-committee account sees the list and Download but no Upload/Remove
controls, both themes screenshotted clean (plain outline category badge,
no domain-hue leakage, Workspace nav icon keeps its hue). Two real bugs
found and fixed live (see above), both frontend-only. Backend untouched:
101 unit / 327 e2e (Slice 8's baseline, unchanged).

**What's real after Slice 9:** everything from Slices 1–8, plus the
Workspace Files tab — upload, category filter, download, remove, correct
RBAC. Minutes and Assets tabs remain honest placeholders, next up as their
own sub-slices.

## Slice 10 — Workspace: Asset Management (shipped)

Second of three Workspace sub-slices. Fills in the Assets tab of
`/workspace` (previously a placeholder) against the already-shipped
`AssetsController`: create, list, edit, remove — a plain inventory CRUD
with no file storage involved, unlike Files. Meeting Minutes remains the
third, unbuilt sub-slice. Zero new backend endpoints.

### Modal dialogs, not dedicated pages — and a design that structurally avoids Slice 9's Cancel bug

User picked modal dialogs over `/workspace/assets/new`-style dedicated
pages, given the small field set (5 plain inputs, no role/RBAC selection
like Members' add/edit) — proportionate to `UploadFileDialog`'s weight
from Slice 9. `AssetDialog` handles both add and edit via one component
and an optional `asset?` prop, but unlike `UploadFileDialog` it takes no
`open` prop at all — the caller **conditionally mounts** it (only while a
dialog should be showing) instead of keeping one instance alive across
opens/closes. A fresh mount always reads its own `defaultValues`, so
there's no manual reset path to get wrong — this was a deliberate
structural choice at design time specifically to avoid re-introducing
Slice 9's "Cancel button skipped `reset()`" bug class, and it worked:
Task 7 verified typing into "Add asset," clicking Cancel, and reopening
showed a genuinely blank form, no stale-state bug found.

### Condition badge uses semantic status tokens, not a plain outline

Unlike Slice 9's `FileCategoryBadge` (plain outline — file category is
identity, not status), `AssetConditionBadge` uses the same semantic-token
family as every other status badge in this app: `GOOD→success`,
`DAMAGED→warning`, `LOST→danger`. Condition genuinely is a status signal
(good/degraded/gone), so it gets color-coding the way file category
deliberately doesn't.

### A Slice 9 bug class caught at design time instead of live

Slice 9's `FileList` leaked a raw uploader UUID to non-committee viewers
because `GET /organizations/:orgId/members` is `VIEW_MEMBERS`-gated
(committee-only) while the file list itself was visible to any member —
`resolveUploaderName`'s "not found" fallback fired on every 403 instead of
only the genuine rare case. `AssetList`'s "added by" resolution hits the
exact same shape of risk (`Asset.createdByUserId` resolved via the same
`useMembers` call, same asset list visible to any member), so the spec and
plan built in the fix from the start:
`members.isError ? 'Committee member' : resolveMemberName(...)`, comment
explaining why, before any code was written. Live verification (Task 7)
confirmed a non-committee test account correctly saw "Committee member,"
not a raw id — this is the one specific regression the plan flagged in
advance as worth checking, and it held.

### Test baseline

Frontend 117/117 (6 new: `assetFormSchema`'s validation cases — required
name, positive-integer quantity, enum-restricted condition, optional
location/notes). Live verification: added one asset per condition value
(GOOD/DAMAGED/LOST), confirmed each badge color; edited an asset's
quantity and condition, confirmed the row and badge updated; removed an
asset with confirm; the Cancel-then-reopen check described above found no
stale state; a non-committee account saw the list with no Add/Edit/Remove
controls and "Committee member" instead of a raw id; both themes
screenshotted clean (green/amber/red badges, no domain-hue leakage).
Zero bugs found — no fix commit this task. Backend untouched: 101 unit /
327 e2e (Slice 9's baseline, unchanged).

**What's real after Slice 10:** everything from Slices 1–9, plus the
Workspace Assets tab — add/edit via modal, condition tracking with
semantic-colored badges, remove, correct RBAC. Meeting Minutes remains the
last Workspace sub-slice.

## Slice 11 — Workspace: Meeting Minutes (shipped)

Third and last Workspace sub-slice — completes the split first made in
Slice 9's spec. Full frontend surface for the already-shipped
`MinutesController`: create, paginated list, read-only detail, edit,
remove. Unlike Files/Assets (tab content + dialogs), Minutes needed
dedicated routes nested under `/workspace/minutes/` — the agenda/
action-item arrays need real editing space a modal can't hold. Zero new
backend endpoints.

### First paginated list, first genuinely single-item fetch

Every prior detail page (Members, Certificates) found its row by filtering
an already-fetched *unpaginated* list. `MinutesController`'s list is
paginated (`{data, total, page, pageSize}`), which breaks that shortcut —
`useMinutes(orgId, minutesId)` is this frontend's first hook to call `GET
/:id` directly for a single row. `MinutesList` is likewise this app's
first list with real pagination controls (Prev/Next + "Page X of Y", no
library, `PAGE_SIZE = 10` client-side constant).

### Route shape mirrors Events one level deeper

`/workspace/minutes/new`, `/workspace/minutes/[id]`,
`/workspace/minutes/[id]/edit` — same shape as `/events`'s four-route
family from Slice 2, and the same non-committee-redirect pattern on
new/edit (`useEffect` + `router.replace`, matching `EventForm`'s create/
edit pages exactly).

### `attendeeMembershipIds` introduces a new resolver shape

Every prior name resolver in this app (`resolveMemberName`,
`resolveUploaderName`) keys by `userId`. `MeetingMinutes.attendeeMembershipIds`
holds `Membership.id` values instead (confirmed by reading
`minutes.service.ts`'s `validateAttendees`, which checks membership ids
directly) — `resolveAttendeeNames` matches by `member.id`, the first
resolver in this codebase to do so.

### A third repeat of the Files/Assets authorization-leak class — designed in from the start, held live

`GET /members` is `VIEW_MEMBERS`-gated (committee-only) but the minutes
detail page is visible to any org member — the identical risk shape
Slice 9's `FileList` first leaked (a raw UUID) and Slice 10's `AssetList`
pre-empted at design time. This is the third occurrence of the same
pattern (any-member-visible list/detail + committee-gated name-resolution
dependency), and the spec/plan built in the guard from the start again:
`members.isError ? m.attendeeMembershipIds.map(() => 'Committee member') :
resolveAttendeeNames(...)` at the detail-page call site (not inside the
resolver itself — the resolver stays a pure mapper, matching where
Slice 9/10 applied their guards). Live verification confirmed a
participant account saw "Committee member, Committee member," never raw
membership ids.

### `MinutesForm`'s attendee checklist is this app's second use of `Controller`

A plain `string[]` field bound to a checkbox group doesn't fit React Hook
Form's `register()` cleanly, so the attendee checklist uses `Controller`
(first used for Slice 7's `RatingScale`) to toggle membership ids in and
out of the array manually. Agenda items and action items each use
`useFieldArray`, mirroring Slice 3's `RegistrationFormEditor` — add/remove
rows, per-row validation errors.

### Operational gotcha, not a code bug: a stale Turbopack cache produced a real-looking 404

Between Slice 10's merge and this slice's live verification, the docker
compose stack and both dev servers had stopped (host sleep/restart,
consistent with the gotcha already on file for this project). Restarting
the dev servers alone produced a **genuine 404 on every `/workspace/minutes/*`
route**, including the dynamic `[minutesId]` detail route — looking exactly
like a routing bug in the new code. Root-caused instead of guessed at: two
frontend dev-server processes ended up racing over the same `.next`
persistent cache (a `taskkill` targeted the wrong PIDs, so the original
process survived and a second one bound to a fallback port), corrupting
Turbopack's route manifest. Killing every process actually bound to
`3000`/`3002`, clearing `.next`, and starting one single clean instance
fixed it immediately — confirmed by the exact same dynamic route
returning `200` on the next request, no code touched. Logged here so a
future "routes 404 right after a restart" moment isn't re-diagnosed as a
code regression before checking for a stale/racing dev-server cache
first.

### Test baseline

Frontend 126/126 (9 new: `minutesFormSchema`'s 6 cases,
`resolveAttendeeNames`'s 3 cases). Live verification: created minutes
with 2 attendees/2 agenda items/1 action item, detail page rendered
everything correctly; edited (removed an agenda item, removed and
re-added an action item, confirmed persistence); removed with confirm;
seeded 12 additional rows via the API and confirmed pagination
(Previous/Next, correct disabling at both bounds, "Page X of Y");
non-committee account saw the list/detail with no New/Edit/Remove, direct
navigation to `/new` and `/edit` both redirected rather than showing a
dead-end form, and the attendee-authorization guard held (see above);
both themes screenshotted clean. Zero code bugs — the one real problem
encountered (see the operational-gotcha note above) traced to a stale dev
environment, not the shipped code. Backend untouched: 101 unit / 327 e2e
(Slice 10's baseline, unchanged).

**What's real after Slice 11:** everything from Slices 1–10, plus the
complete Workspace surface — Files, Assets, and now Meeting Minutes
(create, paginated browse, read-only detail, edit, remove). All three
Workspace sub-slices are shipped; Settings is the only remaining unscoped
placeholder in the entire frontend.

## Slice 12 — Settings (shipped)

**Scope:** the last unscoped nav placeholder. `/settings` is a local-state
tabbed page (same shape as `/workspace`): **Organization** and **My
Account**. No new backend endpoints — everything already existed behind
`OrganizationsController` and `PdpaController`.

### Three RBAC tiers on one page — a first for this frontend

Every prior slice's role split topped out at two tiers per feature area.
Settings' Organization tab has three: committee to even see the tab
(`isCommittee`, matching the sidebar nav's own gate), PRESIDENT+VP to edit
profile/branding (`canManageOrgProfile` — reuses Slice 4's
`MANAGE_ROLES_ROLES` array under a feature-specific name rather than
duplicating the list or reusing the old name out of context), and
PRESIDENT-only to edit colors (`canManageOrgColors`, a fresh
one-role array). The color fields render for VP too, just `disabled` with
a "President only" hint — visible-but-inert, not hidden, matching this
app's established preference for explaining a stricter gate rather than
pretending the control doesn't exist.

### Free-form backend shapes get free-form editors, not invented structure

`socialLinks` (`Record<string,string>`) and `advisors` (`string[]`) are
both genuinely free-form on the backend — no fixed platform enum, no
advisor-title field. The Organization tab edits both as repeatable
`useFieldArray` rows (key+value pairs for social links, a single text
field for advisors) rather than inventing a fixed platform picker or an
advisor-title/email shape the backend doesn't store. `SocialLinksFields`/
`AdvisorsFields` both read `useFormContext` rather than taking a `control`
prop directly — the parent `OrganizationProfileForm` wraps its `<form>` in
RHF's `<FormProvider>`, the first use of that pattern in this codebase
(every prior multi-field-array form, e.g. Slice 11's `MinutesForm`, passed
`control` straight through as a prop instead).

### Branding upload: inline, not a dialog

Logo/banner upload uses a plain preview box, a native `<input type="file">`,
and Upload/Remove buttons directly on the page, not a modal — this app's
first branding-adjacent upload UI, and deliberately simpler than Slice 9's
`UploadFileDialog` or Slice 6's certificate-upload dialog since there's
exactly one purpose per slot and no dialog-open/close lifecycle to manage.
Client-side validation (`validateBrandingImage`, mirroring the backend's
`image/png|jpeg|webp` + 2MB limit) runs before the upload mutation fires,
same fast-fail pattern as every prior upload feature.

### My Account: the first account-level, cross-org, irreversible action

`DeleteAccountDialog` requires typing `DELETE MY ACCOUNT` exactly
(case-sensitive) before its confirm button enables, stronger than every
other destructive-confirm dialog in this app (all of which are plain
Cancel/Confirm — file/asset/minutes remove, event cancel). Justified
because `DELETE /me` is the only action in the whole app that is neither
scoped to a single org nor recoverable by re-creating a row — it
anonymizes the account and revokes every session across every
organization the user belongs to.

`GET /me/export` returns a synchronous, non-persisted JSON object — no
storage row, no signed URL. Modeled as a `useMutation` (fires on click)
rather than a `useQuery`, with `onSuccess` building a `Blob` and
triggering a browser download via a transient `<a>` element — this app's
first client-generated file download (every prior download — certificates,
files — fetches a server-signed MinIO URL instead).

### Live verification exercised both branches of an irreversible endpoint

`DELETE /me` has two outcomes: a 409 when the caller is the sole active
PRESIDENT of any org, or a real anonymization otherwise. Both were driven
for real: the PRESIDENT test account hit the 409 (backend message
rendered verbatim in the dialog, dialog stays open, confirm text
preserved), and the PARTICIPANT test account — confirmed via direct DB
query to hold no PRESIDENT membership anywhere first — was actually
deleted, producing the real success path (`clearSession()` +
`router.replace('/login')`), then reverified anonymized in the database
afterward. Driving only the 409 case would have left the success path,
arguably the riskier of the two, unverified.

### Pre-existing typecheck gap, fixed incidentally

Task 1 touched the shared `Organization` type, and running
`tsc --noEmit` (part of every task's verification step across this whole
project) surfaced 5 pre-existing failures in `lib/__tests__/api.test.ts`
(`TS18046 'err' is of type 'unknown'`) that had sat invisible since
those tests were written — `npm test` alone doesn't typecheck, so nothing
had caught them until a task happened to touch a type broad enough to
force a full-repo `tsc` pass. Fixed inline (cast the caught error to
`ApiError` at each assertion) since it blocked Task 1's own verification
step, not because it was in scope — the same "fix it, it's small and
blocking" call this project made for isolated pre-existing bugs before
(e.g. the `'MEMBER'`-vs-`'PARTICIPANT'` fixture bug in Slice 10).

### Test baseline

Frontend 145/145 (19 new: 2 role-tier truth-table tests, 4
`validateBrandingImage` cases, 10 profile/color schema cases, 3
delete-confirm-text matcher cases). Live verification: full profile edit
(name/description/social-links-add-remove/advisors-add) with a real
save→reload→persisted cycle; logo and banner upload with real PNG bytes,
preview updating each time; an unsupported file type rejected client-side
with no network call; logo removed and confirmed reverting to the
placeholder icon while banner stayed untouched; colors edited as
PRESIDENT with the sidebar's `--primary` CSS custom property confirmed
picking up the new value live (no reload needed); VP confirmed seeing the
color fields disabled with the hint text; My Account's consent history
showing a real row, data export producing a real downloadable JSON file
with all expected top-level keys, and both `DELETE /me` branches proven as
described above; a PARTICIPANT account confirmed seeing only the My
Account tab with no tab-switcher control rendered at all (not just a
hidden Organization tab); both themes screenshotted clean, disabled color
fields legible in both. Zero code bugs. Backend untouched: 101 unit / 327
e2e (Slice 11's baseline, unchanged).

**What's real after Slice 12:** everything from Slices 1–11, plus full
Settings — organization profile/branding/color management across three
RBAC tiers, and My Account PDPA actions (consent history, data export,
account deletion) available to every member regardless of role. **No
placeholder routes remain anywhere in the frontend.**

## Slice 13 — Public Club Page (shipped)

**Scope:** first of three Public Club Page sub-slices — a new
unauthenticated `/club/[orgSlug]` route (org profile, upcoming events,
gallery grid, achievements list). Gallery management and Achievements
management (committee-side CRUD) remain the next two, same decomposition
shape as the Workspace split.

### The first route in this app with zero auth requirement

Every prior route lives inside `(app)`, gated by `AppLayout`'s session
check, or is the login/register/consent flow itself (which still expects
*some* credential exchange). `/club/[orgSlug]` is genuinely public: no
`OrgProvider`, no sidebar/topbar, no `AppLayout` guard — it's a sibling
top-level segment under `app/`, not nested inside `(app)` at all. No
dedicated `layout.tsx` was added for it either; the root `app/layout.tsx`
(fonts, theme-init script, `QueryProvider`, `globals.css`) already covers
every route including this one, so an empty pass-through layout file
would have added nothing.

This also makes it this app's first frontend surface where the
live-verification checklist needed a genuinely new check, not just a new
instance of an existing one: **does this work with zero authentication at
all**, verified by clearing `localStorage` (the refresh token's only
persistence layer) and confirming the page still renders and only ever
calls the three unguarded `/public/organizations/:orgSlug/*` endpoints —
no auth header, no 401, no login redirect.

### A real, risk-free backend change made during brainstorming

`PublicController`'s three routes were keyed on `:orgId` (a UUID) with no
public slug-to-id lookup anywhere in the backend — a public page meant to
be shared and remembered would otherwise ship as `/club/<uuid>`. Since
nothing consumed these routes yet (zero frontend existed), the param was
renamed to `:orgSlug` and `PublicService.requireOrganizationBySlug`
resolves via `Organization.slug` (already `@unique`) instead of `id`. Both
existing e2e specs were updated in place, keeping the same 7 tests
slug-keyed rather than id-keyed — no test added, none removed. This is
the second time a frontend slice has touched backend code (after Slice
6's bug fix), but a different category: a planned, zero-risk rename
decided at design time, not a defect found live.

### Free-form data, same rendering choice as Settings

`socialLinks`/`advisors` are rendered here exactly as Slice 12's editor
assumed them — a free-form `Record<string,string>` (rendered as a row of
labeled links keyed by whatever platform name the committee typed) and a
plain `string[]` (rendered as a bulleted list) — no fixed platform set or
advisor-title field invented on either the write or read side.

### Raw `<img>`, not `next/image`

`next/image`'s `<Image>` component has never appeared anywhere in this
codebase — every image (QR codes, certificates, branding previews,
gallery thumbnails) uses a plain `<img>` with an
`eslint-disable-next-line @next/next/no-img-element` comment. The hero
banner/logo and gallery grid follow the same pattern rather than
introducing `<Image>` for the first time, partly for consistency and
partly because Next 16 ("not the Next.js you know" per this repo's own
`AGENTS.md`) makes any first use of an unverified API a real risk to
front-load into a slice that doesn't need it — these are already-signed,
5-minute-expiring MinIO URLs that gain nothing from Next's image
optimizer regardless.

### An investigated false alarm: an em dash that looked corrupted

During live verification, `curl`-ing the public profile endpoint and
inspecting it with a quick Python one-liner showed the org description's
em dash as a replacement character. Rather than assume a real encoding
bug, this was root-caused: `psql` showed the correct character stored in
Postgres, and a raw hex dump of the actual HTTP response bytes showed the
exact correct UTF-8 sequence (`e2 80 94`) — the corruption existed only in
how the terminal/Python pipeline rendered it, never in the data or the
API. The browser (confirmed via every screenshot) always displayed it
correctly. Same category of lesson as Slice 8's screenshot-compression
false alarm — confirm at the byte or DOM level before calling something a
defect, regardless of which tool is doing the misleading rendering.

### Test baseline

Frontend 145/145 (no new tests — this slice is presentational/read-only
with no form schemas or branching logic to unit-test, matching the plan's
expectation going in). Live verification: seeded real gallery photos,
two achievements, one `PUBLISHED` and one `DRAFT` event via the API
directly; confirmed the public page rendered banner/logo/name/description/
social-links/advisors, the `PUBLISHED` event only (the `DRAFT` one never
appeared), both gallery photos linking to their real signed URLs, and
both achievements sorted year descending; confirmed fully logged out (see
above); confirmed the unknown-slug path renders "Club not found" with no
crash or redirect loop; confirmed Settings' new "View public page"/"Copy
link" additions work and open/copy the correct URL; both themes
screenshotted clean. Backend: 101 unit / 327 e2e (same totals as Slice
12's baseline — the two public e2e spec files were modified in place, not
added to).

**What's real after Slice 13:** everything from Slices 1–12, plus a real
public-facing club page at `/club/[orgSlug]`, linked from Settings.
Gallery management and Achievements management remain the next two Public
Club Page sub-slices.

## Slice 14 — Gallery Management (shipped)

**Scope:** second of three Public Club Page sub-slices — full
committee-side management (upload, list, remove) for the already-shipped
`GalleryController`. Achievements management remains the last.

### A new nav area, deliberately not a Workspace tab

A fresh committee-only "Public Page" sidebar item, tabbed Gallery (built)
/ Achievements (placeholder), rather than a fourth Workspace tab.
Workspace's three existing tabs (Files, Minutes, Assets) are all internal
ops tooling for the committee itself; Gallery and Achievements curate the
content that appears on the public `/club/[orgSlug]` page from Slice
13 — a different audience and purpose, even though the RBAC tier
(`MANAGE_EVENTS`) is identical. No domain hue was added for the nav icon:
the seven domain hues (events/registrations/attendance/certificates/
feedback/analytics/ops) are all already assigned, and this codebase's own
convention (stated directly in `nav-items.ts`'s comment) is not to extend
that set per-page — Public Page stays neutral, same as Members/Settings.

### No auth-leak-guard needed — a first among resolver-adjacent features

Every prior list-with-identity feature (Files' uploader, Assets' creator,
Minutes' attendees) needed the `members.isError ? 'Committee member' :
resolveXName(...)` guard because the list response included a raw
user/membership id that had to be cross-referenced against the
`VIEW_MEMBERS`-gated members list. `GalleryService.list()` returns
`{id, caption, downloadUrl, createdAt}` only — confirmed by reading the
backend source at design time — so there was never an identity field to
resolve or leak in the first place. `GalleryGrid` needs no `useMembers`
call at all.

### Nav-gated, not route-gated — Workspace's pattern reused directly

The "Public Page" nav link is committee-only, but the page itself doesn't
redirect a non-committee visitor navigating there directly — it renders
the Gallery grid read-only (no upload form, no Remove buttons), exactly
mirroring how Files/Minutes/Assets have behaved since Slice 9: nav
visibility and backend RBAC are two separate, independently-correct
gates, and the frontend never conflates "not linked from the sidebar"
with "not accessible."

### Inline upload, no dialog — same call as Settings' BrandingPanel

`GalleryUploadForm` is a plain inline form (native file input + optional
caption + Upload button) above the grid, not a modal — the same choice
Slice 12's `BrandingPanel` made and for the same reason: a single simple
upload action has no dialog-lifecycle state worth managing, and this
sidesteps Slice 9's `UploadFileDialog` reset-bug class by construction
rather than by careful reset logic.

### Two operational detours, neither a code bug

The docker compose stack had stopped again since Slice 13's session (the
same recurring host-sleep/restart gotcha, now confirmed a third time) —
`docker compose ps` showed no containers at the start of live
verification, fixed with `docker compose up -d`.

More notably: Playwright's pointer-based `.click()` on the sidebar's
theme-toggle button was reliably intercepted by an invisible
`<nextjs-portal>` element (Next.js's dev-mode overlay), even when
targeting exact button coordinates via `page.mouse.click()` and even
after explicitly closing the overlay's visible panel. Four consecutive
pointer-based attempts failed — past this project's own "3+ failed
fixes" threshold for stopping and reconsidering rather than trying a
fifth variation of the same approach. Keyboard activation
(`.focus()` + `Enter`) bypasses pointer hit-testing entirely and worked
on the first attempt. The underlying theme mechanism itself (a Zustand
`persist` store, unmodified since Slice 1) was never in question — it had
already been proven working with a real click in Slice 12's own live
verification using this identical button.

### Test baseline

Frontend 149/149 (4 new: `validateGalleryImage`'s valid-PNG/valid-JPEG/
rejected-MIME/oversized cases, mirroring `validateBrandingImage`'s exact
shape). Live verification: uploaded a real photo with a caption
(appeared immediately in the grid); an unsupported file type was
rejected client-side with the network log confirming zero requests for
that attempt (only one real `POST /gallery` fired, for the valid
upload); removed a photo with confirm; confirmed the Achievements
placeholder text; confirmed a fresh PARTICIPANT test account (the
original Slice 12 one had been genuinely deleted during that slice's own
live verification of account deletion) sees no "Public Page" nav link
but gets read-only access via direct URL; confirmed a freshly-uploaded
photo actually appeared on the real `/club/[orgSlug]` page from Slice
13, closing the loop between the two sub-slices; both themes
screenshotted clean once the theme-toggle interaction issue above was
worked around. Zero code bugs. Backend untouched: 101 unit / 327 e2e
(Slice 13's baseline, unchanged).

**What's real after Slice 14:** everything from Slices 1–13, plus full
Gallery management under a new "Public Page" nav area — upload, view,
and remove, correctly RBAC-gated. Achievements management remains the
last Public Club Page sub-slice.

## Slice 15 — Achievements Management (shipped)

**Scope:** third and last of three Public Club Page sub-slices — full
committee-side management (create, list, update, remove) for the
already-shipped `AchievementsController`. Replaces the Achievements tab
placeholder shipped in Slice 14. Completes the epic.

### Modal-dialog CRUD, mirroring Assets exactly

`AchievementDialog` is conditionally-mounted (no `open` prop — the caller
renders it only while a dialog is in use), the same reset-bug-avoidance
shape as Slice 10's `AssetDialog`. `year` is handled as a string form
field with a `.refine()` check converting to an integer at submit —
identical pattern to Assets' `quantity` field. No year bound beyond
`Number.isInteger` is enforced: the backend DTO only checks `@IsInt()`
with no min/max either side, so the frontend doesn't invent a stricter
rule than the backend actually enforces.

### No auth-leak-guard needed — the field is simply never rendered

`AchievementsService.list()` returns the full Prisma row, including
`createdByUserId` — the same shape of risk Assets carries. But
`AchievementsList` renders only `title`/`year`/`description`; the
`createdByUserId` field exists in the data and is simply never read by
any component. No `useMembers` call, no name-resolution helper, no
`members.isError ? 'Committee member' : ...` guard — there is nothing to
resolve because nothing referencing member identity is ever displayed.
This is the second Public Club Page sub-slice (after Gallery) where the
usual Files/Assets/Minutes resolver-guard pattern doesn't apply, but for
a different reason: Gallery's response has no identity field at all,
while Achievements' response has one that the UI just never touches.

### Nav-gated, not route-gated — the same pattern, a third time

The "Public Page" nav link is committee-only; a non-committee visitor who
navigates directly to the URL sees the Achievements tab read-only (no Add
button, no Edit/Remove per row) rather than a redirect — identical to how
Gallery (Slice 14) and Workspace's tabs (Slice 9+) already behave.

### A recurring operational detour, not a code bug (third occurrence)

The sidebar's theme-toggle button was again intercepted by the
`<nextjs-portal>` dev-overlay hit-region on the first pointer-based click
attempt during the dark/light screenshot check. This time the fix was
applied immediately — keyboard activation (`.focus()` + `Enter`) — rather
than retrying the pointer approach multiple times first, since the root
cause and fix were already established in Slice 14. The underlying theme
mechanism itself remains unmodified since Slice 1.

### Test baseline

Frontend 154/154 (5 new: `achievementFormSchema`'s valid-submission/
empty-title/empty-description/non-integer-year/empty-year cases). Live
verification used fresh PRESIDENT and PARTICIPANT accounts registered
directly via the API — the database's existing rows were all ephemeral
e2e-test artifacts from prior automated test runs, with unknown
passwords, not usable for manual login. Added two achievements and
confirmed year-desc sort; edited one (year + description) and confirmed
the dialog pre-filled with its current values and the change persisted
after a full page reload; removed the other with the confirm dialog;
confirmed the PARTICIPANT account has no "Public Page" nav link but
reaches the page read-only via direct URL, with no Add/Edit/Remove
controls; confirmed the edited achievement appears correctly on the real
`/club/[orgSlug]` public page from Slice 13 — closing the loop across all
three Public Club Page sub-slices end-to-end. Both themes screenshotted
clean. Zero code bugs. Backend untouched: 101 unit / 327 e2e (unchanged).

**What's real after Slice 15:** everything from Slices 1–14, plus full
Achievements management — create, edit, remove, correctly RBAC-gated.
**This completes the entire Public Club Page epic:** Public Club Page
(13), Gallery Management (14), and Achievements Management (15) are all
shipped. No placeholder tabs remain anywhere in the app.

## Slice 16 — Committee Handover Pack (shipped)

**Scope:** last unshipped item on Phase 2 — Organization Workspace. A
single committee-side action wired to the already-shipped
`HandoverController` (`GET /organizations/:orgId/handover`), which streams
a generated PDF bundling committee roster, recent meeting minutes, asset
inventory, key files, and upcoming events. Completes Phase 2 entirely.

### A genuinely new client capability: binary download

Every prior frontend download (Files, Certificates) went through a
signed-URL indirection: the API returns `{ downloadUrl }` as JSON, and the
frontend redirects to that URL. The handover endpoint is different — it
streams the PDF directly, no signed URL involved — so `api()` in
`frontend/lib/api.ts`, which always JSON-parses the response body,
couldn't be reused. Added `apiDownloadBlob(path): Promise<Blob>`, a
sibling to `api()`/`apiUpload()` sharing the same internal `request()`
helper (bearer token attach + 401→refresh→retry cycle) but returning
`res.blob()` on success and parsing the JSON error body on failure
exactly like `api()` does. This is the first binary (non-JSON, non-
FormData) client capability in the codebase.

### Component mirrors an existing precedent almost verbatim

`HandoverPackButton` copies `components/account/export-data-button.tsx`'s
shape closely: same `Button` + `Loader2` spinner while pending, same
inline `role="alert"` error text, same `URL.createObjectURL` + throwaway
`<a download>` + `URL.revokeObjectURL` trigger pattern. The only
difference is the payload — PDF bytes via `apiDownloadBlob` instead of a
JSON blob via `api()`. Recognizing this precedent before writing any code
turned what could have been a from-scratch design into a five-minute
adaptation.

### No RBAC check needed inside `OrganizationTab`

The whole "Organization" tab is already gated to `isCommittee` at the
`SettingsPage` level, matching the backend's `MANAGE_EVENTS` tier on
`HandoverController` exactly — the same reasoning already established for
the Workspace tabs (Files/Minutes/Assets) and reused again here without
modification.

### A test-fixture bug, caught before shipping — not a code bug

The first `apiDownloadBlob` test built a mock `Response` via `new
Response(new Blob([...], { type: 'application/pdf' }), { status: 200 })`
and asserted the resulting blob's `type` was `'application/pdf'`. It
wasn't — Vitest/jsdom's `Response` constructor doesn't propagate a source
`Blob`'s own `type` into the response body unless the response's own
`Content-Type` header is set explicitly. Root-caused rather than loosened:
fixed the fixture to set `headers: { 'Content-Type': 'application/pdf' }`
directly, which also more faithfully mirrors how the real
`HandoverController` behaves (`@Header('Content-Type', 'application/pdf')`).
The `apiDownloadBlob` implementation itself was correct from the first
attempt; only the test fixture needed the fix.

### Test baseline

Frontend 157/157 (3 new: `apiDownloadBlob`'s success/401-refresh-retry/
error-parsing cases, added to the existing `lib/__tests__/api.test.ts`).
No component test for `HandoverPackButton` — matches `ExportDataButton`'s
own untested precedent. Live verification: both dev servers had actually
stopped since the previous session even though the docker compose stack
was still up (a variant of the recurring stopped-environment gotcha —
this time the app servers, not the containers); started both, then
downloaded a real handover pack as PRESIDENT from a freshly-created org
and confirmed via `pdftotext` that the PDF content exactly matched the
org's real data, including "None" rendering correctly for every empty
section on a brand-new org; confirmed the button's disabled/spinner state
while pending via direct DOM inspection (the request completes too fast
for a manual click-then-snapshot cycle to observe it); confirmed a
PARTICIPANT account still has no "Organization" tab at all; both themes
screenshotted clean. Zero code bugs. Backend untouched: 101 unit / 327
e2e (unchanged).

**What's real after Slice 16:** everything from Slices 1–15, plus the
Committee Handover Pack download action. **This completes Phase 2 —
Organization Workspace entirely, backend and frontend both** — every item
on `docs/roadmap.md`'s Phase 2 list is now shipped. Phase 3 remains
unscoped.
