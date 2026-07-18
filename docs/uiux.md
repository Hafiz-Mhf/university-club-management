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
