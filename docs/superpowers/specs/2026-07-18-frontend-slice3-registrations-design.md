# Frontend Slice 3 — Registrations (Design)

Status: approved, pending write-up review
Depends on: Slice 1 (Foundation), Slice 2 (Events)

## Scope

Full registrations feature: registration form builder (committee defines
custom fields per event), self-registration (register / view status /
cancel), and committee registration management (list + reject). This is the
piece carved out of Slice 2 by its "Events only" scoping decision.

Out of scope: attendance/QR check-in (separate future slice, reads
`Attendance` rows that are auto-managed off registration status — no
frontend work needed to make that data correct). Adding name/email to the
committee registration list is out of scope — ships with `userId`; a backend
join is a fast-follow, not part of this frontend-only slice.

## Backend contract (as verified against controller/service/e2e, not assumed)

- `POST /organizations/:orgId/events/:eventId/registrations` — any
  authenticated user, no membership required beforehand (auto-enrolls as
  PARTICIPANT). Body `{ answers?: Record<string, string | string[]> }`.
  404 if event missing or not `PUBLISHED`. 409 on duplicate registration.
  400 on answer validation failure (missing required field, checkbox not
  accepted, invalid select value, or answers submitted with no form).
- `GET /organizations/:orgId/events/:eventId/registrations/me` — any org
  member, returns the caller's own registration or a "not registered"
  response. **Edge case:** on a foreign/cross-org eventId this can return
  200 with an empty body rather than JSON `null` — the data layer must treat
  both an empty body and a `null` payload as "not registered," never throw.
- `GET /organizations/:orgId/events/:eventId/registrations` — MANAGE_EVENTS
  tier only (`PRESIDENT, VICE_PRESIDENT, SECRETARY, TREASURER,
  EVENT_DIRECTOR, COMMITTEE`). Lists all registrations, `createdAt asc`.
- `POST /organizations/:orgId/events/:eventId/registrations/:id/cancel` —
  any org member, service enforces ownership (403 if not the owner). 409 if
  already `CANCELLED`/`REJECTED`.
- `POST /organizations/:orgId/events/:eventId/registrations/:id/reject` —
  MANAGE_EVENTS tier only. 409 if already terminal.
- `PUT|GET|DELETE /organizations/:orgId/events/:eventId/registration-form` —
  PUT/DELETE are MANAGE_EVENTS-only; GET is any org member. GET returns JSON
  `null` (not empty body) when no form exists. PUT full-replaces the field
  list. 409 `Completed or cancelled events cannot have their form edited` on
  a COMPLETED/CANCELLED event.

Status values: `APPROVED | WAITLISTED | REJECTED | CANCELLED`. `PENDING` is
defined in the schema but never emitted by this service — excluded from the
frontend `RegistrationStatus` union. **There is no manual "approve" action.**
Approval is automatic at registration time (capacity check: under capacity →
`APPROVED`, at/over capacity → `WAITLISTED`, `capacity: null` = unlimited)
and waitlist promotion is automatic (oldest `WAITLISTED` row promoted
whenever an `APPROVED` registration is cancelled or rejected). The frontend
never calls an approve endpoint and never shows an "approve" button —
committee's only action on a registration is reject.

Field types: `TEXT | TEXTAREA | SELECT | CHECKBOX`, each with `label`,
`required`, `order`, and `options` (SELECT only).

## Data layer

`types/api.ts` additions: `Registration`, `RegistrationStatus`,
`RegistrationForm`, `FormField`.

`features/registrations/use-registrations.ts`:
- `useMyRegistration(orgId, eventId)` — GET /me, normalizes empty-body and
  JSON-null responses to `null` uniformly.
- `useRegistrations(orgId, eventId)` — GET list, MANAGE_EVENTS gated at the
  call site (component checks role before rendering the tab at all).
- `useRegisterForEvent(orgId, eventId)`, `useCancelRegistration(orgId,
  eventId)`, `useRejectRegistration(orgId, eventId)` — mutations,
  invalidate `['org', orgId, 'event', eventId, 'registrations']` (list),
  `['org', orgId, 'event', eventId, 'registrations', 'me']`, and
  `['org', orgId, 'event', eventId]` (registrationCount on the event object
  itself, shown elsewhere in the UI).

`features/registrations/use-registration-form.ts`:
- `useRegistrationForm(orgId, eventId)`, `useUpsertRegistrationForm(orgId,
  eventId)`, `useDeleteRegistrationForm(orgId, eventId)`.

`features/registrations/schemas.ts`:
- `registrationFormSchema` — Zod schema for the form-builder editor itself
  (array of field editors: label min-length, type enum, options
  required-and-non-empty when type is SELECT).
- `buildAnswerSchema(fields: FormField[])` — builds a Zod object schema at
  runtime from an event's actual `FormField[]`, mirroring backend's
  `validateAnswers`: required TEXT/TEXTAREA/SELECT must be non-empty,
  required CHECKBOX must be `true`, SELECT value must be one of `options`.
  Used by the registration dialog's React Hook Form resolver.

## Event detail page restructure

Add shadcn `Tabs` (not yet installed — `npx shadcn@latest add tabs`).
Committee (`isCommittee(role)`) sees three tabs: **Overview** (today's
content, unchanged), **Registration Form** (builder), **Registrations**
(list + reject). Non-committee users see no tabs — just today's Overview
content, with the self-registration block added beneath the description.

## Self-registration (Overview tab, all users)

Driven by `useMyRegistration`:
- No registration + `event.status === 'PUBLISHED'` → "Register" button.
- No registration + event not published → nothing rendered (mirrors
  backend: can't register for a non-published event).
- Has registration → status badge (semantic tokens, same family as
  `EventStatusBadge`: APPROVED=success, WAITLISTED=warning, REJECTED=danger,
  CANCELLED=neutral) + "Cancel my registration" button when status is
  APPROVED or WAITLISTED (not shown once already CANCELLED/REJECTED).
  Cancel goes through the existing `Dialog` confirm pattern from Slice 2's
  `LifecycleActions`.

Register button opens a `Dialog`:
- If `useRegistrationForm` returns a form, render its fields via React Hook
  Form + `buildAnswerSchema(form.fields)` (TEXT/TEXTAREA as text inputs,
  SELECT as a `Select`, CHECKBOX as a `Checkbox`).
- If no form, the dialog is just a confirm message ("Register for
  <event title>?").
- Submit calls `useRegisterForEvent`. Surface `ApiError` messages inline in
  the dialog: 409 duplicate, 400 validation (field-level where possible,
  form-level fallback otherwise).

## Registration Form tab (committee)

`RegistrationFormEditor` component: ordered list of field-editor rows
(label text input, type select, required checkbox, and an options
list-editor shown only when type is SELECT — add/remove/edit option
strings). Row-level controls: remove, move up, move down (no drag-and-drop
dependency). Toolbar: "Add field" button, "Save" button
(`useUpsertRegistrationForm`, full-replace semantics matching the PUT).

Empty state when no form exists: "No custom form — participants can
register with one click" + "Create form" CTA that seeds one empty field row.

The whole tab is disabled (fields read-only, no Save/Add) when
`!canEdit(event.status)` (COMPLETED/CANCELLED), matching the backend's own
409 guard — avoids a round-trip just to learn the event is locked.

## Registrations tab (committee)

Plain table, columns: participant (`userId`, truncated/mono styling — no
name/email available from this endpoint), status badge, submitted date
(`relativeTime`, reusing the Slice 1 dashboard helper), answers preview
(rendered as `label: value` pairs by joining the registration's `answers`
keys against the event's `RegistrationForm.fields` for labels; falls back to
the raw key if the form was since deleted/changed).

Status filter: segmented control / tab row (All / Approved / Waitlisted /
Rejected / Cancelled), client-side filtering over the already-fetched list —
same precedent as Slice 2's events list filter. No text search (registration
lists per event are expected to be small).

Reject action: button per row, hidden once the row is already
CANCELLED/REJECTED, `Dialog` confirm before calling `useRejectRegistration`.

## Testing

Unit (Vitest + RTL): `buildAnswerSchema` (required/optional, each field
type, SELECT option validation) and the GET-/me empty-body/null
normalization — both are logic-bearing units in the sense established by
Slices 1–2. Role-gating reuses `isCommittee`, already covered by Slice 2's
tests.

Live verification (Playwright against the real dev server, both themes):
committee creates a form with one of each field type on a fresh event and
publishes it → second account registers, fills the form, sees APPROVED
status and a working cancel button → cancel promotes correctly is already
proven at the backend level (e2e), but verify the frontend reflects the
post-cancel state (registration disappears from the list / a waitlisted
account's status flips to APPROVED after refetch) → third account registers
into a capacity-1 event that's already full, confirm WAITLISTED badge
renders → committee views the Registrations tab, filters by status, rejects
the WAITLISTED registration, confirms it moves to REJECTED in the table →
attempt to edit the form on a COMPLETED event, confirm the tab is read-only
rather than erroring.

## Non-negotiables carried over

Tenant isolation, RBAC (MANAGE_EVENTS reused, no new role group — matches
backend), no personal data beyond what the API already returns, audit
trail is backend-only (frontend doesn't log). Domain hue for
Registrations is **blue** per `design.md`'s existing seven-hue table — used
on tab icons/badges only, never backgrounds, never colliding with the
semantic status tokens used for registration-status badges.
