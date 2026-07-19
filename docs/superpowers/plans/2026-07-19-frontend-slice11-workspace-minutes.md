# Frontend Slice 11 (Workspace — Meeting Minutes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the third and last Workspace sub-slice — a full frontend
surface for the already-shipped `MinutesController` (create, paginated
list, read-only detail, edit, remove) — filling in the Minutes tab of
`/workspace` and adding dedicated routes for create/view/edit.

**Architecture:** Unlike Files/Assets (tab content + dialogs), Minutes
needs dedicated routes nested under `/workspace/minutes/` — the
agenda/action-item arrays need real editing space. New
`features/minutes/` (hooks, Zod schema, attendee-name resolver) and
`components/minutes/` (paginated list, one shared create/edit form)
directories. Mirrors Events' route shape one level deeper
(`/events`→`/workspace/minutes`, `/events/new`→`/workspace/minutes/new`,
etc.) and Slice 3's `RegistrationFormEditor` for the two dynamic-row
arrays (`useFieldArray`).

**Tech Stack:** Next.js 18 App Router, TypeScript, TanStack Query, React
Hook Form + Zod, Tailwind v4, shadcn/ui (Base UI primitives), Vitest +
React Testing Library. No new runtime dependencies.

## Global Constraints

- No new backend endpoints or backend files — verified the full contract
  against `backend/src/minutes/minutes.controller.ts` and
  `minutes.service.ts` during brainstorming (create/update/remove:
  `MANAGE_EVENTS`-gated; list/findOne: any authenticated org member; list
  is paginated — `{data, total, page, pageSize}`, `page` defaults 1,
  `pageSize` defaults 25/max 100, sorted `meetingDate desc`; no edit-lock
  concept, unlike Events).
- Frontend test baseline going in: **117/117** (verified via `npm test --
  --run` this session, current as of Slice 10's merge to `main`).
- RBAC: reuse `isCommittee()` from `features/orgs/roles.ts` (Slice 2) — no
  new role tier, mirrors backend `MANAGE_EVENTS` exactly.
- **`attendeeMembershipIds` holds `Membership.id` values, not `userId`** —
  a new one-hop-by-id resolver shape, unlike every prior resolver in this
  app (`resolveMemberName`/`resolveUploaderName` key by `userId`). Match
  by `member.id`, not `member.userId`.
- **Repeat of the Files/Assets bug class, guarded at the call site from
  the start**: `GET /organizations/:orgId/members` is `VIEW_MEMBERS`-gated
  (committee-only), but the minutes detail page is visible to any org
  member. The detail page (Task 8) MUST render a generic per-attendee
  fallback when `members.isError` — never fall through to
  `resolveAttendeeNames`'s raw-id fallback (that's for the genuine
  "member row not found" case, not an authorization failure). Do not skip
  this.
- This is the frontend's **first paginated list** and **first genuinely
  single-item fetch** (`useMinutes(orgId, minutesId)` calls `GET
  /minutes/:id` directly — every prior detail page found its row in an
  already-fetched *unpaginated* list, which pagination breaks).

---

### Task 1: Types + data layer

**Files:**
- Modify: `frontend/types/api.ts` — add `AgendaItem`, `ActionItem`,
  `MeetingMinutes` types
- Create: `frontend/features/minutes/use-minutes.ts`

**Interfaces:**
- Produces: `AgendaItem { topic: string; notes: string }`, `ActionItem {
  task: string; owner: string | null }`, `MeetingMinutes { id: string;
  title: string; meetingDate: string; attendeeMembershipIds: string[];
  agendaItems: AgendaItem[]; actionItems: ActionItem[]; createdByUserId:
  string; createdAt: string; updatedAt: string }`, `MinutesListResponse {
  data: MeetingMinutes[]; total: number; page: number; pageSize: number }`,
  `MinutesInput { title: string; meetingDate: string;
  attendeeMembershipIds: string[]; agendaItems: {topic: string; notes:
  string}[]; actionItems: {task: string; owner?: string}[] }`,
  `useMinutesList(orgId: string, page: number, pageSize: number)`,
  `useMinutes(orgId: string, minutesId: string)`,
  `useCreateMinutes(orgId: string)`, `useUpdateMinutes(orgId: string)`
  (takes `{ minutesId, input }` at mutate time), `useDeleteMinutes(orgId:
  string)` (takes `minutesId` at mutate time).

No test for this task — pure data layer, no branching logic, same as
`use-assets.ts`/`use-files.ts` in prior slices (verified live in Task 10,
not unit tested).

- [ ] **Step 1: Add the types to `types/api.ts`**

```typescript
export interface AgendaItem {
  topic: string;
  notes: string;
}

export interface ActionItem {
  task: string;
  owner: string | null;
}

export interface MeetingMinutes {
  id: string;
  title: string;
  meetingDate: string;
  attendeeMembershipIds: string[];
  agendaItems: AgendaItem[];
  actionItems: ActionItem[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create `frontend/features/minutes/use-minutes.ts`**

```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ActionItem, AgendaItem, MeetingMinutes } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/minutes`;
}

export interface MinutesListResponse {
  data: MeetingMinutes[];
  total: number;
  page: number;
  pageSize: number;
}

export function useMinutesList(orgId: string, page: number, pageSize: number) {
  return useQuery({
    queryKey: ['org', orgId, 'minutes', 'list', page, pageSize],
    queryFn: () => api<MinutesListResponse>(`${base(orgId)}?page=${page}&pageSize=${pageSize}`),
  });
}

export function useMinutes(orgId: string, minutesId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'minutes', minutesId],
    queryFn: () => api<MeetingMinutes>(`${base(orgId)}/${minutesId}`),
    retry: false, // a 404 here is a meaningful answer, not a flake
  });
}

function useInvalidateMinutes(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'minutes'] });
  };
}

export interface MinutesInput {
  title: string;
  meetingDate: string;
  attendeeMembershipIds: string[];
  agendaItems: AgendaItem[];
  actionItems: { task: string; owner?: string }[];
}

export function useCreateMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: (input: MinutesInput) =>
      api<MeetingMinutes>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: ({ minutesId, input }: { minutesId: string; input: MinutesInput }) =>
      api<MeetingMinutes>(`${base(orgId)}/${minutesId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteMinutes(orgId: string) {
  const invalidate = useInvalidateMinutes(orgId);
  return useMutation({
    mutationFn: (minutesId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${minutesId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors (5 pre-existing `lib/__tests__/api.test.ts` errors
are unrelated, confirmed clean-tree during Slice 9 — ignore them).

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/minutes/use-minutes.ts
git commit -m "feat(frontend): meeting minutes data layer"
```

---

### Task 2: Minutes form schema

**Files:**
- Create: `frontend/features/minutes/schema.ts`
- Test: `frontend/features/minutes/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `minutesFormSchema` (Zod), `MinutesFormValues = z.infer<typeof minutesFormSchema>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { expect, it } from 'vitest';
import { minutesFormSchema } from '@/features/minutes/schema';

const base = {
  title: 'Weekly Sync',
  meetingDate: '2026-07-19',
  attendeeMembershipIds: [],
  agendaItems: [{ topic: 'Budget', notes: 'Reviewed Q3 spend' }],
  actionItems: [{ task: 'Send report', owner: 'Ada' }],
};

it('accepts a valid submission', () => {
  expect(minutesFormSchema.safeParse(base).success).toBe(true);
});

it('rejects a title under 2 characters', () => {
  expect(minutesFormSchema.safeParse({ ...base, title: 'A' }).success).toBe(false);
});

it('rejects a missing meeting date', () => {
  expect(minutesFormSchema.safeParse({ ...base, meetingDate: '' }).success).toBe(false);
});

it('rejects an agenda item missing topic or notes', () => {
  expect(minutesFormSchema.safeParse({ ...base, agendaItems: [{ topic: '', notes: 'x' }] }).success)
    .toBe(false);
  expect(minutesFormSchema.safeParse({ ...base, agendaItems: [{ topic: 'x', notes: '' }] }).success)
    .toBe(false);
});

it('rejects an action item missing a task', () => {
  expect(minutesFormSchema.safeParse({ ...base, actionItems: [{ task: '', owner: 'Ada' }] }).success)
    .toBe(false);
});

it('accepts an action item with no owner and empty agenda/action lists', () => {
  expect(minutesFormSchema.safeParse({ ...base, actionItems: [{ task: 'Follow up' }] }).success)
    .toBe(true);
  expect(
    minutesFormSchema.safeParse({
      title: 'Weekly Sync',
      meetingDate: '2026-07-19',
      attendeeMembershipIds: [],
      agendaItems: [],
      actionItems: [],
    }).success,
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/minutes/__tests__/schema.test.ts`
Expected: FAIL — `@/features/minutes/schema` module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { z } from 'zod';

// Mirrors backend CreateMinutesDto/UpdateMinutesDto. The backend
// re-validates everything; these checks exist so obvious errors never
// leave the client.
export const minutesFormSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters'),
  meetingDate: z.string().min(1, 'Meeting date is required'),
  attendeeMembershipIds: z.array(z.string()),
  agendaItems: z.array(
    z.object({
      topic: z.string().min(1, 'Topic is required'),
      notes: z.string().min(1, 'Notes are required'),
    }),
  ),
  actionItems: z.array(
    z.object({
      task: z.string().min(1, 'Task is required'),
      owner: z.string().optional(),
    }),
  ),
});

export type MinutesFormValues = z.infer<typeof minutesFormSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/minutes/__tests__/schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/minutes/schema.ts frontend/features/minutes/__tests__/schema.test.ts
git commit -m "feat(frontend): meeting minutes form validation schema"
```

---

### Task 3: Attendee-name resolution

**Files:**
- Create: `frontend/features/minutes/resolve-attendee-names.ts`
- Test: `frontend/features/minutes/__tests__/resolve-attendee-names.test.ts`

**Interfaces:**
- Consumes: `Member` (existing, `@/types/api`).
- Produces: `resolveAttendeeNames(attendeeMembershipIds: string[], members: Member[]): string[]`.

This resolver stays a pure mapper (match by `member.id`, fall back to the
raw id on a genuine miss) — the same shape as `resolveMemberName`/
`resolveUploaderName`. The `members.isError` authorization guard is
applied at the call site in Task 8 (the detail page), matching exactly
where Slice 9's `FileList` and Slice 10's `AssetList` applied theirs —
not inside this function.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveAttendeeNames } from '../resolve-attendee-names';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    userId: 'u1',
    organizationId: 'o1',
    role: 'PARTICIPANT',
    status: 'ACTIVE',
    studentId: null,
    faculty: null,
    programme: null,
    intake: null,
    phone: null,
    committeeHistory: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveAttendeeNames', () => {
  it('resolves each membership id to its full name', () => {
    const members = [
      makeMember({ id: 'm1', user: { id: 'u1', fullName: 'Ada Lovelace', email: 'a@x.io' } }),
      makeMember({ id: 'm2', userId: 'u2', user: { id: 'u2', fullName: 'Grace Hopper', email: 'g@x.io' } }),
    ];
    expect(resolveAttendeeNames(['m1', 'm2'], members)).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('falls back to the raw id when a membership id has no match', () => {
    expect(resolveAttendeeNames(['missing-id'], [])).toEqual(['missing-id']);
  });

  it('returns an empty array for no attendees', () => {
    expect(resolveAttendeeNames([], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/minutes/__tests__/resolve-attendee-names.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Member } from '@/types/api';

// attendeeMembershipIds holds Membership.id values, not userId — matches
// member.id, unlike resolveMemberName/resolveUploaderName which match
// member.userId. Falls back to the raw id on a genuine miss.
export function resolveAttendeeNames(attendeeMembershipIds: string[], members: Member[]): string[] {
  return attendeeMembershipIds.map((id) => {
    const member = members.find((m) => m.id === id);
    return member ? member.user.fullName : id;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/minutes/__tests__/resolve-attendee-names.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/minutes/resolve-attendee-names.ts frontend/features/minutes/__tests__/resolve-attendee-names.test.ts
git commit -m "feat(frontend): attendee-name resolution for meeting minutes"
```

---

### Task 4: MinutesForm

**Files:**
- Create: `frontend/components/minutes/minutes-form.tsx`

**Interfaces:**
- Consumes: `minutesFormSchema`, `MinutesFormValues` (Task 2),
  `MinutesInput` (Task 1), `useMembers` (existing,
  `@/features/members/use-members`), `Input`/`Label`/`Textarea`/`Button`
  (existing), `ApiError` (existing, `@/lib/api`).
- Produces: `MinutesForm({ orgId, mode, defaultValues, onSubmit, isPending,
  error }: { orgId: string; mode: 'create' | 'edit'; defaultValues?:
  Partial<MinutesFormValues>; onSubmit: (values: MinutesInput) => void;
  isPending: boolean; error: unknown })`.

Only ever rendered on the new/edit pages (Tasks 7, 9), which both
redirect non-committee viewers before mounting it — the same guard
`EventForm`'s pages use — so `useMembers` here carries no authorization
risk (unlike Task 8's detail page, which is visible to any member).

No test — matches `EventForm`/`RegistrationFormEditor`, neither of which
has a direct test in this codebase (verified live in Task 10).

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { minutesFormSchema, type MinutesFormValues } from '@/features/minutes/schema';
import type { MinutesInput } from '@/features/minutes/use-minutes';
import { useMembers } from '@/features/members/use-members';
import { ApiError } from '@/lib/api';

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

interface MinutesFormProps {
  orgId: string;
  mode: 'create' | 'edit';
  defaultValues?: Partial<MinutesFormValues>;
  onSubmit: (values: MinutesInput) => void;
  isPending: boolean;
  error: unknown;
}

export function MinutesForm({ orgId, mode, defaultValues, onSubmit, isPending, error }: MinutesFormProps) {
  const members = useMembers(orgId, { status: 'ACTIVE' });
  const form = useForm<MinutesFormValues>({
    resolver: zodResolver(minutesFormSchema),
    defaultValues: {
      title: '',
      meetingDate: '',
      attendeeMembershipIds: [],
      agendaItems: [],
      actionItems: [],
      ...defaultValues,
    },
  });
  const errors = form.formState.errors;
  const agenda = useFieldArray({ control: form.control, name: 'agendaItems' });
  const actions = useFieldArray({ control: form.control, name: 'actionItems' });

  const submit = form.handleSubmit((values) => {
    onSubmit({
      ...values,
      actionItems: values.actionItems.map((a) => ({ task: a.task, owner: a.owner || undefined })),
    });
  });

  const topError = error instanceof ApiError ? error.message : error ? 'Something went wrong' : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}

      <Field label="Title" htmlFor="minutes-title" error={errors.title?.message}>
        <Input id="minutes-title" {...form.register('title')} />
      </Field>

      <Field label="Meeting date" htmlFor="minutes-date" error={errors.meetingDate?.message}>
        <Input id="minutes-date" type="date" {...form.register('meetingDate')} />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label>Attendees</Label>
        <Controller
          control={form.control}
          name="attendeeMembershipIds"
          render={({ field }) => (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {(members.data ?? []).length === 0 && (
                <p className="text-sm text-foreground-muted">No active members yet.</p>
              )}
              {(members.data ?? []).map((m) => {
                const checked = field.value.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        field.onChange(
                          e.target.checked
                            ? [...field.value, m.id]
                            : field.value.filter((id) => id !== m.id),
                        );
                      }}
                    />
                    {m.user.fullName}
                  </label>
                );
              })}
            </div>
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Agenda items</Label>
        {agenda.fields.map((f, index) => (
          <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Topic"
                className="flex-1"
                {...form.register(`agendaItems.${index}.topic`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => agenda.remove(index)}
                aria-label="Remove agenda item"
              >
                <X className="size-4" />
              </Button>
            </div>
            <Textarea placeholder="Notes" {...form.register(`agendaItems.${index}.notes`)} />
            {errors.agendaItems?.[index] && (
              <p className="text-sm text-danger">
                {errors.agendaItems[index]?.topic?.message ?? errors.agendaItems[index]?.notes?.message}
              </p>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => agenda.append({ topic: '', notes: '' })}>
          <Plus className="size-4" />
          Add agenda item
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Action items</Label>
        {actions.fields.map((f, index) => (
          <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Task"
                className="flex-1"
                {...form.register(`actionItems.${index}.task`)}
              />
              <Input
                placeholder="Owner (optional)"
                className="flex-1"
                {...form.register(`actionItems.${index}.owner`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => actions.remove(index)}
                aria-label="Remove action item"
              >
                <X className="size-4" />
              </Button>
            </div>
            {errors.actionItems?.[index]?.task && (
              <p className="text-sm text-danger">{errors.actionItems[index]?.task?.message}</p>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => actions.append({ task: '', owner: '' })}>
          <Plus className="size-4" />
          Add action item
        </Button>
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending && <Loader2 className="size-4 animate-spin" />}
        {mode === 'create' ? 'Create minutes' : 'Save'}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/minutes/minutes-form.tsx
git commit -m "feat(frontend): MinutesForm component (add + edit)"
```

---

### Task 5: MinutesList

**Files:**
- Create: `frontend/components/minutes/minutes-list.tsx`

**Interfaces:**
- Consumes: `useMinutesList` (Task 1), `useOrg` (existing,
  `@/features/orgs/org-provider`).
- Produces: `MinutesList({ orgId, orgSlug, canManage }: { orgId: string;
  orgSlug: string; canManage: boolean })`.

Shows only an attendee **count** per row (`m.attendeeMembershipIds.length`)
— no name resolution needed here, so this component has no exposure to
the members-authorization risk Task 8's detail page has to guard.

No test — presentational + wiring, verified live in Task 10 (matches
`FileList`/`AssetList`).

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useMinutesList } from '@/features/minutes/use-minutes';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const PAGE_SIZE = 10;

export function MinutesList({
  orgId,
  orgSlug,
  canManage,
}: {
  orgId: string;
  orgSlug: string;
  canManage: boolean;
}) {
  const [page, setPage] = useState(1);
  const minutes = useMinutesList(orgId, page, PAGE_SIZE);

  if (minutes.isPending) return null;
  if (minutes.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load minutes.</p>;
  }

  const { data, total } = minutes.data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Link
          href={`/${orgSlug}/workspace/minutes/new`}
          className={buttonVariants({ size: 'sm', className: 'w-fit' })}
        >
          <Plus className="size-3.5" />
          New minutes
        </Link>
      )}

      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">No minutes yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((m) => (
            <Link
              key={m.id}
              href={`/${orgSlug}/workspace/minutes/${m.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
            >
              <span>{m.title}</span>
              <span className="text-xs text-foreground-subtle">
                {dateFmt.format(new Date(m.meetingDate))} · {m.attendeeMembershipIds.length} attendees
              </span>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-xs text-foreground-muted">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/minutes/minutes-list.tsx
git commit -m "feat(frontend): MinutesList component (paginated)"
```

---

### Task 6: Workspace page wiring

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/workspace/page.tsx`

**Interfaces:**
- Consumes: `MinutesList` (Task 5).

- [ ] **Step 1: Replace the Minutes tab placeholder with `MinutesList`**

Replace this block:

```tsx
{tab === 'minutes' && (
  <p className="py-8 text-center text-sm text-foreground-muted">
    Coming in a later sub-slice.
  </p>
)}
```

with:

```tsx
{tab === 'minutes' && (
  <MinutesList orgId={org.id} orgSlug={org.slug} canManage={committee} />
)}
```

And add the import:

```tsx
import { MinutesList } from '@/components/minutes/minutes-list';
```

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: 126 passed (117 baseline + 9 from Tasks 2–3).

- [ ] **Step 3: Run build**

Run: `cd frontend && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/page.tsx"
git commit -m "feat(frontend): Workspace page wiring — Minutes tab"
```

---

### Task 7: New minutes page

**Files:**
- Create: `frontend/app/(app)/[orgSlug]/workspace/minutes/new/page.tsx`

**Interfaces:**
- Consumes: `MinutesForm` (Task 4), `useCreateMinutes` (Task 1), `useOrg`,
  `isCommittee` (existing).

- [ ] **Step 1: Write the page**

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MinutesForm } from '@/components/minutes/minutes-form';
import { useCreateMinutes } from '@/features/minutes/use-minutes';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function NewMinutesPage() {
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const create = useCreateMinutes(org.id);

  // The backend would 403 the POST anyway — just don't show a dead-end form.
  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/workspace`);
  }, [committee, router, org.slug]);
  if (!committee) return null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">New minutes</h1>
      <MinutesForm
        orgId={org.id}
        mode="create"
        isPending={create.isPending}
        error={create.error}
        onSubmit={(values) =>
          create.mutate(values, {
            onSuccess: (minutes) => router.push(`/${org.slug}/workspace/minutes/${minutes.id}`),
          })
        }
      />
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/minutes/new/page.tsx"
git commit -m "feat(frontend): new-minutes page"
```

---

### Task 8: Minutes detail page

**Files:**
- Create: `frontend/app/(app)/[orgSlug]/workspace/minutes/[minutesId]/page.tsx`

**Interfaces:**
- Consumes: `useMinutes`, `useDeleteMinutes` (Task 1),
  `resolveAttendeeNames` (Task 3), `useMembers` (existing), `useOrg`,
  `isCommittee` (existing), `ApiError` (existing).

**This is where the members-authorization guard lives — apply it here,
not in the resolver.**

- [ ] **Step 1: Write the page**

```tsx
'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Loader2, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteMinutes, useMinutes } from '@/features/minutes/use-minutes';
import { resolveAttendeeNames } from '@/features/minutes/resolve-attendee-names';
import { useMembers } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function MinutesNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <ClipboardList className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Minutes not found</h1>
      <p className="text-sm text-foreground-muted">
        They may have been removed, or you don&apos;t have access to them.
      </p>
    </div>
  );
}

export default function MinutesDetailPage({
  params,
}: {
  params: Promise<{ minutesId: string }>;
}) {
  const { minutesId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const minutes = useMinutes(org.id, minutesId);
  const members = useMembers(org.id, {});
  const remove = useDeleteMinutes(org.id);
  const [removing, setRemoving] = useState(false);

  if (minutes.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (minutes.isError) {
    if (minutes.error instanceof ApiError && minutes.error.status === 404) {
      return <MinutesNotFound />;
    }
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load these minutes.</p>
        <Button variant="secondary" onClick={() => minutes.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const m = minutes.data;
  // GET /members is VIEW_MEMBERS-gated (committee-only) but this detail
  // page is visible to any org member — a 403 here is an expected
  // authorization boundary, not a missing row, so it must not fall
  // through to resolveAttendeeNames's raw-id fallback (that would leak
  // internal membership ids — the exact bug fixed in Slice 9's FileList
  // and pre-empted in Slice 10's AssetList).
  const attendeeNames = members.isError
    ? m.attendeeMembershipIds.map(() => 'Committee member')
    : resolveAttendeeNames(m.attendeeMembershipIds, members.data ?? []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/workspace`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Workspace
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{m.title}</h1>
          <p className="text-sm text-foreground-muted">{dateFmt.format(new Date(m.meetingDate))}</p>
        </div>
        {committee && (
          <Link
            href={`/${org.slug}/workspace/minutes/${minutesId}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Attendees</h2>
        <p className="text-sm text-foreground-muted">
          {attendeeNames.length === 0 ? 'No attendees recorded.' : attendeeNames.join(', ')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Agenda</h2>
        {m.agendaItems.length === 0 ? (
          <p className="text-sm text-foreground-muted">No agenda items.</p>
        ) : (
          m.agendaItems.map((item, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <p className="font-medium">{item.topic}</p>
              <p className="text-sm text-foreground-muted">{item.notes}</p>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Action items</h2>
        {m.actionItems.length === 0 ? (
          <p className="text-sm text-foreground-muted">No action items.</p>
        ) : (
          m.actionItems.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
            >
              <span>{item.task}</span>
              {item.owner && <span className="text-foreground-muted">{item.owner}</span>}
            </div>
          ))
        )}
      </div>

      {committee && (
        <Button variant="destructive" size="sm" className="w-fit" onClick={() => setRemoving(true)}>
          Remove minutes
        </Button>
      )}

      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove these minutes?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(minutesId, {
                  onSuccess: () => router.push(`/${org.slug}/workspace`),
                });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/minutes/[minutesId]/page.tsx"
git commit -m "feat(frontend): minutes detail page"
```

---

### Task 9: Edit minutes page

**Files:**
- Create: `frontend/app/(app)/[orgSlug]/workspace/minutes/[minutesId]/edit/page.tsx`

**Interfaces:**
- Consumes: `MinutesForm` (Task 4), `useMinutes`, `useUpdateMinutes`
  (Task 1), `useOrg`, `isCommittee` (existing), `Skeleton` (existing).

- [ ] **Step 1: Write the page**

```tsx
'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { MinutesForm } from '@/components/minutes/minutes-form';
import { useMinutes, useUpdateMinutes } from '@/features/minutes/use-minutes';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

/** ISO date/datetime → the YYYY-MM-DD shape a date input needs. */
function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export default function EditMinutesPage({
  params,
}: {
  params: Promise<{ minutesId: string }>;
}) {
  const { minutesId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const minutes = useMinutes(org.id, minutesId);
  const update = useUpdateMinutes(org.id);

  useEffect(() => {
    if (!committee) router.replace(`/${org.slug}/workspace/minutes/${minutesId}`);
  }, [committee, router, org.slug, minutesId]);
  if (!committee) return null;

  if (minutes.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-1/2 rounded-md" />
        <Skeleton className="h-72 rounded-lg" />
      </main>
    );
  }

  if (minutes.isError) return null;

  const m = minutes.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Edit minutes</h1>
      <MinutesForm
        orgId={org.id}
        mode="edit"
        defaultValues={{
          title: m.title,
          meetingDate: isoToDateInput(m.meetingDate),
          attendeeMembershipIds: m.attendeeMembershipIds,
          agendaItems: m.agendaItems,
          actionItems: m.actionItems.map((a) => ({ task: a.task, owner: a.owner ?? '' })),
        }}
        isPending={update.isPending}
        error={update.error}
        onSubmit={(values) =>
          update.mutate(
            { minutesId, input: values },
            { onSuccess: () => router.push(`/${org.slug}/workspace/minutes/${minutesId}`) },
          )
        }
      />
    </main>
  );
}
```

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: 126 passed (unchanged from Task 6 — no new tests this task).

- [ ] **Step 3: Run build**

Run: `cd frontend && npm run build`
Expected: clean build, all three new `/workspace/minutes/*` routes listed.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/minutes/[minutesId]/edit/page.tsx"
git commit -m "feat(frontend): edit-minutes page"
```

---

### Task 10: Live verification

**No files changed in this task unless a bug is found.**

- [ ] **Step 1: Start the stack**

Ensure `docker compose` (postgres/minio/redis/mailpit) is up, backend dev
server and frontend dev server both running.

- [ ] **Step 2: Drive the full flow via Playwright, as a committee account**

- Navigate to `/workspace`, click the Minutes tab — confirm empty state
  and "New minutes" button (committee-only).
- Create minutes: title, meeting date, check 2+ attendees, add 2 agenda
  items, add 1 action item (with and without an owner) — submit, confirm
  redirect to the detail page showing everything correctly (attendee
  names resolved, agenda topics + notes, action item task + owner).
- Edit: add another attendee, add an agenda item, remove an action item —
  save, confirm the detail page reflects all changes.
- Remove with confirm — confirm redirect back to `/workspace` and the row
  is gone from the list.
- Pagination: seed 12+ additional minutes rows via a quick API script
  (same curl/python setup pattern as prior slices) so the list spans at
  least 2 pages at `PAGE_SIZE = 10` — confirm Next/Previous work and
  disable correctly at the first/last page.

- [ ] **Step 3: Switch to a non-committee account**

- Confirm the Minutes tab shows the list with no "New minutes" button.
- Open a minutes detail page — confirm no Edit/Remove buttons, and the
  attendees line reads "Committee member" repeated per attendee, not raw
  membership ids (the one specific regression risk flagged in the spec
  and plan).
- Attempt to navigate directly to `/workspace/minutes/new` and
  `/workspace/minutes/[id]/edit` as this account — confirm both redirect
  away rather than showing a dead-end form.

- [ ] **Step 4: Both themes**

Screenshot the Minutes tab and a detail page in light and dark mode —
confirm no domain-hue leakage, agenda/action item cards read clearly.

- [ ] **Step 5: If any bug is found**

Root-cause it (via `superpowers:systematic-debugging` if non-trivial), fix,
add a regression test if the bug was in testable logic (not a
presentational/live-only file), commit as its own commit
(`fix(frontend): <description>`), re-run the full test suite and build
before continuing.

- [ ] **Step 6: If zero bugs found**

No commit for this task (matches the precedent set by Slices 1, 2, 4, 5,
and 10's live-verification tasks).

---

## Post-implementation

After Task 10 passes with zero or fixed bugs: pause before docs-sync
(standing preference) — wait for "continue," then append a "Slice 11"
section to `docs/uiux.md` and update `docs/current-context.md` (mark this
sub-slice shipped — this completes the Workspace split; note Settings is
the last remaining unscoped placeholder). Then finish branch: verify
tests, merge `feature/frontend-slice11-workspace-minutes` to `main`
locally, delete the branch — no push, no asking (standing default).
