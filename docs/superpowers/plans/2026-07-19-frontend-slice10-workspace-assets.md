# Frontend Slice 10 (Workspace — Asset Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the second of three Workspace sub-slices — a full frontend
surface for the already-shipped `AssetsController` (create, list, edit,
remove) — filling in the Assets tab of `/workspace` (currently the Slice
9 placeholder).

**Architecture:** New `features/assets/` (TanStack Query hooks, Zod
schema) and `components/assets/` (condition badge, one reusable add/edit
dialog, list) directories. Plain JSON `api()` calls throughout — no file
storage, no `apiUpload`. `AssetDialog` is conditionally mounted (only
rendered while in use, unmounted otherwise) rather than kept alive with
manual reset logic — this sidesteps Slice 9's "Cancel button skipped
reset" bug class entirely, since a freshly-mounted component always starts
from its own `defaultValues`.

**Tech Stack:** Next.js 18 App Router, TypeScript, TanStack Query, React
Hook Form + Zod, Tailwind v4, shadcn/ui (Base UI primitives), Vitest +
React Testing Library. No new runtime dependencies.

## Global Constraints

- No new backend endpoints or backend files — verified the full contract
  against `backend/src/assets/assets.controller.ts` and `assets.service.ts`
  during brainstorming (create/update/remove: `MANAGE_EVENTS`-gated;
  list/findOne: any authenticated org member; list is unpaginated, sorted
  `name asc`).
- `AssetCondition` enum (backend, `@prisma/client`): `GOOD | DAMAGED |
  LOST` (Prisma default `GOOD`).
- Frontend test baseline going in: **111/111** (verified via `npm test --
  --run` this session, current as of Slice 9's merge to `main`).
- RBAC: reuse `isCommittee()` from `features/orgs/roles.ts` (Slice 2) — no
  new role tier, mirrors the backend's `MANAGE_EVENTS` exactly (same as
  Slice 9's Files).
- **Repeat of a Slice 9 bug class, fixed at design time this time:** `GET
  /organizations/:orgId/members` is `VIEW_MEMBERS`-gated (committee-only),
  but this asset list is visible to any org member. Any "added by"
  name-resolution row MUST render `members.isError ? 'Committee member' :
  resolveMemberName(...)` — never fall through to a raw-id fallback on an
  authorization failure. Do not skip this in Task 5.
- `AssetConditionBadge` uses semantic status tokens (`GOOD→success`,
  `DAMAGED→warning`, `LOST→danger`) — condition is a real status signal,
  unlike Slice 9's `FileCategoryBadge` (plain outline, since file category
  is identity, not status).

---

### Task 1: Types + data layer

**Files:**
- Modify: `frontend/types/api.ts` — add `AssetCondition` type + `Asset` interface
- Create: `frontend/features/assets/use-assets.ts`

**Interfaces:**
- Produces: `AssetCondition = 'GOOD' | 'DAMAGED' | 'LOST'`,
  `Asset { id: string; name: string; quantity: number; condition:
  AssetCondition; location: string | null; notes: string | null;
  createdByUserId: string; createdAt: string; updatedAt: string }`,
  `AssetInput { name: string; quantity: number; condition?: AssetCondition;
  location?: string; notes?: string }`, `useAssets(orgId: string)`,
  `useCreateAsset(orgId: string)`, `useUpdateAsset(orgId: string)` (takes
  `{ assetId, input }` at mutate time), `useDeleteAsset(orgId: string)`
  (takes `assetId` at mutate time).

No test for this task — pure data layer, no branching logic, same as
`use-files.ts`/`use-certificates.ts` in prior slices (verified live in
Task 7, not unit tested).

- [ ] **Step 1: Add the type and interface to `types/api.ts`**

Add near the other feature interfaces:

```typescript
export type AssetCondition = 'GOOD' | 'DAMAGED' | 'LOST';

export interface Asset {
  id: string;
  name: string;
  quantity: number;
  condition: AssetCondition;
  location: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create `frontend/features/assets/use-assets.ts`**

```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Asset, AssetCondition } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/assets`;
}

export function useAssets(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'assets'],
    queryFn: () => api<Asset[]>(base(orgId)),
  });
}

function useInvalidateAssets(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'assets'] });
  };
}

export interface AssetInput {
  name: string;
  quantity: number;
  condition?: AssetCondition;
  location?: string;
  notes?: string;
}

export function useCreateAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: (input: AssetInput) => api<Asset>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: ({ assetId, input }: { assetId: string; input: AssetInput }) =>
      api<Asset>(`${base(orgId)}/${assetId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteAsset(orgId: string) {
  const invalidate = useInvalidateAssets(orgId);
  return useMutation({
    mutationFn: (assetId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${assetId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors (5 pre-existing `lib/__tests__/api.test.ts` errors
are unrelated, confirmed on a clean tree during Slice 9 — ignore them).

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/assets/use-assets.ts
git commit -m "feat(frontend): asset management data layer"
```

---

### Task 2: Asset form schema

**Files:**
- Create: `frontend/features/assets/schema.ts`
- Test: `frontend/features/assets/__tests__/schema.test.ts`

**Interfaces:**
- Produces: `assetFormSchema` (Zod), `AssetFormValues = z.infer<typeof assetFormSchema>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { expect, it } from 'vitest';
import { assetFormSchema } from '@/features/assets/schema';

const base = { name: 'Projector', quantity: '2', condition: 'GOOD', location: '', notes: '' };

it('accepts a valid submission', () => {
  expect(assetFormSchema.safeParse(base).success).toBe(true);
});

it('rejects an empty name', () => {
  expect(assetFormSchema.safeParse({ ...base, name: '' }).success).toBe(false);
});

it('rejects a non-integer quantity', () => {
  expect(assetFormSchema.safeParse({ ...base, quantity: '1.5' }).success).toBe(false);
});

it('rejects a zero or negative quantity', () => {
  expect(assetFormSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false);
  expect(assetFormSchema.safeParse({ ...base, quantity: '-1' }).success).toBe(false);
});

it('rejects a condition value outside the enum', () => {
  expect(assetFormSchema.safeParse({ ...base, condition: 'BROKEN' }).success).toBe(false);
});

it('accepts missing location and notes', () => {
  expect(assetFormSchema.safeParse({ name: 'Speaker', quantity: '1', condition: 'GOOD' }).success)
    .toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/assets/__tests__/schema.test.ts`
Expected: FAIL — `@/features/assets/schema` module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { z } from 'zod';

// Mirrors backend CreateAssetDto/UpdateAssetDto. The backend re-validates
// everything; these checks exist so obvious errors never leave the client.
export const assetFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  quantity: z.string().refine(
    (v) => Number.isInteger(Number(v)) && Number(v) >= 1,
    'Quantity must be a positive whole number',
  ),
  condition: z.enum(['GOOD', 'DAMAGED', 'LOST']),
  location: z.string().optional(),
  notes: z.string().optional(),
});

export type AssetFormValues = z.infer<typeof assetFormSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/assets/__tests__/schema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/assets/schema.ts frontend/features/assets/__tests__/schema.test.ts
git commit -m "feat(frontend): asset form validation schema"
```

---

### Task 3: AssetConditionBadge

**Files:**
- Create: `frontend/components/assets/asset-condition-badge.tsx`

**Interfaces:**
- Consumes: `AssetCondition` (Task 1), `Badge`/`cn` (existing).
- Produces: `AssetConditionBadge({ condition: AssetCondition })`.

No test — presentational only, verified live in Task 7 (matches every
other status-badge component in this app, none of which have direct
tests).

- [ ] **Step 1: Write the component**

```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AssetCondition } from '@/types/api';

// Semantic tokens — condition is a real status signal (good/degraded/
// gone), unlike FileCategoryBadge's plain outline (category is identity,
// not status).
const STATUS_STYLES: Record<AssetCondition, { label: string; className: string }> = {
  GOOD: { label: 'Good', className: 'border-success/40 bg-success/10 text-success' },
  DAMAGED: { label: 'Damaged', className: 'border-warning/40 bg-warning/10 text-warning' },
  LOST: { label: 'Lost', className: 'border-danger/40 bg-danger/10 text-danger' },
};

export function AssetConditionBadge({ condition }: { condition: AssetCondition }) {
  const { label, className } = STATUS_STYLES[condition];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/assets/asset-condition-badge.tsx
git commit -m "feat(frontend): AssetConditionBadge component"
```

---

### Task 4: AssetDialog

**Files:**
- Create: `frontend/components/assets/asset-dialog.tsx`

**Interfaces:**
- Consumes: `useCreateAsset`, `useUpdateAsset` (Task 1), `assetFormSchema`,
  `AssetFormValues` (Task 2), `Asset` (Task 1), `Dialog`/`DialogContent`/
  `DialogHeader`/`DialogTitle`/`DialogFooter` (existing,
  `@/components/ui/dialog`), `Input`/`Label`/`Textarea`/`Button`
  (existing), `ApiError` (existing, `@/lib/api`).
- Produces: `AssetDialog({ orgId, asset, onClose }: { orgId: string; asset?: Asset; onClose: () => void })`.
  Callers are responsible for only rendering this component while a dialog
  should be open (conditional mount, no internal `open` prop) — this is
  what makes a fresh `defaultValues` guaranteed on every open, with no
  manual reset needed.

No test — wiring + presentational, verified live in Task 7 (matches every
other add/edit dialog in this app).

- [ ] **Step 1: Write the component**

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
import { useCreateAsset, useUpdateAsset } from '@/features/assets/use-assets';
import { assetFormSchema, type AssetFormValues } from '@/features/assets/schema';
import { ApiError } from '@/lib/api';
import type { Asset, AssetCondition } from '@/types/api';

const CONDITIONS: AssetCondition[] = ['GOOD', 'DAMAGED', 'LOST'];

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

export function AssetDialog({
  orgId,
  asset,
  onClose,
}: {
  orgId: string;
  asset?: Asset;
  onClose: () => void;
}) {
  const isEdit = Boolean(asset);
  const create = useCreateAsset(orgId);
  const update = useUpdateAsset(orgId);
  const isPending = create.isPending || update.isPending;

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: asset
      ? {
          name: asset.name,
          quantity: String(asset.quantity),
          condition: asset.condition,
          location: asset.location ?? '',
          notes: asset.notes ?? '',
        }
      : { name: '', quantity: '1', condition: 'GOOD', location: '', notes: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      name: values.name,
      quantity: Number(values.quantity),
      condition: values.condition,
      location: values.location || undefined,
      notes: values.notes || undefined,
    };
    if (asset) {
      update.mutate({ assetId: asset.id, input }, { onSuccess: onClose });
    } else {
      create.mutate(input, { onSuccess: onClose });
    }
  });

  const mutationError = create.error ?? update.error;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit asset' : 'Add asset'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name" htmlFor="asset-name" error={errors.name?.message}>
            <Input id="asset-name" {...form.register('name')} />
          </Field>
          <Field label="Quantity" htmlFor="asset-quantity" error={errors.quantity?.message}>
            <Input id="asset-quantity" inputMode="numeric" {...form.register('quantity')} />
          </Field>
          <Field label="Condition" htmlFor="asset-condition">
            <select
              id="asset-condition"
              {...form.register('condition')}
              className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location (optional)" htmlFor="asset-location">
            <Input id="asset-location" {...form.register('location')} />
          </Field>
          <Field label="Notes (optional)" htmlFor="asset-notes">
            <Textarea id="asset-notes" {...form.register('notes')} />
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

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/assets/asset-dialog.tsx
git commit -m "feat(frontend): AssetDialog component (add + edit)"
```

---

### Task 5: AssetList

**Files:**
- Create: `frontend/components/assets/asset-list.tsx`

**Interfaces:**
- Consumes: `useAssets`, `useDeleteAsset` (Task 1), `AssetConditionBadge`
  (Task 3), `resolveMemberName` (existing,
  `@/features/certificates/resolve-member-name` — reused as-is, same
  one-hop `userId → members` lookup shape `Asset.createdByUserId` needs),
  `useMembers` (existing, `@/features/members/use-members`), `relativeTime`
  (existing, `@/features/dashboard/format`).
- Produces: `AssetList({ orgId, canManage, onEdit }: { orgId: string;
  canManage: boolean; onEdit: (asset: Asset) => void })`.

No test — presentational + wiring, verified live in Task 7 (matches
`FileList`/`CertificateManager`/every other list component in this app).

- [ ] **Step 1: Write the component**

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
import { AssetConditionBadge } from '@/components/assets/asset-condition-badge';
import { useAssets, useDeleteAsset } from '@/features/assets/use-assets';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import type { Asset } from '@/types/api';

export function AssetList({
  orgId,
  canManage,
  onEdit,
}: {
  orgId: string;
  canManage: boolean;
  onEdit: (asset: Asset) => void;
}) {
  const assets = useAssets(orgId);
  const members = useMembers(orgId, {});
  const remove = useDeleteAsset(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (assets.isPending) return null;
  if (assets.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load assets.</p>;
  }
  if (assets.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No assets yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {assets.data.map((a) => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <span>{a.name}</span>
            <span className="text-xs text-foreground-subtle">×{a.quantity}</span>
            <AssetConditionBadge condition={a.condition} />
            {a.location && <span className="text-xs text-foreground-subtle">{a.location}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-foreground-subtle">
              {/* GET /members is VIEW_MEMBERS-gated (committee-only) but
                  this list is visible to any org member — a 403 here is
                  an expected authorization boundary, not a missing row,
                  so it must not fall through to resolveMemberName's
                  raw-id fallback (that would leak an internal UUID —
                  the exact bug fixed in Slice 9's FileList). */}
              {members.isError
                ? 'Committee member'
                : resolveMemberName(a.createdByUserId, members.data ?? [])}{' '}
              · {relativeTime(a.createdAt)}
            </span>
            {canManage && (
              <>
                <Button variant="secondary" size="sm" onClick={() => onEdit(a)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRemoving(a.id)}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      ))}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove asset?</DialogTitle>
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

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/assets/asset-list.tsx
git commit -m "feat(frontend): AssetList component"
```

---

### Task 6: Workspace page wiring

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/workspace/page.tsx`

**Interfaces:**
- Consumes: `AssetList` (Task 5), `AssetDialog` (Task 4), `Asset` (Task 1).

- [ ] **Step 1: Replace the Assets tab placeholder with real content**

Modify the existing file — add the asset-dialog state, the "Add asset"
button (shown only on the Assets tab, mirroring the existing "Upload file"
button's `tab === 'files'` condition), and swap the Assets placeholder
paragraph for `AssetList` + the conditionally-mounted `AssetDialog`:

```tsx
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/files/file-list';
import { UploadFileDialog } from '@/components/files/upload-file-dialog';
import { AssetList } from '@/components/assets/asset-list';
import { AssetDialog } from '@/components/assets/asset-dialog';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';
import type { Asset } from '@/types/api';

type Tab = 'files' | 'minutes' | 'assets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'assets', label: 'Assets' },
];

type AssetDialogState = { mode: 'create' } | { mode: 'edit'; asset: Asset } | null;

export default function WorkspacePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('files');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [assetDialog, setAssetDialog] = useState<AssetDialogState>(null);
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Workspace</h1>
        {tab === 'files' && committee && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="size-3.5" />
            Upload file
          </Button>
        )}
        {tab === 'assets' && committee && (
          <Button size="sm" onClick={() => setAssetDialog({ mode: 'create' })}>
            <Plus className="size-3.5" />
            Add asset
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

      {tab === 'files' && <FileList orgId={org.id} canManage={committee} />}
      {tab === 'minutes' && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          Coming in a later sub-slice.
        </p>
      )}
      {tab === 'assets' && (
        <AssetList
          orgId={org.id}
          canManage={committee}
          onEdit={(asset) => setAssetDialog({ mode: 'edit', asset })}
        />
      )}

      <UploadFileDialog orgId={org.id} open={uploadOpen} onOpenChange={setUploadOpen} />
      {assetDialog && (
        <AssetDialog
          orgId={org.id}
          asset={assetDialog.mode === 'edit' ? assetDialog.asset : undefined}
          onClose={() => setAssetDialog(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: 117 passed (111 baseline + 6 from Task 2).

- [ ] **Step 3: Run build**

Run: `cd frontend && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/page.tsx"
git commit -m "feat(frontend): Workspace page wiring — Assets tab"
```

---

### Task 7: Live verification

**No files changed in this task unless a bug is found.**

- [ ] **Step 1: Start the stack**

Ensure `docker compose` (postgres/minio/redis/mailpit) is up, backend dev
server and frontend dev server both running.

- [ ] **Step 2: Drive the full flow via Playwright, as a committee account**

- Navigate to `/workspace`, click the Assets tab — confirm "Add asset"
  button appears (only on this tab), Files/Minutes tabs unaffected.
- Add an asset with condition `GOOD` — confirm it appears with a
  green/success-styled badge, correct quantity, "added by" showing your
  own name.
- Add two more assets with `DAMAGED` and `LOST` — confirm
  warning/danger-styled badges respectively.
- Edit an asset — change its quantity and condition — confirm the row
  updates and the badge color changes to match the new condition.
- Click Remove on an asset, confirm via the dialog — confirm it
  disappears.
- Click "Add asset", start typing, then click Cancel — reopen "Add
  asset" — confirm the form is blank (verifying the conditional-mount
  design actually avoids Slice 9's stale-state bug class, not just in
  theory).

- [ ] **Step 3: Switch to a non-committee account**

- Navigate to `/workspace`'s Assets tab — confirm the list renders
  (name/quantity/condition/location) with no "Add asset" button and no
  Edit/Remove buttons on any row.
- Confirm "added by" shows "Committee member" for this account, not a raw
  user id — this is the specific regression risk flagged in the spec.

- [ ] **Step 4: Both themes**

Screenshot the Assets tab in light and dark mode — confirm the condition
badges use success/warning/danger colors correctly, no domain-hue leakage.

- [ ] **Step 5: If any bug is found**

Root-cause it (via `superpowers:systematic-debugging` if non-trivial), fix,
add a regression test if the bug was in testable logic (not a
presentational/live-only file), commit as its own commit
(`fix(frontend): <description>`), re-run the full test suite and build
before continuing.

- [ ] **Step 6: If zero bugs found**

No commit for this task (matches the precedent set by Slices 1, 2, 4, 5,
and 7's live-verification tasks).

---

## Post-implementation

After Task 7 passes with zero or fixed bugs: pause before docs-sync
(standing preference) — wait for "continue," then append a "Slice 10"
section to `docs/uiux.md` and update `docs/current-context.md` (mark this
sub-slice shipped, note Meeting Minutes remains the last Workspace
sub-slice). Then finish branch: verify tests, merge
`feature/frontend-slice10-workspace-assets` to `main` locally, delete the
branch — no push, no asking (standing default).
