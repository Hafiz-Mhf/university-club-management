# Frontend Slice 15 (Achievements Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship committee-side achievements management (create/edit/remove), completing the Public Page nav area's second tab and the whole three-part Public Club Page epic.

**Architecture:** Modal-dialog CRUD, same shape as Slice 10's Assets. Data layer wraps the already-shipped `AchievementsController`. No new backend endpoints.

**Tech Stack:** Next.js App Router, TanStack Query, React Hook Form + Zod.

## Global Constraints

- Frontend test baseline going in: **149/149**. Backend baseline: **101 unit / 327 e2e** (untouched this slice — `AchievementsController`/`AchievementsService` already fully shipped in Phase 2).
- RBAC (verified against `backend/src/achievements/achievements.controller.ts`): `list`/`findOne` — any authenticated org member (no `RolesGuard`); `create`/`update`/`remove` — `MANAGE_EVENTS` tier (`isCommittee`).
- `AchievementsService.list()` returns the **full** Prisma row (no `select` clause), which includes `createdByUserId` — the same shape of risk as Assets' `createdByUserId`. This plan avoids it the same way the spec already decided: `AchievementsList` renders only `title`/`year`/`description`, never `createdByUserId`, so there is nothing to resolve or leak. No `useMembers` call, no name-resolution helper, no guard needed in this feature — noted here so a future reviewer doesn't wonder why the Files/Assets/Minutes/`members.isError` guard pattern is absent.
- Backend DTOs to mirror: `CreateAchievementDto`/`UpdateAchievementDto` (`backend/src/achievements/dto/`) — `title` (`@IsString @MinLength(1)`), `description` (`@IsString @MinLength(1)`), `year` (`@IsInt`, no bound either side).
- One commit per task. Pause before Task 1 (after branch creation), pause before Task 6 (live verification), pause before docs-sync. Always merge-to-main on finish, no push.

---

### Task 1: Achievement type + data hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Create: `frontend/features/achievements/use-achievements.ts`

**Interfaces:**
- Produces: `Achievement { id: string; title: string; description: string; year: number; createdByUserId: string; createdAt: string; updatedAt: string }`; `useAchievements(orgId)`, `useCreateAchievement(orgId)`, `useUpdateAchievement(orgId)`, `useRemoveAchievement(orgId)`.

No test file for this task — matches this project's convention for thin `api()`-wrapping hook files.

- [ ] **Step 1: Add the `Achievement` type**

Append to `frontend/types/api.ts` (anywhere at top level — e.g. after the `GalleryPhoto` interface):

```typescript
export interface Achievement {
  id: string;
  title: string;
  description: string;
  year: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Implement the data hooks**

```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Achievement } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/achievements`;
}

export function useAchievements(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'achievements'],
    queryFn: () => api<Achievement[]>(base(orgId)),
  });
}

function useInvalidateAchievements(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['org', orgId, 'achievements'] });
}

export interface AchievementInput {
  title: string;
  description: string;
  year: number;
}

export function useCreateAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: (input: AchievementInput) =>
      api<Achievement>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: ({ achievementId, input }: { achievementId: string; input: AchievementInput }) =>
      api<Achievement>(`${base(orgId)}/${achievementId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useRemoveAchievement(orgId: string) {
  const invalidate = useInvalidateAchievements(orgId);
  return useMutation({
    mutationFn: (achievementId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${achievementId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

Save as `frontend/features/achievements/use-achievements.ts`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/achievements/use-achievements.ts
git commit -m "feat(frontend): achievements data layer (list/create/update/remove)"
```

---

### Task 2: Achievement form schema

**Files:**
- Create: `frontend/features/achievements/schema.ts`
- Test: `frontend/features/achievements/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `achievementFormSchema`, `type AchievementFormValues = { title: string; description: string; year: string }`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, it } from 'vitest';
import { achievementFormSchema } from '@/features/achievements/schema';

const base = {
  title: 'Best Club Award',
  description: 'Recognized for outstanding engagement.',
  year: '2025',
};

it('accepts a valid submission', () => {
  expect(achievementFormSchema.safeParse(base).success).toBe(true);
});

it('rejects an empty title', () => {
  expect(achievementFormSchema.safeParse({ ...base, title: '' }).success).toBe(false);
});

it('rejects an empty description', () => {
  expect(achievementFormSchema.safeParse({ ...base, description: '' }).success).toBe(false);
});

it('rejects a non-integer year', () => {
  expect(achievementFormSchema.safeParse({ ...base, year: '2025.5' }).success).toBe(false);
});

it('rejects an empty year', () => {
  expect(achievementFormSchema.safeParse({ ...base, year: '' }).success).toBe(false);
});
```

Save as `frontend/features/achievements/__tests__/schema.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run features/achievements/__tests__/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { z } from 'zod';

// Mirrors backend CreateAchievementDto/UpdateAchievementDto. year has no
// min/max bound on either side — the backend DTO only checks @IsInt, so
// the frontend doesn't invent a stricter rule than the backend enforces.
export const achievementFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  year: z.string().refine((v) => Number.isInteger(Number(v)) && v.trim() !== '', 'Year must be a whole number'),
});

export type AchievementFormValues = z.infer<typeof achievementFormSchema>;
```

Save as `frontend/features/achievements/schema.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run features/achievements/__tests__/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/achievements/schema.ts frontend/features/achievements/__tests__/schema.test.ts
git commit -m "feat(frontend): achievement form schema"
```

---

### Task 3: AchievementDialog

**Files:**
- Create: `frontend/components/achievements/achievement-dialog.tsx`

**Interfaces:**
- Consumes: `useCreateAchievement`, `useUpdateAchievement`, `AchievementInput` (Task 1); `achievementFormSchema`, `AchievementFormValues` (Task 2).
- Produces: `<AchievementDialog orgId={string} achievement?={Achievement} onClose={() => void} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateAchievement, useUpdateAchievement } from '@/features/achievements/use-achievements';
import { achievementFormSchema, type AchievementFormValues } from '@/features/achievements/schema';
import { ApiError } from '@/lib/api';
import type { Achievement } from '@/types/api';

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

// Conditionally mounted by the caller (rendered only while open, no `open`
// prop) — same reset-bug-avoidance shape as Slice 10's AssetDialog: a
// fresh mount always starts from its own defaultValues.
export function AchievementDialog({
  orgId,
  achievement,
  onClose,
}: {
  orgId: string;
  achievement?: Achievement;
  onClose: () => void;
}) {
  const isEdit = Boolean(achievement);
  const create = useCreateAchievement(orgId);
  const update = useUpdateAchievement(orgId);
  const isPending = create.isPending || update.isPending;

  const form = useForm<AchievementFormValues>({
    resolver: zodResolver(achievementFormSchema),
    defaultValues: achievement
      ? {
          title: achievement.title,
          description: achievement.description,
          year: String(achievement.year),
        }
      : { title: '', description: '', year: String(new Date().getFullYear()) },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      title: values.title,
      description: values.description,
      year: Number(values.year),
    };
    if (achievement) {
      update.mutate({ achievementId: achievement.id, input }, { onSuccess: onClose });
    } else {
      create.mutate(input, { onSuccess: onClose });
    }
  });

  const mutationError = create.error ?? update.error;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit achievement' : 'Add achievement'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Title" htmlFor="achievement-title" error={errors.title?.message}>
            <Input id="achievement-title" {...form.register('title')} />
          </Field>
          <Field label="Description" htmlFor="achievement-description" error={errors.description?.message}>
            <Textarea id="achievement-description" {...form.register('description')} />
          </Field>
          <Field label="Year" htmlFor="achievement-year" error={errors.year?.message}>
            <Input id="achievement-year" inputMode="numeric" {...form.register('year')} />
          </Field>
          {mutationError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {mutationError instanceof ApiError ? mutationError.message : 'Something went wrong'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Save as `frontend/components/achievements/achievement-dialog.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/achievements/achievement-dialog.tsx
git commit -m "feat(frontend): AchievementDialog"
```

---

### Task 4: AchievementsList

**Files:**
- Create: `frontend/components/achievements/achievements-list.tsx`

**Interfaces:**
- Consumes: `useAchievements`, `useRemoveAchievement` (Task 1).
- Produces: `<AchievementsList orgId={string} canManage={boolean} onEdit={(achievement: Achievement) => void} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAchievements, useRemoveAchievement } from '@/features/achievements/use-achievements';
import type { Achievement } from '@/types/api';

export function AchievementsList({
  orgId,
  canManage,
  onEdit,
}: {
  orgId: string;
  canManage: boolean;
  onEdit: (achievement: Achievement) => void;
}) {
  const achievements = useAchievements(orgId);
  const remove = useRemoveAchievement(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (achievements.isPending) return null;
  if (achievements.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load achievements.</p>;
  }
  if (achievements.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No achievements yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {achievements.data.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {a.title} <span className="text-foreground-muted">— {a.year}</span>
            </p>
            <p className="text-foreground-muted">{a.description}</p>
          </div>
          {canManage && (
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
                Edit
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setRemoving(a.id)}>
                Remove
              </Button>
            </div>
          )}
        </div>
      ))}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove achievement?</DialogTitle>
            <DialogDescription>This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing, { onSuccess: () => setRemoving(null) });
              }}
            >
              {remove.isPending && <Loader2 className="size-4 animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Save as `frontend/components/achievements/achievements-list.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/achievements/achievements-list.tsx
git commit -m "feat(frontend): AchievementsList with remove confirm"
```

---

### Task 5: Page wiring — Achievements tab

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/public-page/page.tsx`

**Interfaces:**
- Consumes: `AchievementDialog` (Task 3), `AchievementsList` (Task 4).
- Produces: the real Achievements tab, replacing the "Coming in a later sub-slice" placeholder.

- [ ] **Step 1: Replace the page's full contents**

The current file (from Slice 14) has a `Tab` switcher and a placeholder Achievements branch. Replace the entire contents of `frontend/app/(app)/[orgSlug]/public-page/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GalleryUploadForm } from '@/components/gallery/gallery-upload-form';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { AchievementDialog } from '@/components/achievements/achievement-dialog';
import { AchievementsList } from '@/components/achievements/achievements-list';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';
import type { Achievement } from '@/types/api';

type Tab = 'gallery' | 'achievements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'achievements', label: 'Achievements' },
];

type AchievementDialogState = { mode: 'create' } | { mode: 'edit'; achievement: Achievement } | null;

export default function PublicPagePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('gallery');
  const [achievementDialog, setAchievementDialog] = useState<AchievementDialogState>(null);
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Public Page</h1>
        {tab === 'achievements' && committee && (
          <Button size="sm" onClick={() => setAchievementDialog({ mode: 'create' })}>
            <Plus className="size-3.5" />
            Add achievement
          </Button>
        )}
      </div>

      <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t.id)}
            className={cn(tab === t.id && 'bg-primary/10 text-primary')}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'gallery' && (
        <div className="flex flex-col gap-4">
          {committee && <GalleryUploadForm orgId={org.id} />}
          <GalleryGrid orgId={org.id} canManage={committee} />
        </div>
      )}
      {tab === 'achievements' && (
        <AchievementsList
          orgId={org.id}
          canManage={committee}
          onEdit={(achievement) => setAchievementDialog({ mode: 'edit', achievement })}
        />
      )}

      {achievementDialog && (
        <AchievementDialog
          orgId={org.id}
          achievement={achievementDialog.mode === 'edit' ? achievementDialog.achievement : undefined}
          onClose={() => setAchievementDialog(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck, run the full frontend suite, and build**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: no type errors; 149 + 5 (Task 2) = 154/154 passing; clean build.

- [ ] **Step 3: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/public-page/page.tsx"
git commit -m "feat(frontend): Achievements tab wiring (create/edit/remove)"
```

---

### Task 6: Live verification (PAUSE before starting)

**Do not start this task until the user explicitly says to continue.**

Start the dev stack (`docker compose ps` first — check for the recurring stopped-stack gotcha before assuming anything else is wrong; `docker compose up -d` if needed) and drive the real flow with Playwright against a committee (PRESIDENT) account and a non-committee (PARTICIPANT) account in the same org.

Checklist:
- [ ] As PRESIDENT: navigate to Public Page → Achievements tab, confirm the "Add achievement" button appears (only on this tab), the Gallery tab's Upload form does not leak into this tab.
- [ ] Add an achievement (title, description, year), confirm it appears in the list correctly sorted (year desc) relative to any existing ones.
- [ ] Edit it (change year and description), confirm the dialog opens pre-filled with current values, confirm the change persists after closing/reopening.
- [ ] Remove it with the confirm dialog, confirm it disappears from the list.
- [ ] Switch to a PARTICIPANT account in the same org (register a fresh one via the API if no live one exists — a prior session's `slice14-part@test.io` may already work, otherwise create a new one exactly as Slice 14's live verification did): confirm no "Add achievement" button, no Edit/Remove buttons, list renders read-only via direct URL navigation to `/[orgSlug]/public-page` (Achievements tab).
- [ ] Confirm a newly added achievement actually appears on the real `/club/[orgSlug]` public page from Slice 13 — this closes the loop and completes end-to-end verification of all three Public Club Page sub-slices together.
- [ ] Both themes screenshotted clean. If the sidebar's theme-toggle button is intercepted by a `<nextjs-portal>` overlay again (a Next.js dev-mode artifact hit during Slice 14's live verification, not an app bug), use keyboard activation (`.focus()` + `Enter`) instead of a pointer click — do not spend more than one retry on the pointer-based approach before switching.

Fix anything found (one root-cause fix at a time, per systematic-debugging), commit each fix separately, then report the final test counts before proceeding to docs sync.

---

## After Task 6 (pause before each, per standing preference)

**Docs sync:** append a "Frontend Slice 15 — Achievements Management" section to `docs/current-context.md` (scope, task list with commit hashes, test baseline, "what's real" summary, and a note that **this completes the entire Public Club Page epic** — all three sub-slices shipped, no placeholder tabs remain anywhere in the app) and a "Slice 15" section to `docs/uiux.md` (the no-resolver-needed-because-the-field-is-simply-never-rendered observation, the modal-dialog CRUD shape mirrored from Assets, and the epic-completion note).

**Finish branch:** verify tests, merge to `main` locally, delete `feature/frontend-slice15-achievements-management`, per standing preference (never push, never ask).
