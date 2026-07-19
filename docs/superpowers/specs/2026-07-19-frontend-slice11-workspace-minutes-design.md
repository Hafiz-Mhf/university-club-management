# Frontend Slice 11 (Workspace — Meeting Minutes) — Design

## Context

Third and last of three Workspace sub-slices (Workspace bundles three
independent backend subsystems behind one nav item — split the same way
Events/Registrations was in Slice 2/3). File Repository shipped in Slice 9,
Asset Management in Slice 10. This spec covers **Meeting Minutes only** —
the most involved of the three, per the original scoping note in Slice 9's
spec (nested agenda/action-item arrays, an attendee picker, pagination).

## Scope

Full frontend surface for the already-shipped `MinutesController`: create,
paginated list, read-only detail view, edit, remove. No new backend
endpoints — verified directly against `minutes.controller.ts`/
`minutes.service.ts` during brainstorming:

- `POST /organizations/:orgId/minutes` — `MANAGE_EVENTS`-gated.
  `CreateMinutesDto`: `title: string (min 2)`, `meetingDate: string
  (ISO8601)`, `attendeeMembershipIds: string[]` (can be empty — service
  returns early if so), `agendaItems: {topic: string (min 1), notes:
  string (min 1)}[]`, `actionItems: {task: string (min 1), owner?:
  string}[]`. Backend validates every `attendeeMembershipIds` entry
  actually belongs to the org (`400` otherwise).
- `GET /organizations/:orgId/minutes?page=&pageSize=` — any authenticated
  org member. Paginated: `page` defaults 1, `pageSize` defaults 25 (max
  100), sorted `meetingDate desc`. Returns `{data: MeetingMinutes[],
  total: number, page: number, pageSize: number}`.
- `GET /organizations/:orgId/minutes/:minutesId` — any authenticated org
  member, `404` if not found.
- `PATCH /organizations/:orgId/minutes/:minutesId` — `MANAGE_EVENTS`-gated,
  all fields optional (`UpdateMinutesDto`). No edit-lock — unlike Events,
  minutes can always be edited regardless of age.
- `DELETE /organizations/:orgId/minutes/:minutesId` — `MANAGE_EVENTS`-gated.

`MeetingMinutes` row: `id, organizationId, title, meetingDate,
attendeeMembershipIds: Json (string[] of Membership.id), agendaItems: Json
({topic, notes}[]), actionItems: Json ({task, owner: string | null}[]),
createdByUserId, createdAt, updatedAt`.

## Route structure

Unlike Files/Assets (tab content + dialogs), Minutes needs dedicated
routes — the agenda/action-item arrays need real editing space a modal
can't comfortably hold. `/workspace`'s Minutes tab (currently the Slice 9
placeholder) renders a paginated list; new routes handle create/view/edit:

- `app/(app)/[orgSlug]/workspace/minutes/new/page.tsx`
- `app/(app)/[orgSlug]/workspace/minutes/[minutesId]/page.tsx` (read-only
  detail)
- `app/(app)/[orgSlug]/workspace/minutes/[minutesId]/edit/page.tsx`

This mirrors Events' route shape (`/events`, `/events/new`,
`/events/[id]`, `/events/[id]/edit`) one level deeper under `/workspace`.

## Components

- **`frontend/types/api.ts`** — add `AgendaItem { topic: string; notes:
  string }`, `ActionItem { task: string; owner: string | null }`,
  `MeetingMinutes { id: string; title: string; meetingDate: string;
  attendeeMembershipIds: string[]; agendaItems: AgendaItem[]; actionItems:
  ActionItem[]; createdByUserId: string; createdAt: string; updatedAt:
  string }`.
- **`frontend/features/minutes/use-minutes.ts`** —
  `useMinutesList(orgId, page, pageSize)`, `useMinutes(orgId, minutesId)`
  (single-item fetch, `retry: false` — a `404` here is a meaningful
  answer, same reasoning as `useEvent`; this is the **first genuinely
  single-item fetch** in this app — every prior detail page found its row
  in an already-fetched *unpaginated* list, but pagination breaks that
  shortcut), `useCreateMinutes(orgId)`, `useUpdateMinutes(orgId)` (takes
  `{minutesId, input}` at mutate time, mirroring Slice 10's
  `useUpdateAsset`), `useDeleteMinutes(orgId)`.
- **`frontend/features/minutes/schema.ts`** — `minutesFormSchema`: `title`
  (min 2), `meetingDate` (required, non-empty string), `attendeeMembershipIds`
  (string array, may be empty), `agendaItems` (array of `{topic: string
  (min 1), notes: string (min 1)}`, both required per the backend DTO —
  no optional fields here, unlike `actionItems`), `actionItems` (array of
  `{task: string (min 1), owner: string (optional)}`).
- **`frontend/features/minutes/resolve-attendee-names.ts`** —
  `attendeeMembershipIds` are `Membership.id` values, not `userId` — a new
  one-hop-by-id shape, unlike every prior resolver in this app
  (`resolveMemberName`/`resolveUploaderName` key by `userId`). **Bakes in
  the by-now-established guard from day one, the third time this exact
  risk has come up**: `GET /members` is `VIEW_MEMBERS`-gated
  (committee-only) but this detail page is visible to any org member, so
  `members.isError` must map to a generic fallback per attendee, never a
  raw id — the same gap Slice 9's `FileList` and Slice 10's `AssetList`
  both had to handle (Slice 10 caught it at design time; this spec does
  the same from the start).
- **`frontend/components/minutes/minutes-list.tsx`** — paginated rows
  (title, formatted meeting date, attendee count) each linking to
  `/workspace/minutes/[id]`, Prev/Next buttons + a "Page X of Y" indicator
  (this app's first pagination UI — no library, two buttons and a
  disabled-at-bounds state), a "New minutes" link (committee-only).
- **`frontend/components/minutes/minutes-form.tsx`** — title input,
  meeting date input, an attendee checklist (ACTIVE members only, plain
  checkboxes, reusing the already-fetched `useMembers` list — no new
  endpoint), agenda-item rows and action-item rows each via
  `useFieldArray` (add/remove), mirroring Slice 3's
  `RegistrationFormEditor`. One component, a `mode: 'create' | 'edit'`
  prop, following `EventForm`'s dual-mode precedent from Slice 2.
- **`workspace/minutes/[minutesId]/page.tsx`** — read-only detail: title,
  formatted date, resolved attendee names (or the generic fallback),
  agenda items (topic + notes), action items (task + optional owner),
  Edit/Remove buttons (committee-only, Remove behind the standard confirm
  dialog). `404` handling mirrors `EventNotFound` (a small
  `MinutesNotFound` component, same vague "not found or no access"
  copy).
- **`workspace/minutes/new/page.tsx`** and **`.../[minutesId]/edit/page.tsx`**
  — thin pages wiring `MinutesForm` to `useCreateMinutes`/`useUpdateMinutes`,
  same shape as `events/new/page.tsx`/`events/[id]/edit/page.tsx`.
- **`app/(app)/[orgSlug]/workspace/page.tsx`** — Minutes tab wired to
  `MinutesList`, replacing its placeholder text. Files and Assets tabs
  untouched.

## RBAC & data flow

Same two-tier split as Files/Assets: `isCommittee()` (reused from Slice 2,
no new tier) gates New/Edit/Remove, matching backend `MANAGE_EVENTS`; list
and detail need no role check, matching the backend's bare
`JwtAuthGuard, TenantGuard` on those two routes. The frontend never
duplicates the backend's `attendeeMembershipIds` ownership check — it
only offers ACTIVE members as checkable options, which structurally makes
a foreign id hard to produce, and displays the backend's `400` message
verbatim if it ever fires (same precedent as the last-active-president
guardrail from Slice 4).

## Testing

**Unit (logic only):** `minutesFormSchema` — title/meetingDate required,
per-agenda-item topic/notes both required, per-action-item task required
and owner optional, empty `attendeeMembershipIds` allowed.
`resolveAttendeeNames` — match case, miss-fallback case, `members.isError`
guard case. No component tests (matches every prior list/form/detail
component in this app — live-verification only).

**Live verification (dev server + Playwright, real backend):** create
minutes with 2+ attendees, 2 agenda items, 1 action item; confirm the
detail page renders everything correctly (names, agenda, action items);
edit — add an attendee, add and remove agenda/action item rows, confirm
persistence; remove with confirm; pagination — seed enough rows via the
API (curl/python, same setup pattern as prior slices' live-verification
tasks) to span at least 2 pages, confirm Prev/Next and the page indicator
work and disable correctly at the bounds; a non-committee account sees the
list and detail pages but no New/Edit/Remove controls, and sees the
generic attendee fallback instead of raw ids; both themes screenshotted
with no domain-hue leakage.

No backend files expected to be touched — verified the full contract
against `minutes.controller.ts`/`minutes.service.ts` source before writing
this spec.
