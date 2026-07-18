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
