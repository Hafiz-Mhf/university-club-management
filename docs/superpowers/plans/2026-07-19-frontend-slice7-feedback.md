# Frontend Slice 7 — Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full frontend surface for the backend's already-shipped Event Feedback + NPS feature — participant feedback submission, committee aggregate summary, and the `requireFeedbackForCertificate` gate toggle on the event form.

**Architecture:** Pure-logic modules (`window.ts`, `panel-state.ts`, `schemas.ts`) get unit tests; presentational components (`rating-scale.tsx` is the one exception — it has real branching logic worth testing) follow this codebase's established convention of zero direct component tests, verified instead by `npm run build` and the final live-verification task. No new backend endpoints — every hook calls an existing, already-tested route.

**Tech Stack:** Next.js 18 App Router, TypeScript, TanStack Query, React Hook Form + Zod, Vitest + RTL, Tailwind v4.

## Global Constraints

- No changes to `backend/` in this slice (spec's "Out of scope" section) — the one prior exception (Slice 6's certificate-delete fix) does not recur here; if a real backend bug is found during live verification, it overrides this constraint the same way it did then.
- Follow existing conventions exactly: `retry: false` on any `.../me`-shaped query (404 is a meaningful answer, not a flake), `ApiError` top-error surfacing pattern from `event-form.tsx`/`register-dialog.tsx`, ISO date handling via native `Date`, no new shadcn components unless the existing set can't express the UI (it can, here).
- Frontend baseline going in: **76/76** unit tests passing, verified via `npm test -- --run` on 2026-07-19 (this session, before writing this plan). `npm run build` must stay clean after every task.
- One commit per task.

---

### Task 1: FeedbackResponse type + feedback window helper

**Files:**
- Modify: `frontend/types/api.ts` (add `FeedbackResponse` interface, near the other event-scoped interfaces like `Attendance`/`Certificate`)
- Create: `frontend/features/feedback/window.ts`
- Test: `frontend/features/feedback/__tests__/window.test.ts`

**Interfaces:**
- Produces: `FeedbackResponse { id: string; organizationId: string; eventId: string; userId: string; npsScore: number; contentRating: number; organizationRating: number; venueRating: number; comment: string | null; createdAt: string }` (types/api.ts). `FEEDBACK_WINDOW_MS: number` and `isFeedbackWindowOpen(event: Event, now: Date): boolean` (window.ts).

- [ ] **Step 1: Add the `FeedbackResponse` type**

In `frontend/types/api.ts`, find the `Certificate`/`MyCertificate` interfaces (Slice 6) and add directly after them:

```ts
export interface FeedbackResponse {
  id: string;
  organizationId: string;
  eventId: string;
  userId: string;
  npsScore: number;
  contentRating: number;
  organizationRating: number;
  venueRating: number;
  comment: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Write the failing test for `isFeedbackWindowOpen`**

Create `frontend/features/feedback/__tests__/window.test.ts`:

```ts
import { expect, it } from 'vitest';
import { isFeedbackWindowOpen, FEEDBACK_WINDOW_MS } from '@/features/feedback/window';
import type { Event } from '@/types/api';

const event = {
  endAt: '2026-01-01T00:00:00.000Z',
} as Event;

it('is open right after the event ends', () => {
  expect(isFeedbackWindowOpen(event, new Date('2026-01-01T00:00:01.000Z'))).toBe(true);
});

it('is open exactly at the 14-day boundary', () => {
  const boundary = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS);
  expect(isFeedbackWindowOpen(event, boundary)).toBe(true);
});

it('is closed one second past the boundary', () => {
  const pastBoundary = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS + 1000);
  expect(isFeedbackWindowOpen(event, pastBoundary)).toBe(false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run features/feedback/__tests__/window.test.ts`
Expected: FAIL — `Cannot find module '@/features/feedback/window'`

- [ ] **Step 4: Implement `window.ts`**

Create `frontend/features/feedback/window.ts`:

```ts
import type { Event } from '@/types/api';

// Mirrors backend/src/feedback/feedback.constants.ts FEEDBACK_WINDOW_MS —
// no shared package between frontend/backend anywhere in this codebase.
export const FEEDBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isFeedbackWindowOpen(event: Event, now: Date): boolean {
  const closesAt = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS);
  return now <= closesAt;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run features/feedback/__tests__/window.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/types/api.ts frontend/features/feedback/window.ts frontend/features/feedback/__tests__/window.test.ts
git commit -m "feat(frontend): FeedbackResponse type + feedback window helper"
```

---

### Task 2: Feedback form Zod schema

**Files:**
- Create: `frontend/features/feedback/schemas.ts`
- Test: `frontend/features/feedback/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `feedbackFormSchema: ZodSchema`, `type FeedbackFormInput = { npsScore: number; contentRating: number; organizationRating: number; venueRating: number; comment?: string }`.

- [ ] **Step 1: Write the failing test**

Create `frontend/features/feedback/__tests__/schemas.test.ts`:

```ts
import { expect, it } from 'vitest';
import { feedbackFormSchema } from '@/features/feedback/schemas';

const base = { npsScore: 9, contentRating: 5, organizationRating: 5, venueRating: 5 };

it('accepts a valid submission with no comment', () => {
  expect(feedbackFormSchema.safeParse(base).success).toBe(true);
});

it('accepts a valid submission with a comment', () => {
  expect(feedbackFormSchema.safeParse({ ...base, comment: 'Great event!' }).success).toBe(true);
});

it('rejects npsScore outside 0-10', () => {
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: 11 }).success).toBe(false);
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: -1 }).success).toBe(false);
});

it('rejects a non-integer npsScore', () => {
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: 7.5 }).success).toBe(false);
});

it('rejects ratings outside 1-5', () => {
  expect(feedbackFormSchema.safeParse({ ...base, contentRating: 0 }).success).toBe(false);
  expect(feedbackFormSchema.safeParse({ ...base, venueRating: 6 }).success).toBe(false);
});

it('rejects a comment over 2000 characters', () => {
  expect(feedbackFormSchema.safeParse({ ...base, comment: 'x'.repeat(2001) }).success).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/feedback/__tests__/schemas.test.ts`
Expected: FAIL — `Cannot find module '@/features/feedback/schemas'`

- [ ] **Step 3: Implement `schemas.ts`**

Create `frontend/features/feedback/schemas.ts`:

```ts
import { z } from 'zod';

// Mirrors backend SubmitFeedbackDto — the backend re-validates everything;
// these checks exist so obvious errors never leave the client.
export const feedbackFormSchema = z.object({
  npsScore: z.number().int().min(0).max(10),
  contentRating: z.number().int().min(1).max(5),
  organizationRating: z.number().int().min(1).max(5),
  venueRating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export type FeedbackFormInput = z.infer<typeof feedbackFormSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/feedback/__tests__/schemas.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/features/feedback/schemas.ts frontend/features/feedback/__tests__/schemas.test.ts
git commit -m "feat(frontend): feedback form Zod schema"
```

---

### Task 3: Feedback panel state resolver

**Files:**
- Create: `frontend/features/feedback/panel-state.ts`
- Test: `frontend/features/feedback/__tests__/panel-state.test.ts`

**Interfaces:**
- Consumes: `isFeedbackWindowOpen` (Task 1), `FeedbackResponse` (Task 1), `AttendanceStatus`/`Event` from `types/api.ts` (`AttendanceStatus = 'REGISTERED' | 'PRESENT' | 'ABSENT'`, already exists).
- Produces: `type FeedbackPanelState = 'hidden' | 'recap' | 'form' | 'window-closed'`, `resolveFeedbackPanelState(attendanceStatus: AttendanceStatus | undefined, feedback: FeedbackResponse | undefined, event: Event, now: Date): FeedbackPanelState` — consumed by Task 5's `my-feedback-panel.tsx`.

- [ ] **Step 1: Write the failing test**

Create `frontend/features/feedback/__tests__/panel-state.test.ts`:

```ts
import { expect, it } from 'vitest';
import { resolveFeedbackPanelState } from '@/features/feedback/panel-state';
import type { Event, FeedbackResponse } from '@/types/api';

const event = { endAt: '2026-01-01T00:00:00.000Z' } as Event;
const submitted = { id: 'f1' } as FeedbackResponse;
const withinWindow = new Date('2026-01-05T00:00:00.000Z');
const afterWindow = new Date('2026-02-01T00:00:00.000Z');

it('is hidden for a non-attendee', () => {
  expect(resolveFeedbackPanelState(undefined, undefined, event, withinWindow)).toBe('hidden');
});

it('is hidden for someone marked ABSENT', () => {
  expect(resolveFeedbackPanelState('ABSENT', undefined, event, withinWindow)).toBe('hidden');
});

it('is hidden for someone only REGISTERED, never checked in', () => {
  expect(resolveFeedbackPanelState('REGISTERED', undefined, event, withinWindow)).toBe('hidden');
});

it('shows the recap once a PRESENT attendee has submitted, even after the window closes', () => {
  expect(resolveFeedbackPanelState('PRESENT', submitted, event, afterWindow)).toBe('recap');
});

it('shows the form for a PRESENT attendee within the window who has not submitted', () => {
  expect(resolveFeedbackPanelState('PRESENT', undefined, event, withinWindow)).toBe('form');
});

it('shows window-closed for a PRESENT attendee who never submitted and the window has closed', () => {
  expect(resolveFeedbackPanelState('PRESENT', undefined, event, afterWindow)).toBe('window-closed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/feedback/__tests__/panel-state.test.ts`
Expected: FAIL — `Cannot find module '@/features/feedback/panel-state'`

- [ ] **Step 3: Implement `panel-state.ts`**

Create `frontend/features/feedback/panel-state.ts`:

```ts
import type { AttendanceStatus, Event, FeedbackResponse } from '@/types/api';
import { isFeedbackWindowOpen } from './window';

export type FeedbackPanelState = 'hidden' | 'recap' | 'form' | 'window-closed';

export function resolveFeedbackPanelState(
  attendanceStatus: AttendanceStatus | undefined,
  feedback: FeedbackResponse | undefined,
  event: Event,
  now: Date,
): FeedbackPanelState {
  if (attendanceStatus !== 'PRESENT') return 'hidden';
  if (feedback) return 'recap';
  return isFeedbackWindowOpen(event, now) ? 'form' : 'window-closed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/feedback/__tests__/panel-state.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/features/feedback/panel-state.ts frontend/features/feedback/__tests__/panel-state.test.ts
git commit -m "feat(frontend): feedback panel state resolver"
```

---

### Task 4: RatingScale component

**Files:**
- Create: `frontend/components/feedback/rating-scale.tsx`
- Test: `frontend/components/feedback/__tests__/rating-scale.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (existing).
- Produces: `RatingScale({ min, max, value, onChange, label }: { min: number; max: number; value: number | undefined; onChange: (value: number) => void; label: string })` — consumed by Task 5's `my-feedback-panel.tsx` for all four scores (NPS: min=0,max=10; the three ratings: min=1,max=5).

- [ ] **Step 1: Write the failing test**

Create `frontend/components/feedback/__tests__/rating-scale.test.tsx`:

```tsx
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RatingScale } from '@/components/feedback/rating-scale';

it('renders one button per value in the range, inclusive', () => {
  render(<RatingScale min={1} max={5} value={undefined} onChange={vi.fn()} label="Content" />);
  expect(screen.getAllByRole('button')).toHaveLength(5);
});

it('renders 11 buttons for a 0-10 scale', () => {
  render(<RatingScale min={0} max={10} value={undefined} onChange={vi.fn()} label="NPS" />);
  expect(screen.getAllByRole('button')).toHaveLength(11);
});

it('calls onChange with the clicked value', async () => {
  const onChange = vi.fn();
  render(<RatingScale min={1} max={5} value={undefined} onChange={onChange} label="Content" />);
  await userEvent.click(screen.getByRole('button', { name: '4' }));
  expect(onChange).toHaveBeenCalledWith(4);
});

it('marks the selected value pressed', () => {
  render(<RatingScale min={1} max={5} value={3} onChange={vi.fn()} label="Content" />);
  expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'false');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run components/feedback/__tests__/rating-scale.test.tsx`
Expected: FAIL — `Cannot find module '@/components/feedback/rating-scale'`

- [ ] **Step 3: Implement `rating-scale.tsx`**

Create `frontend/components/feedback/rating-scale.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils';

interface RatingScaleProps {
  min: number;
  max: number;
  value: number | undefined;
  onChange: (value: number) => void;
  label: string;
}

export function RatingScale({ min, max, value, onChange, label }: RatingScaleProps) {
  const options = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-pressed={value === n}
            className={cn(
              'flex size-8 items-center justify-center rounded-md border border-border text-sm transition-colors',
              value === n ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/40',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run components/feedback/__tests__/rating-scale.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/components/feedback/rating-scale.tsx frontend/components/feedback/__tests__/rating-scale.test.tsx
git commit -m "feat(frontend): RatingScale button-row control"
```

---

### Task 5: Feedback hooks + participant panel, wired into event detail

**Files:**
- Create: `frontend/features/feedback/use-feedback.ts`
- Create: `frontend/components/feedback/my-feedback-panel.tsx`
- Modify: `frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx:1-22,131-135` (add import + render `MyFeedbackPanel` after `MyCertificatePanel`)

**Interfaces:**
- Consumes: `FeedbackResponse` (Task 1), `feedbackFormSchema`/`FeedbackFormInput` (Task 2), `resolveFeedbackPanelState` (Task 3), `RatingScale` (Task 4), `useMyAttendance` from `@/features/attendance/use-attendance` (existing, returns `{ data: MyAttendance | undefined, isPending }` where `MyAttendance extends Attendance` and `Attendance.status: AttendanceStatus`), `api` from `@/lib/api`, `ApiError` from `@/lib/api`.
- Produces: `useMyFeedback(orgId, eventId)`, `useSubmitFeedback(orgId, eventId)` (both consumed only within this task and Task 6 doesn't need them), `MyFeedbackPanel({ orgId, event }: { orgId: string; event: Event })` — consumed by the event-detail page.

No test file for this task — hooks and this panel component have no isolated unit test in this codebase's established convention (mirrors `MyRegistrationPanel`/`MyCertificatePanel`, neither of which has a test file; their correctness is verified by the pure-logic tests they call into, plus Task 8's live verification). Deliverable is verified by `npm run build` passing.

- [ ] **Step 1: Implement `use-feedback.ts`**

Create `frontend/features/feedback/use-feedback.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FeedbackResponse } from '@/types/api';
import type { FeedbackFormInput } from './schemas';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/feedback`;
}

export interface FeedbackSummary {
  responseCount: number;
  avgNpsScore: number | null;
  avgContentRating: number | null;
  avgOrganizationRating: number | null;
  avgVenueRating: number | null;
  comments: string[];
}

export function useMyFeedback(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'feedback', 'me'],
    queryFn: () => api<FeedbackResponse>(`${base(orgId, eventId)}/me`),
    retry: false, // a 404 here is a meaningful answer (not submitted yet), not a flake
  });
}

export function useFeedbackSummary(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'feedback', 'summary'],
    queryFn: () => api<FeedbackSummary>(`${base(orgId, eventId)}/summary`),
  });
}

export function useSubmitFeedback(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FeedbackFormInput) =>
      api<FeedbackResponse>(base(orgId, eventId), { method: 'POST', body: input }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'feedback', 'me'] }),
  });
}
```

- [ ] **Step 2: Implement `my-feedback-panel.tsx`**

Create `frontend/components/feedback/my-feedback-panel.tsx`:

```tsx
'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RatingScale } from '@/components/feedback/rating-scale';
import { useMyAttendance } from '@/features/attendance/use-attendance';
import { useMyFeedback, useSubmitFeedback } from '@/features/feedback/use-feedback';
import { resolveFeedbackPanelState } from '@/features/feedback/panel-state';
import { feedbackFormSchema, type FeedbackFormInput } from '@/features/feedback/schemas';
import { ApiError } from '@/lib/api';
import type { Event } from '@/types/api';

export function MyFeedbackPanel({ orgId, event }: { orgId: string; event: Event }) {
  const attendance = useMyAttendance(orgId, event.id);
  const feedback = useMyFeedback(orgId, event.id);

  if (attendance.isPending || feedback.isPending) return null;

  const state = resolveFeedbackPanelState(attendance.data?.status, feedback.data, event, new Date());

  if (state === 'hidden') return null;

  if (state === 'window-closed') {
    return (
      <p className="text-sm text-foreground-muted">The feedback window for this event has closed.</p>
    );
  }

  if (state === 'recap' && feedback.data) {
    const f = feedback.data;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">
        <p className="font-medium">Your feedback</p>
        <p className="text-foreground-muted">
          NPS {f.npsScore}/10 · Content {f.contentRating}/5 · Organization {f.organizationRating}/5 ·{' '}
          Venue {f.venueRating}/5
        </p>
        {f.comment && <p className="text-foreground-muted">&quot;{f.comment}&quot;</p>}
      </div>
    );
  }

  return <FeedbackForm orgId={orgId} eventId={event.id} />;
}

function FeedbackForm({ orgId, eventId }: { orgId: string; eventId: string }) {
  const submit = useSubmitFeedback(orgId, eventId);
  const form = useForm<FeedbackFormInput>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: { comment: '' },
  });

  const topError =
    submit.error instanceof ApiError
      ? submit.error.message
      : submit.error
        ? 'Something went wrong — please try again'
        : null;

  return (
    <form
      onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      className="flex flex-col gap-4 rounded-lg border border-border p-3"
      noValidate
    >
      <p className="font-medium">How was this event?</p>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}
      <Controller
        control={form.control}
        name="npsScore"
        render={({ field }) => (
          <RatingScale
            min={0}
            max={10}
            value={field.value}
            onChange={field.onChange}
            label="How likely are you to recommend this event? (0-10)"
          />
        )}
      />
      <Controller
        control={form.control}
        name="contentRating"
        render={({ field }) => (
          <RatingScale min={1} max={5} value={field.value} onChange={field.onChange} label="Content (1-5)" />
        )}
      />
      <Controller
        control={form.control}
        name="organizationRating"
        render={({ field }) => (
          <RatingScale
            min={1}
            max={5}
            value={field.value}
            onChange={field.onChange}
            label="Organization (1-5)"
          />
        )}
      />
      <Controller
        control={form.control}
        name="venueRating"
        render={({ field }) => (
          <RatingScale min={1} max={5} value={field.value} onChange={field.onChange} label="Venue (1-5)" />
        )}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="comment">Comment (optional)</Label>
        <Textarea id="comment" rows={3} {...form.register('comment')} />
      </div>
      <div>
        <Button type="submit" disabled={submit.isPending}>
          {submit.isPending && <Loader2 className="size-4 animate-spin" />}
          Submit feedback
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Wire `MyFeedbackPanel` into the event detail page**

In `frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx`, add the import next to the other panel imports (after the `MyCertificatePanel` import at line 12):

```ts
import { MyFeedbackPanel } from '@/components/feedback/my-feedback-panel';
```

Then in the overview section (after the `<MyCertificatePanel .../>` line, currently line 133), add:

```tsx
          <MyFeedbackPanel orgId={org.id} event={e} />
```

So the order becomes: `MyRegistrationPanel` → `MyCertificatePanel` → `MyFeedbackPanel` → `LifecycleActions`.

- [ ] **Step 4: Verify the full suite still passes and the build is clean**

Run: `cd frontend && npm test -- --run`
Expected: PASS, 76 (baseline) + 3 (window) + 6 (feedback schemas) + 6 (panel-state) + 4 (rating-scale) = 95 tests, 0 failures

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/features/feedback/use-feedback.ts frontend/components/feedback/my-feedback-panel.tsx "frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx"
git commit -m "feat(frontend): feedback submission panel wired into event detail"
```

---

### Task 6: Committee feedback summary — page + event picker

**Files:**
- Create: `frontend/components/feedback/feedback-summary.tsx`
- Modify: `frontend/app/(app)/[orgSlug]/feedback/page.tsx` (replace the `PlaceholderPage` entirely)
- Create: `frontend/app/(app)/[orgSlug]/feedback/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `useFeedbackSummary` (Task 5), `useEvents`/`useEvent` from `@/features/events/use-events` (existing), `isCommittee` from `@/features/orgs/roles` (existing), `useOrg` from `@/features/orgs/org-provider` (existing).
- Produces: `FeedbackSummary({ orgId, eventId }: { orgId: string; eventId: string })` — a page-level component, no further consumers.

No test file — matches `CertificateManager`/`AttendanceRoster`, neither of which has a direct test; `useFeedbackSummary`'s only logic is the fetch itself (no branching to unit test beyond what Task 5 already covers). Deliverable verified by `npm run build`.

- [ ] **Step 1: Implement `feedback-summary.tsx`**

Create `frontend/components/feedback/feedback-summary.tsx`:

```tsx
'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeedbackSummary } from '@/features/feedback/use-feedback';

function fmt(v: number | null) {
  return v === null ? '—' : v.toFixed(1);
}

export function FeedbackSummary({ orgId, eventId }: { orgId: string; eventId: string }) {
  const summary = useFeedbackSummary(orgId, eventId);

  if (summary.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load feedback for this event.</p>;
  }

  const s = summary.data;

  if (s.responseCount === 0) {
    return (
      <p className="py-8 text-center text-sm text-foreground-muted">
        No feedback submitted for this event yet.
      </p>
    );
  }

  const tiles: [string, string][] = [
    ['NPS', fmt(s.avgNpsScore)],
    ['Content', fmt(s.avgContentRating)],
    ['Organization', fmt(s.avgOrganizationRating)],
    ['Venue', fmt(s.avgVenueRating)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <Card key={label} className="shadow-card">
            <CardContent className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-foreground-muted uppercase">
                {label}
              </span>
              <span className="font-heading text-2xl font-semibold tabular-nums">{value}</span>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-foreground-muted">
        {s.responseCount} response{s.responseCount === 1 ? '' : 's'}
      </p>
      {s.comments.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Comments</p>
          {s.comments.map((c, i) => (
            <p key={i} className="rounded-lg border border-border p-3 text-sm text-foreground-muted">
              &quot;{c}&quot;
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace the feedback list page placeholder**

Replace the full contents of `frontend/app/(app)/[orgSlug]/feedback/page.tsx` (currently just `PlaceholderPage`) with:

```tsx
'use client';

import Link from 'next/link';
import { MessageSquareHeart } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvents } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function FeedbackPage() {
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const events = useEvents(org.id);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <MessageSquareHeart className="size-5 text-domain-feedback" />
        </div>
        <h1 className="text-xl font-semibold">Feedback</h1>
        <p className="text-sm text-foreground-muted">
          Feedback summaries are for committee. Submit your own feedback on an event&apos;s page
          after attending.
        </p>
      </main>
    );
  }

  const nonDraft = (events.data ?? []).filter((e) => e.status !== 'DRAFT');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      {events.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}
      {events.data && nonDraft.length === 0 && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No events to view feedback for yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {nonDraft.map((e) => (
          <Link
            key={e.id}
            href={`/${org.slug}/feedback/${e.id}`}
            className="rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
          >
            {e.title}
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create the per-event feedback summary page**

Create `frontend/app/(app)/[orgSlug]/feedback/[eventId]/page.tsx`:

```tsx
'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedbackSummary } from '@/components/feedback/feedback-summary';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function FeedbackSummaryPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const event = useEvent(org.id, eventId);

  useEffect(() => {
    if (!eligible) router.replace(`/${org.slug}/feedback`);
  }, [eligible, router, org.slug]);
  if (!eligible) return null;

  if (event.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (event.isError || !event.data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 text-center lg:p-6">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load this event.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/feedback`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>
      <h1 className="text-2xl font-semibold">{event.data.title}</h1>
      <FeedbackSummary orgId={org.id} eventId={eventId} />
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 5: Commit**

```bash
git add frontend/components/feedback/feedback-summary.tsx "frontend/app/(app)/[orgSlug]/feedback/page.tsx" "frontend/app/(app)/[orgSlug]/feedback/[eventId]/page.tsx"
git commit -m "feat(frontend): committee feedback summary page + event picker"
```

---

### Task 7: requireFeedbackForCertificate gate toggle on the event form

**Files:**
- Modify: `frontend/features/events/schemas.ts` (add `requireFeedbackForCertificate` field)
- Modify: `frontend/features/events/use-events.ts:8-17` (`toBody` sends the field)
- Modify: `frontend/components/events/event-form.tsx` (add the checkbox)
- Modify: `frontend/app/(app)/[orgSlug]/events/[eventId]/edit/page.tsx:66-73` (pass the current value as a default)
- Test: `frontend/features/events/__tests__/schemas.test.ts` (extend existing file, do not replace)

**Interfaces:**
- Produces: `EventFormInput` gains `requireFeedbackForCertificate: boolean` (via `z.boolean().default(false)`, so every existing call site/test that omits the field still parses successfully — output is typed `boolean`, not `boolean | undefined`).

- [ ] **Step 1: Write the failing test (extend the existing file)**

In `frontend/features/events/__tests__/schemas.test.ts`, add at the end of the file:

```ts
it('defaults requireFeedbackForCertificate to false when omitted', () => {
  const r = eventFormSchema.safeParse(base);
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.requireFeedbackForCertificate).toBe(false);
});

it('accepts an explicit true', () => {
  const r = eventFormSchema.safeParse({ ...base, requireFeedbackForCertificate: true });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.requireFeedbackForCertificate).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/events/__tests__/schemas.test.ts`
Expected: FAIL — `r.data.requireFeedbackForCertificate` is `undefined`, not `false`

- [ ] **Step 3: Add the field to `eventFormSchema`**

In `frontend/features/events/schemas.ts`, add `requireFeedbackForCertificate: z.boolean().default(false),` as the last field inside the `.object({...})` block (after `capacity`), before the closing `})`:

```ts
export const eventFormSchema = z
  .object({
    title: z.string().min(2, 'Title must be at least 2 characters'),
    description: z.string().optional(),
    venue: z.string().optional(),
    startAt: z.string().min(1, 'Start date/time is required'),
    endAt: z.string().min(1, 'End date/time is required'),
    capacity: z.string().optional(),
    requireFeedbackForCertificate: z.boolean().default(false),
  })
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), {
    message: 'End must be after start',
    path: ['endAt'],
  })
  .refine((v) => !v.capacity || (Number.isInteger(Number(v.capacity)) && Number(v.capacity) >= 1), {
    message: 'Capacity must be a positive whole number',
    path: ['capacity'],
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/events/__tests__/schemas.test.ts`
Expected: PASS (7 original + 2 new = 9 tests)

- [ ] **Step 5: Send the field in `toBody`**

In `frontend/features/events/use-events.ts`, update `toBody`:

```ts
function toBody(input: EventFormInput) {
  return {
    title: input.title,
    description: input.description || undefined,
    venue: input.venue || undefined,
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
    capacity: input.capacity ? Number(input.capacity) : undefined,
    requireFeedbackForCertificate: input.requireFeedbackForCertificate,
  };
}
```

- [ ] **Step 6: Add the checkbox to `EventForm`**

In `frontend/components/events/event-form.tsx`, add `requireFeedbackForCertificate: false,` to the `useForm` `defaultValues` object (after `capacity: '',`):

```ts
  const form = useForm<EventFormInput>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      title: '',
      description: '',
      venue: '',
      startAt: '',
      endAt: '',
      capacity: '',
      requireFeedbackForCertificate: false,
      ...defaultValues,
    },
  });
```

Then add the checkbox field itself, right after the `Capacity` `Field` block and before the submit `<Button>` div:

```tsx
      <div className="flex items-center gap-2">
        <input
          id="requireFeedbackForCertificate"
          type="checkbox"
          {...form.register('requireFeedbackForCertificate')}
        />
        <Label htmlFor="requireFeedbackForCertificate" className="font-normal">
          Require feedback before releasing certificates
        </Label>
      </div>
```

- [ ] **Step 7: Pass the current value as a default on the edit page**

In `frontend/app/(app)/[orgSlug]/events/[eventId]/edit/page.tsx`, add `requireFeedbackForCertificate: e.requireFeedbackForCertificate,` to the `defaultValues` object passed to `<EventForm>` (after `capacity: e.capacity === null ? '' : String(e.capacity),`):

```tsx
        defaultValues={{
          title: e.title,
          description: e.description ?? '',
          venue: e.venue ?? '',
          startAt: isoToLocalInput(e.startAt),
          endAt: isoToLocalInput(e.endAt),
          capacity: e.capacity === null ? '' : String(e.capacity),
          requireFeedbackForCertificate: e.requireFeedbackForCertificate,
        }}
```

- [ ] **Step 8: Verify the full suite still passes and the build is clean**

Run: `cd frontend && npm test -- --run`
Expected: PASS, 98 + 2 = 100 tests, 0 failures

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors

- [ ] **Step 9: Commit**

```bash
git add frontend/features/events/schemas.ts frontend/features/events/__tests__/schemas.test.ts frontend/features/events/use-events.ts frontend/components/events/event-form.tsx "frontend/app/(app)/[orgSlug]/events/[eventId]/edit/page.tsx"
git commit -m "feat(frontend): requireFeedbackForCertificate toggle on event form"
```

---

### Task 8: Live verification (pause before this task — standing preference)

No code changes. Drive the real flow against the real dev backend (`docker compose up -d` first if the stack has stopped since the last session), both themes.

- [ ] **Step 1: Start backend + frontend dev servers**

Run: `cd backend && docker compose up -d` (only if not already running)
Run: `cd backend && npm run start:dev` (or confirm already running)
Run: `cd frontend && npm run dev` (or confirm already running)

- [ ] **Step 2: Full participant → committee cycle**

As a PRESIDENT/committee account: create + publish an event with `requireFeedbackForCertificate` checked, complete it after a PRESENT attendee exists (reuse the register→scan flow from Slice 5/6 verification). As the PRESENT participant account: open the event detail page, confirm the feedback form appears (not hidden, not window-closed), submit a rating set + comment, confirm the panel now shows the read-only recap with the submitted values. As committee: open `/feedback`, pick the event, confirm the summary page shows the correct averages and the comment. Confirm a non-attendee account sees no feedback panel on the event page and a non-committee account sees the explainer at `/feedback`.

- [ ] **Step 3: Confirm the gate toggle round-trips**

Edit an event, check `requireFeedbackForCertificate`, save, reload the edit page, confirm the checkbox is still checked (round-trips through the backend correctly).

- [ ] **Step 4: Screenshot both themes**

Screenshot the feedback form, the recap, and the committee summary page in both light and dark mode; confirm no domain-hue leakage onto non-icon elements (mirrors every prior slice's check).

- [ ] **Step 5: Record findings**

If zero bugs found: no commit (mirrors Slices 1/2/4/5). If any bug is found: fix it, add/adjust a test if the bug was in unit-testable logic, commit with a `fix(frontend):` (or `fix(backend):` if a genuine pre-existing backend defect is surfaced, per Slice 6's precedent) message.

---

## Post-implementation (outside this plan, per standing workflow)

After Task 8 passes with zero or fixed bugs: **pause before docs-sync** (standing preference) — wait for "continue," then append a "Slice 7" section to `docs/uiux.md` and update `docs/current-context.md`. Then **finish branch**: verify tests, merge `feature/frontend-slice7-feedback` to `main` locally, delete the branch — no push, no asking (standing default).

---

## Self-Review Notes

- **Spec coverage:** every architecture bullet in the spec maps to a task — types/hooks/schemas/window/panel-state (Tasks 1-3, 5), `rating-scale.tsx` (Task 4), `my-feedback-panel.tsx` + event-detail wiring (Task 5), `feedback-summary.tsx` + both feedback pages (Task 6), event-form gate toggle (Task 7), live verification (Task 8). RBAC section covered by `isCommittee` reuse in Tasks 6-7, no new role helper introduced (per spec). "Out of scope" section respected — no backend changes, no per-response table, no countdown UI.
- **Placeholder scan:** no TBD/TODO; every step has complete, exact code.
- **Type consistency:** `FeedbackResponse` (Task 1) → consumed identically in `use-feedback.ts` (Task 5) and `my-feedback-panel.tsx` (Task 5) and `panel-state.ts` (Task 3) — same field names throughout (`npsScore`, `contentRating`, `organizationRating`, `venueRating`, `comment`). `resolveFeedbackPanelState`'s signature (Task 3) matches its call site in `my-feedback-panel.tsx` (Task 5) exactly, including the `now: Date` parameter. `RatingScale`'s props (Task 4) match every `Controller` usage in `my-feedback-panel.tsx` (Task 5). `eventFormSchema`'s new field (Task 7) is consumed identically by `toBody`, `EventForm`'s `defaultValues`, and the edit page's `defaultValues` prop — same name (`requireFeedbackForCertificate`) and type (`boolean`) throughout.
- **Test count arithmetic:** verified against the actual per-file test counts written into each task (3 window + 6 feedback-schema + 6 panel-state + 4 rating-scale + 2 event-schema-extension = 21 new tests) — 76 (baseline) → 95 after Task 5 → 97 final after Task 7. Both running totals are stated correctly inline at their Step 4/Step 8 checkpoints.
