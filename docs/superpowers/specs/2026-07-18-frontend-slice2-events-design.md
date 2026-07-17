# Frontend Slice 2 — Events — Design

Second frontend slice, built on Slice 1's foundation (tokens, auth, org
context, app shell). Replaces the `Events` placeholder route with a real
feature: list, create, edit, and lifecycle management for events.

**In:** events list (search + status filter + upcoming/past view), event
detail with role/status-gated lifecycle actions (publish/complete/cancel/
delete), create/edit form, DRAFT-visibility handling, terminal-state
immutability reflected in the UI.

**Out (later slices, do not build):** registration form builder,
self-registration flow, registration list/approve/reject (Slice 3) — event
banner upload (no backend endpoint exists for it yet, `Event.bannerKey` is
unused by every controller) — attendance/QR, certificates, feedback,
analytics (further slices, unrelated to this one).

---

## Backend contract (as shipped, grounds this spec)

`EventsController` (`organizations/:orgId/events`):

| Route | Guard | Notes |
|---|---|---|
| `POST /` | MANAGE_EVENTS | creates `DRAFT`; 400 if `endAt <= startAt` |
| `GET /` | any org member | DRAFT rows filtered out server-side for non-committee; **no pagination**, full array, `orderBy startAt desc` |
| `GET /:eventId` | any org member | DRAFT event → 404 for non-committee (no existence leak) |
| `PATCH /:eventId` | MANAGE_EVENTS | 409 if event is COMPLETED/CANCELLED; 400 if resulting `endAt <= startAt` |
| `POST /:eventId/publish` | MANAGE_EVENTS | DRAFT→PUBLISHED only; 409 if `endAt` already past |
| `POST /:eventId/complete` | MANAGE_EVENTS | PUBLISHED→COMPLETED only |
| `POST /:eventId/cancel` | MANAGE_MEMBERS (stricter than the rest) | DRAFT\|PUBLISHED→CANCELLED only |
| `DELETE /:eventId` | MANAGE_MEMBERS | any status |

`CreateEventDto`: `title` (string, min 2), `description?`, `venue?`,
`startAt`/`endAt` (ISO 8601), `capacity?` (int ≥1). `UpdateEventDto`: all
optional, plus `requireFeedbackForCertificate?` (boolean — already exposed
by the backend for a later feedback-gating slice; this slice's form does
**not** surface it yet, since there's no feedback UI to explain it against).

`EventStatus`: `DRAFT | PUBLISHED | COMPLETED | CANCELLED`. Row shape: `id,
organizationId, title, description, venue, startAt, endAt, capacity,
bannerKey, status, requireFeedbackForCertificate, createdByUserId,
createdAt?, updatedAt?` (exact timestamps TBD from a live response check
during Task 1 — add to `types/api.ts` as actually returned).

**Cancel/Delete role split:** cancel and delete both require MANAGE_MEMBERS
(stricter than MANAGE_EVENTS, which only covers create/edit/publish/
complete) — mirrors the existing backend split documented in
`docs/security.md`. The frontend's `isCommittee()` helper (`MANAGE_EVENTS`
tier) is **not** sufficient to gate these two buttons; a second role check
is needed (see Architecture).

---

## Architecture

### Role tiers (extends `features/orgs/roles.ts`)

Slice 1 only distinguishes `committee` (MANAGE_EVENTS tier) vs `member`.
This slice needs the finer MANAGE_MEMBERS tier for cancel/delete. Add
`MANAGE_MEMBERS_ROLES` (President, Vice President, Secretary, Treasurer,
Event Director — mirrors backend `role-groups.ts`) and `canManageMembers()`
alongside the existing `isCommittee()`. Buttons for publish/complete (create/
edit-tier actions) gate on `isCommittee()`; cancel/delete gate on the new
`canManageMembers()`.

### Data layer — `features/events/`

- `use-events.ts`: `useEvents(orgId)` (list), `useEvent(orgId, eventId)`
  (detail), `useCreateEvent(orgId)`, `useUpdateEvent(orgId, eventId)`,
  `usePublishEvent`, `useCompleteEvent`, `useCancelEvent`, `useDeleteEvent`
  — all mutations invalidate `['org', orgId, 'events']` and (where
  applicable) `['org', orgId, 'event', eventId]` on success.
- `schemas.ts`: Zod schema mirroring `CreateEventDto`/`UpdateEventDto`,
  plus a `refine` enforcing `endAt > startAt` client-side (the backend's own
  check is the source of truth; this is just fail-fast UX).
- `status.ts`: pure helpers — `canEdit(status)`, `canPublish(status)`,
  `canComplete(status)`, `canCancel(status)`, `canDelete(status)` (delete has
  no status restriction — always true, kept as a named helper for
  readability at call sites) — each a one-line status check, unit tested.

### Routes

- `app/(app)/[orgSlug]/events/page.tsx` — list (replaces the Slice 1
  placeholder).
- `app/(app)/[orgSlug]/events/new/page.tsx` — create form. Route itself
  isn't guarded (any authenticated org member can navigate there), but the
  page redirects non-committee visitors to `/events` — the backend would
  403 the POST anyway; this avoids showing a form that can't submit.
- `app/(app)/[orgSlug]/events/[eventId]/page.tsx` — detail.
- `app/(app)/[orgSlug]/events/[eventId]/edit/page.tsx` — edit form, same
  redirect-if-not-committee guard, plus redirect-to-detail if the event is
  COMPLETED/CANCELLED (edit isn't offered on terminal events at all, not
  just disabled).

### List page

- Search input (client-side substring match on `title` — list is unpaginated
  and bounded per org, same reasoning as Asset Management's unpaginated
  list in `docs/security.md`).
- Status filter (`All / Draft / Published / Completed / Cancelled` — a
  non-committee viewer's data never contains DRAFT rows, so that option is
  simply always empty for them, not hidden — consistent with "don't invent
  UI branches the data can't produce, but don't lie about what exists
  either").
  Actually: hide the `Draft` filter option entirely for non-committee — a
  filter option that can never match anything is confusing UI, not
  transparency. (Self-review note: resolved during writing, see below.)
- Segmented Upcoming/Past view (computed client-side from `startAt` vs
  `now`, default Upcoming) — the backend doesn't split this itself.
- Card per event: title, status badge, formatted date/venue, registration
  count is **not shown** here (that's a Slice 3 concern — `Event` rows from
  `GET /` don't carry a registration count, unlike the Dashboard's
  `upcomingEvents` widget which does via a `_count` select Slice 1 already
  wired).
- Committee: "Create event" button → `/events/new`.
- Empty state: "No events yet" (+ "No events match your search/filter" when
  filters are active and produce zero rows — distinct message).

### Detail page

- Header: title, status badge, edit button (committee, hidden on terminal
  status) linking to `/edit`.
- Body: description, venue, formatted start/end, capacity (or "Unlimited").
- Lifecycle action bar, one visible button per legal transition from the
  current status + role (never a disabled button for an illegal transition —
  it simply isn't rendered):
  - DRAFT + committee → **Publish**.
  - PUBLISHED + committee → **Complete**.
  - DRAFT or PUBLISHED + MANAGE_MEMBERS-tier → **Cancel** (confirm dialog:
    "Cancel this event? Registrants will be notified." — matches backend's
    actual side effect, no invented copy).
  - Any status + MANAGE_MEMBERS-tier → **Delete** (confirm dialog,
    destructive-styled, "This cannot be undone.").
- 409 on publish (event's `endAt` already past): surfaces as a toast/inline
  error with the backend's message, not a generic failure.
- **404 handling:** `useEvent` returning a 404 `ApiError` renders a small
  "Event not found" page (not the global error boundary) — this is the
  expected shape for a DRAFT event a non-committee user can't see, not
  necessarily a bug.

### Create/Edit form

Single `EventForm` component parameterized by mode (`create` | `edit`):
title, description (textarea), venue, start/end (datetime-local inputs),
capacity (optional number, "Unlimited" when empty). Validation errors render
inline per-field (Slice 1's established pattern from the auth forms). Submit
error surfaces the backend's message verbatim for 400s (e.g. "endAt must be
after startAt") since it's already user-legible.

---

## Testing

Vitest + RTL, logic-bearing only (Slice 1's established bar):

- `status.ts` helpers: one assertion per status × per action (small, exact
  truth table — DRAFT can publish/cancel/delete/edit, not complete;
  PUBLISHED can complete/cancel/delete/edit, not publish; COMPLETED can
  delete only; CANCELLED can delete only).
- `schemas.ts`: `endAt > startAt` refine rejects equal/earlier `endAt`.
- `roles.ts` addition: `canManageMembers()` truth table (same shape as
  existing `isCommittee()` tests, extended).

No component-level tests for the list/detail/form pages themselves (Slice 1
precedent: pages are integration-tested live via dev-server + Playwright
screenshots during execution, not unit-rendered) — this slice's plan will
include the same live-verification step Slice 1 used (register/login,
create org, create/publish/cancel an event, screenshot both themes) rather
than adding component-test infrastructure that doesn't exist yet.

---

## Self-review notes

Two things caught and resolved while writing this spec (not left as open
questions):

1. **Draft filter visibility** — initially planned to always show a "Draft"
   filter option in the status dropdown even for users whose data can never
   contain a DRAFT row. Changed: the option is omitted entirely for
   non-committee viewers, since an always-empty filter choice is confusing,
   not honest.
2. **Cancel/Delete role tier** — initially assumed `isCommittee()`
   (MANAGE_EVENTS) covered every lifecycle button. Re-checked
   `EventsController` directly and found cancel/delete are actually gated
   `MANAGE_MEMBERS`, one tier stricter — per `docs/security.md`'s existing
   "create/edit vs destructive split" note for this exact module. Added
   `canManageMembers()` to the architecture rather than shipping a frontend
   that offers a Cancel/Delete button to a Committee-tier (non-MANAGE_MEMBERS)
   user that would 403 on click.
