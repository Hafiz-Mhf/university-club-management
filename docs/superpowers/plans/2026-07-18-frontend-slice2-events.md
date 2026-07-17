# Frontend Slice 2 — Events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Replace the Events placeholder with a real feature: list (search +
status filter + upcoming/past), detail with role/status-gated lifecycle
actions, and a create/edit form — against the live `EventsController`.

**Spec:** `docs/superpowers/specs/2026-07-18-frontend-slice2-events-design.md`
— authority on behavior; this plan sequences the work.

**Tech stack:** unchanged from Slice 1 (Next.js App Router, Tailwind v4,
shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Vitest + RTL).

## Global constraints

- Baseline before starting: frontend 28/28 Vitest, clean `npm run build`;
  backend 101 unit / 326 e2e (unchanged since Slice 1 merge, `26a8ee7`).
  Backend is **not touched** this slice — no new endpoints needed.
- One commit per task. `npm test` + `npm run build` clean before each commit.
- Design values (status badge colors, spacing) come from `design.md`'s
  existing semantic tokens (`--success`/`--warning`/`--danger`, domain hue
  `--domain-events`) — no new tokens invented for this slice.
- Live verification (Slice 1's pattern): after the full flow is wired,
  actually drive it against the running dev backend — create/publish/
  complete/cancel/delete an event, screenshot both themes — rather than
  relying on unit tests alone for page-level correctness.
- Icons: Lucide only.

---

### Task 1: Data layer — types, status helpers, roles extension, event hooks

**Files:**
- Modify: `frontend/types/api.ts` (add `Event` type)
- Modify: `frontend/features/orgs/roles.ts` (add `MANAGE_MEMBERS_ROLES`,
  `canManageMembers()`)
- Modify: `frontend/features/orgs/__tests__/contrast.test.ts` — no change
  (listed for clarity that this file is untouched)
- Create: `frontend/features/orgs/__tests__/roles.test.ts` (new — Slice 1
  never had one; `isCommittee`/`canManageMembers` truth tables now warrant
  it)
- Create: `frontend/features/events/status.ts`
- Create: `frontend/features/events/__tests__/status.test.ts`
- Create: `frontend/features/events/schemas.ts`
- Create: `frontend/features/events/__tests__/schemas.test.ts`
- Create: `frontend/features/events/use-events.ts`

**Steps:**

- [ ] **Step 1: Add the `Event` type.** In `types/api.ts`, append (confirm
  exact field set with a live `GET /organizations/:orgId/events` call
  against the dev backend before finalizing — the plan's field list below
  is the expected shape per `prisma/schema.prisma`, not yet spot-checked
  against a live response):

```ts
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'COMPLETED' | 'CANCELLED';

export interface Event {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  venue: string | null;
  startAt: string;
  endAt: string;
  capacity: number | null;
  status: EventStatus;
  requireFeedbackForCertificate: boolean;
  createdByUserId: string | null;
}
```

- [ ] **Step 2: Failing tests for role helpers.** Create
  `features/orgs/__tests__/roles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canManageMembers, isCommittee } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

const ALL: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR', 'ALUMNI',
];

describe('isCommittee', () => {
  it('is true for MANAGE_EVENTS tier, false otherwise', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: true, TREASURER: true,
      EVENT_DIRECTOR: true, COMMITTEE: true, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false, ALUMNI: false,
    };
    for (const role of ALL) expect(isCommittee(role)).toBe(expected[role]);
  });
});

describe('canManageMembers', () => {
  it('is true only for the stricter MANAGE_MEMBERS tier (excludes COMMITTEE)', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: true, TREASURER: true,
      EVENT_DIRECTOR: true, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false, ALUMNI: false,
    };
    for (const role of ALL) expect(canManageMembers(role)).toBe(expected[role]);
  });
});
```

- [ ] **Step 2b: Failing tests for status helpers.** Create
  `features/events/__tests__/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canCancel, canComplete, canDelete, canEdit, canPublish } from '@/features/events/status';
import type { EventStatus } from '@/types/api';

const STATUSES: EventStatus[] = ['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED'];

it('canEdit: DRAFT and PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canEdit(s)).toBe(expected[s]);
});

it('canPublish: DRAFT only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: false, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canPublish(s)).toBe(expected[s]);
});

it('canComplete: PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: false, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canComplete(s)).toBe(expected[s]);
});

it('canCancel: DRAFT and PUBLISHED only', () => {
  const expected: Record<EventStatus, boolean> = {
    DRAFT: true, PUBLISHED: true, COMPLETED: false, CANCELLED: false,
  };
  for (const s of STATUSES) expect(canCancel(s)).toBe(expected[s]);
});

it('canDelete: always true, any status', () => {
  for (const s of STATUSES) expect(canDelete(s)).toBe(true);
});
```

- [ ] **Step 2c: Failing tests for the date-range schema.** Create
  `features/events/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eventFormSchema } from '@/features/events/schemas';

const base = {
  title: 'Design Crit', description: '', venue: '',
  startAt: '2026-08-01T10:00', endAt: '2026-08-01T12:00', capacity: '',
};

it('accepts a valid range', () => {
  expect(eventFormSchema.safeParse(base).success).toBe(true);
});

it('rejects endAt equal to startAt', () => {
  const r = eventFormSchema.safeParse({ ...base, endAt: base.startAt });
  expect(r.success).toBe(false);
});

it('rejects endAt before startAt', () => {
  const r = eventFormSchema.safeParse({ ...base, endAt: '2026-08-01T09:00' });
  expect(r.success).toBe(false);
});

it('rejects a title under 2 characters', () => {
  const r = eventFormSchema.safeParse({ ...base, title: 'A' });
  expect(r.success).toBe(false);
});

it('treats blank capacity as unlimited (undefined), accepts a positive integer', () => {
  expect(eventFormSchema.safeParse(base).success).toBe(true);
  expect(eventFormSchema.safeParse({ ...base, capacity: '50' }).success).toBe(true);
  expect(eventFormSchema.safeParse({ ...base, capacity: '0' }).success).toBe(false);
});
```

- [ ] **Step 3: Run tests — verify red.** `npm test` — new files fail to
  resolve (modules don't exist yet).
- [ ] **Step 4: Implement role helpers.** In `features/orgs/roles.ts`, add:

```ts
export const MANAGE_MEMBERS_ROLES: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
];

export function canManageMembers(role: MembershipRole): boolean {
  return MANAGE_MEMBERS_ROLES.includes(role);
}
```

  (`COMMITTEE_ROLES`/`isCommittee` already exist from Slice 1 — unchanged.)

- [ ] **Step 5: Implement `status.ts`:**

```ts
import type { EventStatus } from '@/types/api';

export const canEdit = (s: EventStatus) => s === 'DRAFT' || s === 'PUBLISHED';
export const canPublish = (s: EventStatus) => s === 'DRAFT';
export const canComplete = (s: EventStatus) => s === 'PUBLISHED';
export const canCancel = (s: EventStatus) => s === 'DRAFT' || s === 'PUBLISHED';
export const canDelete = (_s: EventStatus) => true;
```

- [ ] **Step 6: Implement `schemas.ts`:**

```ts
import { z } from 'zod';

export const eventFormSchema = z
  .object({
    title: z.string().min(2, 'Title must be at least 2 characters'),
    description: z.string().optional(),
    venue: z.string().optional(),
    startAt: z.string().min(1, 'Start date/time is required'),
    endAt: z.string().min(1, 'End date/time is required'),
    capacity: z.string().optional(),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start',
    path: ['endAt'],
  })
  .refine((v) => !v.capacity || (Number.isInteger(Number(v.capacity)) && Number(v.capacity) >= 1), {
    message: 'Capacity must be a positive whole number',
    path: ['capacity'],
  });

export type EventFormInput = z.infer<typeof eventFormSchema>;
```

- [ ] **Step 7: Run tests — verify green.** `npm test`.
- [ ] **Step 8: Implement `use-events.ts`** (no test — thin TanStack Query
  wiring, same pattern as `features/orgs/use-orgs.ts`):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Event } from '@/types/api';
import type { EventFormInput } from '@/features/events/schemas';

function toBody(input: EventFormInput) {
  return {
    title: input.title,
    description: input.description || undefined,
    venue: input.venue || undefined,
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
    capacity: input.capacity ? Number(input.capacity) : undefined,
  };
}

export function useEvents(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'events'],
    queryFn: () => api<Event[]>(`/organizations/${orgId}/events`),
  });
}

export function useEvent(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId],
    queryFn: () => api<Event>(`/organizations/${orgId}/events/${eventId}`),
  });
}

function useInvalidateEvents(orgId: string, eventId?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'events'] });
    if (eventId) qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId] });
  };
}

export function useCreateEvent(orgId: string) {
  const invalidate = useInvalidateEvents(orgId);
  return useMutation({
    mutationFn: (input: EventFormInput) =>
      api<Event>(`/organizations/${orgId}/events`, { method: 'POST', body: toBody(input) }),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateEvents(orgId, eventId);
  return useMutation({
    mutationFn: (input: EventFormInput) =>
      api<Event>(`/organizations/${orgId}/events/${eventId}`, { method: 'PATCH', body: toBody(input) }),
    onSuccess: invalidate,
  });
}

function useLifecycleAction(orgId: string, eventId: string, action: string) {
  const invalidate = useInvalidateEvents(orgId, eventId);
  return useMutation({
    mutationFn: () =>
      api<Event>(`/organizations/${orgId}/events/${eventId}/${action}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export const usePublishEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'publish');
export const useCompleteEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'complete');
export const useCancelEvent = (orgId: string, eventId: string) =>
  useLifecycleAction(orgId, eventId, 'cancel');

export function useDeleteEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateEvents(orgId);
  return useMutation({
    mutationFn: () =>
      api<{ removed: true }>(`/organizations/${orgId}/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 9: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/types/api.ts frontend/features/orgs/roles.ts frontend/features/orgs/__tests__/roles.test.ts frontend/features/events/
git commit -m "feat(frontend): events data layer — status helpers, schema, role tiers, query hooks"
```

---

### Task 2: Events list page

**Files:**
- Create: `frontend/components/events/event-status-badge.tsx`
- Create: `frontend/components/events/event-card.tsx`
- Modify: `frontend/app/(app)/[orgSlug]/events/page.tsx` (replace
  placeholder)

**Steps:**

- [ ] **Step 1: `EventStatusBadge`.** Maps status → label + semantic tint:
  `DRAFT` → neutral (`bg-surface-secondary text-foreground-muted`),
  `PUBLISHED` → `bg-success/10 text-success`, `COMPLETED` → `bg-info/10
  text-info`, `CANCELLED` → `bg-danger/10 text-danger`. Small, reusable —
  the detail page uses it too.
- [ ] **Step 2: `EventCard`.** Title, `EventStatusBadge`, formatted
  `startAt`–`endAt` (reuse a date formatter matching the Dashboard's
  `Intl.DateTimeFormat` pattern from `components/dashboard/widgets.tsx`),
  venue if present, links to `/events/[id]`.
- [ ] **Step 3: List page.** `'use client'`; `useOrg()` for `org`/
  `membership`; `useEvents(org.id)`. Local state: `search` (string),
  `statusFilter` (`'all' | EventStatus`), `view` (`'upcoming' | 'past'`,
  default `'upcoming'`). Derive filtered/sorted list with `useMemo`:
  substring match on title (case-insensitive), status filter, split
  upcoming/past by `startAt` vs `Date.now()`. Status filter `<select>`
  options: always `All`, plus `Published`/`Completed`/`Cancelled`; `Draft`
  only appended when `isCommittee(membership.role)`. Segmented control
  (two `Button`s, `variant={view === x ? 'default' : 'ghost'}`) for
  Upcoming/Past. "Create event" button (committee only) → `/events/new`.
  Empty states: no events at all → "No events yet" (+ "Create your first
  event" CTA for committee); events exist but filters produce zero →
  "No events match your search or filter."
- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/events/ "frontend/app/(app)/[orgSlug]/events/page.tsx"
git commit -m "feat(frontend): events list — search, status filter, upcoming/past view"
```

---

### Task 3: Event detail page + lifecycle actions

**Files:**
- Create: `frontend/components/events/event-not-found.tsx`
- Create: `frontend/components/events/lifecycle-actions.tsx`
- Create: `frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx`

**Steps:**

- [ ] **Step 1: `EventNotFound`.** Small centered message, matches
  `PlaceholderPage`'s visual weight but its own copy: "Event not found" +
  "It may have been removed, or you don't have access to it." (deliberately
  doesn't reveal *which* — matches the backend's no-existence-leak intent).
- [ ] **Step 2: `LifecycleActions`.** Props: `event`, `orgId`, `role`.
  Renders only the buttons whose `status.ts` check passes for the current
  status *and* whose role check passes:
  - Publish (`canPublish` + `isCommittee`) — primary button, calls
    `usePublishEvent`; on the backend's 409 ("Cannot publish a past event")
    shows the message inline, not a generic error.
  - Complete (`canComplete` + `isCommittee`) — primary button.
  - Cancel (`canCancel` + `canManageMembers`) — secondary/outline button,
    opens a `Dialog` confirm ("Cancel this event? Registrants will be
    notified.") before calling `useCancelEvent`.
  - Delete (`canDelete` + `canManageMembers`) — destructive-variant button,
    opens a `Dialog` confirm ("Delete this event? This cannot be undone.")
    before calling `useDeleteEvent`; on success, `router.push('/events')`.
  Each mutating button shows a spinner while pending and is disabled during
  its own request (not all buttons at once).
- [ ] **Step 3: Detail page.** `useEvent(org.id, eventId)`. On `isError`
  with `ApiError.status === 404`, render `EventNotFound`. On success:
  header (title + `EventStatusBadge` + Edit link when `canEdit(status) &&
  isCommittee`), body (description, venue, formatted dates, capacity or
  "Unlimited"), `LifecycleActions`.
- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/events/event-not-found.tsx frontend/components/events/lifecycle-actions.tsx "frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx"
git commit -m "feat(frontend): event detail — status-gated lifecycle actions, 404 handling"
```

---

### Task 4: Create/edit form

**Files:**
- Create: `frontend/components/events/event-form.tsx`
- Create: `frontend/app/(app)/[orgSlug]/events/new/page.tsx`
- Create: `frontend/app/(app)/[orgSlug]/events/[eventId]/edit/page.tsx`

**Steps:**

- [ ] **Step 1: `EventForm`.** Shared component, `mode: 'create' | 'edit'`,
  optional `defaultValues` (edit mode). RHF + `zodResolver(eventFormSchema)`.
  Fields: title (`Input`), description (`Textarea` — **new shadcn
  component, add via `npx shadcn@latest add textarea`**), venue (`Input`),
  startAt/endAt (`Input type="datetime-local"`), capacity (`Input
  type="number"`, placeholder "Unlimited"). Inline field errors (Slice 1
  pattern). Top-level error banner surfaces the backend's message verbatim
  on a 400 (e.g. "endAt must be after startAt") — same `ApiError`-message
  pattern as the auth forms. Submit button: "Create event" / "Save
  changes" per mode, spinner while pending.
- [ ] **Step 2: New-event page.** Redirect to `/events` if
  `!isCommittee(membership.role)` (backend would 403 the POST — this just
  avoids showing a dead-end form). Renders `EventForm mode="create"`; on
  success `router.push('/events/' + event.id)`.
- [ ] **Step 3: Edit page.** Same committee redirect, plus redirect to
  `/events/[eventId]` if the loaded event's status fails `canEdit()`
  (terminal events never show an edit form, not even a disabled one).
  Renders `EventForm mode="edit"` seeded from the loaded event; on success
  `router.push('/events/' + eventId)`.
- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/events/event-form.tsx "frontend/app/(app)/[orgSlug]/events/new" "frontend/app/(app)/[orgSlug]/events/[eventId]/edit"
git commit -m "feat(frontend): event create/edit form"
```

---

### Task 5: Live verification + polish

Not a code task on its own — a checkpoint, same as Slice 1's live-driven
tasks. No separate commit unless verification surfaces a real bug (then fix
+ commit as its own small commit, description reflecting the actual bug).

- [ ] **Step 1:** `docker compose up -d` if the stack has stopped. Start
  backend (`npm run start:dev`) and frontend (`npm run dev`) dev servers.
- [ ] **Step 2:** Drive the full flow as a committee user (reuse a seeded
  org from Slice 1's verification, or create a fresh one): create an event
  (verify validation errors for bad title/date range first), see it appear
  in the list as Draft (visible only to committee), publish it, verify it
  now shows for a non-committee test user (register a second account,
  verify DRAFT was never visible to them, PUBLISHED now is), edit it,
  complete it, verify Edit disappears once terminal, create a second event
  and cancel it (confirm dialog), delete an event (confirm dialog, verify
  redirect + list update).
- [ ] **Step 3:** Screenshot the list and detail pages in both light and
  dark themes (Playwright, same pattern as Slice 1) — confirm status badges
  read correctly in both, domain-events hue isn't misused as a status color
  anywhere (status uses semantic tokens; the events *nav icon* uses the
  domain hue — the two systems must stay visually distinct on this page).
- [ ] **Step 4:** Spot-check the DRAFT-404 path directly: as the
  non-committee test user, navigate straight to a DRAFT event's URL —
  confirm `EventNotFound` renders, not a crash or a leaking title.
- [ ] **Step 5:** Full regression — `npm test` (frontend) and
  `npm test && npm run test:e2e` (backend, confirming Slice 2 touched zero
  backend files) — both must match the pre-slice baseline (frontend
  28+new/28+new all green; backend 101/326 unchanged).

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** update `docs/uiux.md` with an "Slice 2 — Events" section
(status-badge semantics, lifecycle-action gating rules, DRAFT-404 handling,
the `MANAGE_MEMBERS` vs `MANAGE_EVENTS` frontend role split). Update
`docs/current-context.md` (untracked) — mark Slice 2 shipped, note Slice 3
(registration form builder + self-registration + approve/reject) as the
carved-out next piece.

**Finish branch:** verify frontend `npm test`/`npm run build` and backend
`npm test`/`npm run test:e2e` all green → merge
`feature/frontend-slice2-events` to `main` locally, delete branch. Never
push.
