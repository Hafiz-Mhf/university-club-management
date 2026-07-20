# Frontend Slice 14 (Gallery Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship committee-side gallery management (upload/list/remove) as a new "Public Page" nav area, second of three Public Club Page sub-slices.

**Architecture:** New nav item `/[orgSlug]/public-page`, tabbed (Gallery built now, Achievements placeholder). Data layer wraps the already-shipped `GalleryController`. No new backend endpoints.

**Tech Stack:** Next.js App Router, TanStack Query, `apiUpload`.

## Global Constraints

- Frontend test baseline going in: **145/145**. Backend baseline: **101 unit / 327 e2e** (untouched this slice — `GalleryController`/`GalleryService` already fully shipped in Phase 2, verified by reading `backend/src/gallery/gallery.controller.ts` and `gallery.service.ts`).
- Backend limits to mirror client-side (`backend/src/gallery/gallery.service.ts`): `ALLOWED_MIME = image/png, image/jpeg`; `MAX_FILE_BYTES = 10 * 1024 * 1024` (10MB).
- RBAC: `list` is any authenticated org member (`JwtAuthGuard`+`TenantGuard` only, no `RolesGuard`); `upload`/`remove` are `MANAGE_EVENTS` tier (`isCommittee` in this frontend).
- `GalleryService.list()` returns `{id, caption, downloadUrl, createdAt}` only — **no uploader identity field at all**, so there is no name-resolution/authorization-leak risk to design around in this feature (unlike Files/Assets/Minutes).
- The seven domain hues (`--domain-events/registrations/attendance/certificates/feedback/analytics/ops`) are all already assigned to existing features — per `frontend/components/shell/nav-items.ts`'s own comment ("the hue system covers exactly seven domains and is not extended per-page"), the new "Public Page" nav item gets **no** `iconClass`, same as Members/Settings.
- One commit per task. Pause before Task 1 (after branch creation), pause before Task 7 (live verification), pause before docs-sync. Always merge-to-main on finish, no push.

---

### Task 1: GalleryPhoto type + data hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Create: `frontend/features/gallery/use-gallery.ts`

**Interfaces:**
- Produces: `GalleryPhoto { id: string; caption: string | null; downloadUrl: string; createdAt: string }`; `useGallery(orgId)`, `useUploadPhoto(orgId)`, `useRemovePhoto(orgId)`.

No test file for this task — matches this project's convention that thin `api()`/`apiUpload()`-wrapping hook files aren't unit-tested directly, only exercised via consumers' live verification.

- [ ] **Step 1: Add the `GalleryPhoto` type**

Append to `frontend/types/api.ts` (after the `Member` interface, or anywhere at top level):

```typescript
export interface GalleryPhoto {
  id: string;
  caption: string | null;
  downloadUrl: string;
  createdAt: string;
}
```

- [ ] **Step 2: Implement the data hooks**

```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type { GalleryPhoto } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/gallery`;
}

export function useGallery(orgId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'gallery'],
    queryFn: () => api<GalleryPhoto[]>(base(orgId)),
  });
}

function useInvalidateGallery(orgId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['org', orgId, 'gallery'] });
}

export function useUploadPhoto(orgId: string) {
  const invalidate = useInvalidateGallery(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<GalleryPhoto>(base(orgId), formData),
    onSuccess: invalidate,
  });
}

export function useRemovePhoto(orgId: string) {
  const invalidate = useInvalidateGallery(orgId);
  return useMutation({
    mutationFn: (photoId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${photoId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

Save as `frontend/features/gallery/use-gallery.ts`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/gallery/use-gallery.ts
git commit -m "feat(frontend): gallery data layer (list/upload/remove)"
```

---

### Task 2: Gallery image client-side validation

**Files:**
- Create: `frontend/features/gallery/validate-gallery-image.ts`
- Test: `frontend/features/gallery/__tests__/validate-gallery-image.test.ts`

**Interfaces:**
- Produces: `validateGalleryImage(file: File): string | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, it } from 'vitest';
import { validateGalleryImage } from '@/features/gallery/validate-gallery-image';

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test', { type });
}

it('accepts a valid PNG under the size limit', () => {
  expect(validateGalleryImage(makeFile('image/png', 1024))).toBeNull();
});

it('accepts a valid JPEG', () => {
  expect(validateGalleryImage(makeFile('image/jpeg', 1024))).toBeNull();
});

it('rejects an unsupported MIME type', () => {
  expect(validateGalleryImage(makeFile('image/webp', 1024))).toBe('Only PNG or JPEG images are accepted');
});

it('rejects a file over 10MB', () => {
  expect(validateGalleryImage(makeFile('image/png', 10 * 1024 * 1024 + 1))).toBe('File exceeds the 10MB limit');
});
```

Save as `frontend/features/gallery/__tests__/validate-gallery-image.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run features/gallery/__tests__/validate-gallery-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Mirrors backend/src/gallery/gallery.service.ts's own
// ALLOWED_MIME/MAX_FILE_BYTES as a fast-fail UX check; the backend
// re-validates both regardless.
export function validateGalleryImage(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Only PNG or JPEG images are accepted';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 10MB limit';
  return null;
}
```

Save as `frontend/features/gallery/validate-gallery-image.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run features/gallery/__tests__/validate-gallery-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/gallery/validate-gallery-image.ts frontend/features/gallery/__tests__/validate-gallery-image.test.ts
git commit -m "feat(frontend): gallery image validation helper"
```

---

### Task 3: GalleryUploadForm

**Files:**
- Create: `frontend/components/gallery/gallery-upload-form.tsx`

**Interfaces:**
- Consumes: `useUploadPhoto` (Task 1), `validateGalleryImage` (Task 2).
- Produces: `<GalleryUploadForm orgId={string} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUploadPhoto } from '@/features/gallery/use-gallery';
import { validateGalleryImage } from '@/features/gallery/validate-gallery-image';
import { ApiError } from '@/lib/api';

export function GalleryUploadForm({ orgId }: { orgId: string }) {
  const upload = useUploadPhoto(orgId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    const validationError = validateGalleryImage(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    setFileError(null);
    const formData = new FormData();
    formData.set('file', file);
    if (caption) formData.set('caption', caption);
    upload.mutate(formData, {
      onSuccess: () => {
        setCaption('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        aria-label="Photo file"
        className="text-sm"
        onChange={() => setFileError(null)}
      />
      <Input
        placeholder="Caption (optional)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className="w-48"
        aria-label="Caption"
      />
      <Button type="submit" size="sm" disabled={upload.isPending}>
        {upload.isPending && <Loader2 className="size-4 animate-spin" />}
        Upload
      </Button>
      {fileError && <p className="w-full text-sm text-danger">{fileError}</p>}
      {upload.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {upload.error instanceof ApiError ? upload.error.message : 'Something went wrong'}
        </p>
      )}
    </form>
  );
}
```

Save as `frontend/components/gallery/gallery-upload-form.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/gallery/gallery-upload-form.tsx
git commit -m "feat(frontend): GalleryUploadForm"
```

---

### Task 4: GalleryGrid

**Files:**
- Create: `frontend/components/gallery/gallery-grid.tsx`

**Interfaces:**
- Consumes: `useGallery`, `useRemovePhoto` (Task 1).
- Produces: `<GalleryGrid orgId={string} canManage={boolean} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useGallery, useRemovePhoto } from '@/features/gallery/use-gallery';
import { relativeTime } from '@/features/dashboard/format';

export function GalleryGrid({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const gallery = useGallery(orgId);
  const remove = useRemovePhoto(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  if (gallery.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
      </div>
    );
  }
  if (gallery.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load photos.</p>;
  }
  if (gallery.data.length === 0) {
    return <p className="py-8 text-center text-sm text-foreground-muted">No photos yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {gallery.data.map((photo) => (
          <div key={photo.id} className="flex flex-col gap-1.5">
            <div className="aspect-square overflow-hidden rounded-md bg-surface-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here */}
              <img src={photo.downloadUrl} alt={photo.caption ?? 'Gallery photo'} className="h-full w-full object-cover" />
            </div>
            <p className="text-xs text-foreground-muted">{photo.caption}</p>
            <p className="text-xs text-foreground-subtle">{relativeTime(photo.createdAt)}</p>
            {canManage && (
              <Button variant="destructive" size="sm" onClick={() => setRemoving(photo.id)}>
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove photo?</DialogTitle>
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

Save as `frontend/components/gallery/gallery-grid.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/gallery/gallery-grid.tsx
git commit -m "feat(frontend): GalleryGrid with remove confirm"
```

---

### Task 5: "Public Page" nav item + page wiring

**Files:**
- Modify: `frontend/components/shell/nav-items.ts`
- Create: `frontend/app/(app)/[orgSlug]/public-page/page.tsx`

**Interfaces:**
- Consumes: `GalleryUploadForm` (Task 3), `GalleryGrid` (Task 4); `useOrg` from `frontend/features/orgs/org-provider.tsx`; `isCommittee` from `frontend/features/orgs/roles.ts`.
- Produces: the real `/[orgSlug]/public-page` route, reachable from the sidebar.

- [ ] **Step 1: Add the nav item**

In `frontend/components/shell/nav-items.ts`, add `Globe` to the lucide-react import:

```typescript
import {
  Award,
  CalendarDays,
  ChartNoAxesCombined,
  FolderOpen,
  Globe,
  LayoutDashboard,
  MessageSquareHeart,
  QrCode,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
```

Then add a new entry after `Workspace` and before `Settings`:

```typescript
  { label: 'Public Page', segment: 'public-page', icon: Globe, minTier: 'committee' },
```

No `iconClass` — the seven domain hues are all already assigned (see this plan's Global Constraints), same as Members/Settings staying neutral.

- [ ] **Step 2: Implement the page**

Uses `Button` (from `@/components/ui/button`) for the tab switcher, matching Workspace's exact tab-switcher shape. Save as `frontend/app/(app)/[orgSlug]/public-page/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GalleryUploadForm } from '@/components/gallery/gallery-upload-form';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

type Tab = 'gallery' | 'achievements';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'achievements', label: 'Achievements' },
];

export default function PublicPagePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('gallery');
  const committee = isCommittee(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Public Page</h1>

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
        <p className="py-8 text-center text-sm text-foreground-muted">
          Coming in a later sub-slice.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck, run the full frontend suite, and build**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run && npm run build`
Expected: no type errors; 145 + 4 (Task 2) = 149/149 passing; clean build including the new `/[orgSlug]/public-page` route.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/shell/nav-items.ts "frontend/app/(app)/[orgSlug]/public-page/page.tsx"
git commit -m "feat(frontend): Public Page nav item + Gallery tab wiring"
```

---

### Task 6: Live verification (PAUSE before starting)

**Do not start this task until the user explicitly says to continue.**

Start the dev stack (`docker compose up -d` if not already running, then the backend and frontend dev servers if not already running) and drive the real flow with Playwright against a committee (PRESIDENT) account and a non-committee (PARTICIPANT) account in the same org.

Checklist:
- [ ] As PRESIDENT: navigate to the new "Public Page" sidebar link, confirm it lands on the Gallery tab by default with the upload form visible.
- [ ] Upload a real PNG with a caption, confirm it appears in the grid immediately with the caption shown.
- [ ] Attempt uploading an unsupported file type (e.g. a `.gif` or a plain text file renamed) — confirm the client-side error shows and no network request fires (check the Network tab, matching the zero-network-call precedent from every prior upload feature).
- [ ] Remove a photo with the confirm dialog, confirm it disappears from the grid.
- [ ] Switch to the Achievements tab, confirm the "Coming in a later sub-slice" placeholder renders.
- [ ] Log in as a PARTICIPANT account in the same org: confirm the "Public Page" sidebar link is absent (nav is committee-gated); then navigate directly to `/[orgSlug]/public-page` by URL and confirm the Gallery tab renders read-only (no upload form, no Remove buttons) — matching the Workspace precedent of nav-gated-not-route-gated visibility.
- [ ] Confirm a photo uploaded here actually appears on the real `/club/[orgSlug]` public page from Slice 13 — this closes the loop between the two sub-slices.
- [ ] Both themes screenshotted clean.

Fix anything found (one root-cause fix at a time, per systematic-debugging), commit each fix separately, then report the final test counts before proceeding to docs sync.

---

## After Task 6 (pause before each, per standing preference)

**Docs sync:** append a "Frontend Slice 14 — Gallery Management" section to `docs/current-context.md` (scope, task list with commit hashes, test baseline, "what's real" summary, note Achievements management remains the last Public Club Page sub-slice) and a "Slice 14" section to `docs/uiux.md` (the new "Public Page" nav area as a precedent distinct from Workspace, the no-uploader-identity-so-no-auth-guard-needed observation, the nav-gated-not-route-gated visibility pattern reused from Workspace).

**Finish branch:** verify tests, merge to `main` locally, delete `feature/frontend-slice14-gallery-management`, per standing preference (never push, never ask).
