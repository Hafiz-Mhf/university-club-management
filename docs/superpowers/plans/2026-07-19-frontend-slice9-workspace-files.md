# Frontend Slice 9 (Workspace — File Repository) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first of three Workspace sub-slices — a full frontend
surface for the already-shipped `FilesController` (upload, list + category
filter, signed download, remove) — and turn `/workspace` from a dead
placeholder into a real, tabbed page whose other two tabs (Meeting Minutes,
Asset Management) are honestly marked as not-yet-built.

**Architecture:** New `features/files/` (TanStack Query hooks, name
resolution, client-side file validation) and `components/files/` (upload
dialog, category badge, list table) directories, following Slice 6
(Certificates)'s structure almost exactly — same `apiUpload` multipart
helper, same one-hop uploader-name resolution, same
confirm-dialog-then-mutate remove pattern. `/workspace/page.tsx` gains a
local-state tab row (no new shadcn Tabs component, matching Slice 3's
event-detail tab pattern).

**Tech Stack:** Next.js 18 App Router, TypeScript, TanStack Query, Tailwind
v4, shadcn/ui (Base UI primitives), Vitest + React Testing Library. No new
runtime dependencies.

## Global Constraints

- No new backend endpoints or backend files — verified the full contract
  against `backend/src/files/files.controller.ts` and `files.service.ts`
  during brainstorming (upload/remove: `MANAGE_EVENTS`-gated; list/download:
  any authenticated org member).
- `FileCategory` enum (backend, `@prisma/client`): `SOP | REPORT |
  FINANCIAL | MEETING | OTHER`.
- Frontend test baseline going in: **106/106** (verified via `npm test --
  --run` this session, current as of Slice 8's merge to `main`).
- RBAC: reuse `isCommittee()` from `features/orgs/roles.ts` (Slice 2) — no
  new role tier. This mirrors the backend exactly (`MANAGE_EVENTS` is the
  only guard on this controller; list/download have no `RolesGuard` at
  all).
- Client-side file validation (MIME + size) is UX-only, never the security
  boundary — the backend re-validates both regardless (same disclaimer as
  Slice 6's `validateCertificateFile`).
- Category badges and the Workspace domain hue (`text-domain-ops`) never
  mix: the domain hue stays on the nav icon only, badges use a plain
  `variant="outline"` with no color-coding (category isn't a
  success/failure signal — same reasoning as Slice 4's role badge).

---

### Task 1: Types + data layer

**Files:**
- Modify: `frontend/types/api.ts` — add `FileCategory` type + `OrgFile` interface
- Create: `frontend/features/files/use-files.ts`

**Interfaces:**
- Produces: `FileCategory = 'SOP' | 'REPORT' | 'FINANCIAL' | 'MEETING' | 'OTHER'`,
  `OrgFile { id: string; title: string; category: FileCategory;
  originalFilename: string; mimeType: string; fileSizeBytes: number;
  uploadedByUserId: string; createdAt: string }`,
  `useFiles(orgId: string, category?: FileCategory)`,
  `useUploadFile(orgId: string)`, `useDownloadFile(orgId: string)`,
  `useDeleteFile(orgId: string)`.

No test for this task — it's a pure data layer with no branching logic,
same as `use-certificates.ts`/`use-members.ts` in prior slices (verified
live in Task 8, not unit tested).

- [ ] **Step 1: Add the type and interface to `types/api.ts`**

Add near the other feature interfaces (after `Member`'s block, or any
existing location that groups feature types together):

```typescript
export type FileCategory = 'SOP' | 'REPORT' | 'FINANCIAL' | 'MEETING' | 'OTHER';

export interface OrgFile {
  id: string;
  title: string;
  category: FileCategory;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}
```

- [ ] **Step 2: Create `frontend/features/files/use-files.ts`**

```typescript
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type { FileCategory, OrgFile } from '@/types/api';

function base(orgId: string) {
  return `/organizations/${orgId}/files`;
}

export function useFiles(orgId: string, category?: FileCategory) {
  return useQuery({
    queryKey: ['org', orgId, 'files', category ?? 'ALL'],
    queryFn: () => {
      const qs = category ? `?category=${category}` : '';
      return api<OrgFile[]>(`${base(orgId)}${qs}`);
    },
  });
}

function useInvalidateFiles(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'files'] });
  };
}

export function useUploadFile(orgId: string) {
  const invalidate = useInvalidateFiles(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<OrgFile>(base(orgId), formData),
    onSuccess: invalidate,
  });
}

export function useDownloadFile(orgId: string) {
  return useMutation({
    mutationFn: (fileId: string) =>
      api<{ downloadUrl: string }>(`${base(orgId)}/${fileId}/download`),
  });
}

export function useDeleteFile(orgId: string) {
  const invalidate = useInvalidateFiles(orgId);
  return useMutation({
    mutationFn: (fileId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${fileId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/types/api.ts frontend/features/files/use-files.ts
git commit -m "feat(frontend): file repository data layer"
```

---

### Task 2: Uploader-name resolution

**Files:**
- Create: `frontend/features/files/resolve-uploader-name.ts`
- Test: `frontend/features/files/__tests__/resolve-uploader-name.test.ts`

**Interfaces:**
- Consumes: `Member` (from `@/types/api`, existing).
- Produces: `resolveUploaderName(uploadedByUserId: string, members: Member[]): string`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveUploaderName } from '../resolve-uploader-name';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    userId: 'u1',
    organizationId: 'o1',
    role: 'MEMBER',
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

describe('resolveUploaderName', () => {
  it("returns the matching member's full name", () => {
    const members = [makeMember({ userId: 'u1' })];
    expect(resolveUploaderName('u1', members)).toBe('Ada Lovelace');
  });

  it('falls back to the raw id when no member matches', () => {
    expect(resolveUploaderName('missing-id', [])).toBe('missing-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/files/__tests__/resolve-uploader-name.test.ts`
Expected: FAIL — `resolve-uploader-name` module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { Member } from '@/types/api';

// OrgFile rows carry uploadedByUserId directly (same shape as
// Certificate.userId) — resolve client-side from the already-fetched
// member list. Falls back to the raw id on a miss rather than crashing.
export function resolveUploaderName(uploadedByUserId: string, members: Member[]): string {
  const member = members.find((m) => m.userId === uploadedByUserId);
  return member ? member.user.fullName : uploadedByUserId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/files/__tests__/resolve-uploader-name.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/files/resolve-uploader-name.ts frontend/features/files/__tests__/resolve-uploader-name.test.ts
git commit -m "feat(frontend): uploader-name resolution for the file repository"
```

---

### Task 3: Client-side upload validation

**Files:**
- Create: `frontend/features/files/validate-upload-file.ts`
- Test: `frontend/features/files/__tests__/validate-upload-file.test.ts`

**Interfaces:**
- Produces: `validateUploadFile(file: File): string | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { validateUploadFile } from '../validate-upload-file';

function makeFile(type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], 'test-file', { type });
}

describe('validateUploadFile', () => {
  it('accepts an allowed MIME type under the size limit', () => {
    expect(validateUploadFile(makeFile('application/pdf', 1024))).toBeNull();
  });

  it('rejects an unsupported MIME type', () => {
    expect(validateUploadFile(makeFile('video/mp4', 1024))).toBe('Unsupported file type');
  });

  it('rejects a file over the 20MB limit', () => {
    expect(validateUploadFile(makeFile('application/pdf', 21 * 1024 * 1024)))
      .toBe('File exceeds the 20MB limit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run features/files/__tests__/validate-upload-file.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Mirrors backend/src/files/files.service.ts's own ALLOWED_MIME/MAX_FILE_BYTES
// as a fast-fail UX check; the backend re-validates both regardless.
export function validateUploadFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Unsupported file type';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 20MB limit';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run features/files/__tests__/validate-upload-file.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/files/validate-upload-file.ts frontend/features/files/__tests__/validate-upload-file.test.ts
git commit -m "feat(frontend): client-side upload validation for the file repository"
```

---

### Task 4: FileCategoryBadge

**Files:**
- Create: `frontend/components/files/file-category-badge.tsx`

**Interfaces:**
- Consumes: `FileCategory` (from `@/types/api`, Task 1), `Badge` (existing, `@/components/ui/badge`).
- Produces: `FileCategoryBadge({ category: FileCategory })`.

No test — presentational only, verified live in Task 8 (matches every
prior slice's status-badge components, none of which have direct tests).

- [ ] **Step 1: Write the component**

```tsx
import { Badge } from '@/components/ui/badge';
import type { FileCategory } from '@/types/api';

const LABEL: Record<FileCategory, string> = {
  SOP: 'SOP',
  REPORT: 'Report',
  FINANCIAL: 'Financial',
  MEETING: 'Meeting',
  OTHER: 'Other',
};

export function FileCategoryBadge({ category }: { category: FileCategory }) {
  return <Badge variant="outline">{LABEL[category]}</Badge>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/files/file-category-badge.tsx
git commit -m "feat(frontend): FileCategoryBadge component"
```

---

### Task 5: UploadFileDialog

**Files:**
- Create: `frontend/components/files/upload-file-dialog.tsx`

**Interfaces:**
- Consumes: `useUploadFile` (Task 1), `validateUploadFile` (Task 3),
  `FileCategory` (Task 1), `Dialog`/`DialogContent`/`DialogHeader`/
  `DialogTitle`/`DialogDescription`/`DialogFooter` (existing,
  `@/components/ui/dialog`), `Button` (existing), `ApiError` (existing,
  `@/lib/api`).
- Produces: `UploadFileDialog({ orgId, open, onOpenChange }: { orgId:
  string; open: boolean; onOpenChange: (open: boolean) => void })`.

No test — presentational + wiring only, verified live in Task 8 (matches
Slice 6's `CertificateManager` upload form, also untested directly).

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useRef, useState } from 'react';
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
import { useUploadFile } from '@/features/files/use-files';
import { validateUploadFile } from '@/features/files/validate-upload-file';
import type { FileCategory } from '@/types/api';
import { ApiError } from '@/lib/api';

const CATEGORIES: FileCategory[] = ['SOP', 'REPORT', 'FINANCIAL', 'MEETING', 'OTHER'];

export function UploadFileDialog({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const upload = useUploadFile(orgId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<FileCategory>('OTHER');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle('');
    setCategory('OTHER');
    setFileError(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload file</DialogTitle>
          <DialogDescription>
            PDF, Word, Excel, PowerPoint, PNG, or JPEG — up to 20MB.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const file = fileInputRef.current?.files?.[0];
            if (!title || !file) return;
            const validationError = validateUploadFile(file);
            if (validationError) {
              setFileError(validationError);
              return;
            }
            setFileError(null);
            setUploadError(null);
            const formData = new FormData();
            formData.set('title', title);
            formData.set('category', category);
            formData.set('file', file);
            upload.mutate(formData, {
              onSuccess: () => { reset(); onOpenChange(false); },
              onError: (err) => {
                setUploadError(err instanceof ApiError ? err.message : 'Something went wrong');
              },
            });
          }}
          className="flex flex-col gap-3"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Title"
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FileCategory)}
            aria-label="Category"
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.docx,.xlsx,.pptx,image/png,image/jpeg"
            aria-label="File"
            className="text-sm"
          />
          {fileError && <p role="alert" className="text-sm text-danger">{fileError}</p>}
          {uploadError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {uploadError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={upload.isPending || !title}>
              {upload.isPending && <Loader2 className="size-4 animate-spin" />}
              Upload
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
git add frontend/components/files/upload-file-dialog.tsx
git commit -m "feat(frontend): UploadFileDialog component"
```

---

### Task 6: FileList

**Files:**
- Create: `frontend/components/files/file-list.tsx`

**Interfaces:**
- Consumes: `useFiles`, `useDownloadFile`, `useDeleteFile` (Task 1),
  `resolveUploaderName` (Task 2), `FileCategoryBadge` (Task 4),
  `relativeTime` (existing, `@/features/dashboard/format`), `useMembers`
  (existing, `@/features/members/use-members`), `FileCategory`/`OrgFile`
  (Task 1).
- Produces: `FileList({ orgId, canManage }: { orgId: string; canManage: boolean })`.

No test — presentational + wiring, verified live in Task 8 (matches
`CertificateManager`, `RegistrationsTable`, every other list/table
component in this app).

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
import { FileCategoryBadge } from '@/components/files/file-category-badge';
import { useDeleteFile, useDownloadFile, useFiles } from '@/features/files/use-files';
import { resolveUploaderName } from '@/features/files/resolve-uploader-name';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import type { FileCategory } from '@/types/api';

const CATEGORIES: FileCategory[] = ['SOP', 'REPORT', 'FINANCIAL', 'MEETING', 'OTHER'];

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function FileList({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [category, setCategory] = useState<FileCategory | undefined>(undefined);
  const files = useFiles(orgId, category);
  const members = useMembers(orgId, {});
  const download = useDownloadFile(orgId);
  const remove = useDeleteFile(orgId);
  const [removing, setRemoving] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <select
        value={category ?? ''}
        onChange={(e) => setCategory(e.target.value ? (e.target.value as FileCategory) : undefined)}
        aria-label="Filter by category"
        className="h-9 w-fit rounded-md border border-input bg-surface px-2.5 text-sm"
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {files.isPending ? null : files.isError ? (
        <p className="text-sm text-foreground-muted">Couldn&apos;t load files.</p>
      ) : files.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">No files yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {files.data.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <div className="flex items-center gap-2">
                <span>{f.title}</span>
                <FileCategoryBadge category={f.category} />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground-subtle">
                  {resolveUploaderName(f.uploadedByUserId, members.data ?? [])} ·{' '}
                  {formatFileSize(f.fileSizeBytes)} · {relativeTime(f.createdAt)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={download.isPending}
                  onClick={() => {
                    download.mutate(f.id, {
                      onSuccess: ({ downloadUrl }) => window.open(downloadUrl, '_blank', 'noreferrer'),
                    });
                  }}
                >
                  Download
                </Button>
                {canManage && (
                  <Button variant="destructive" size="sm" onClick={() => setRemoving(f.id)}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove file?</DialogTitle>
            <DialogDescription>
              This can&apos;t be undone. You can re-upload it later.
            </DialogDescription>
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
git add frontend/components/files/file-list.tsx
git commit -m "feat(frontend): FileList component"
```

---

### Task 7: Workspace page wiring

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/workspace/page.tsx`

**Interfaces:**
- Consumes: `useOrg` (existing, `@/features/orgs/org-provider`),
  `isCommittee` (existing, `@/features/orgs/roles`), `FileList` (Task 6),
  `UploadFileDialog` (Task 5).

- [ ] **Step 1: Replace the placeholder with the tabbed page**

```tsx
'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FileList } from '@/components/files/file-list';
import { UploadFileDialog } from '@/components/files/upload-file-dialog';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

type Tab = 'files' | 'minutes' | 'assets';
const TABS: { id: Tab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'minutes', label: 'Minutes' },
  { id: 'assets', label: 'Assets' },
];

export default function WorkspacePage() {
  const { org, membership } = useOrg();
  const [tab, setTab] = useState<Tab>('files');
  const [uploadOpen, setUploadOpen] = useState(false);
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
        <p className="py-8 text-center text-sm text-foreground-muted">
          Coming in a later sub-slice.
        </p>
      )}

      <UploadFileDialog orgId={org.id} open={uploadOpen} onOpenChange={setUploadOpen} />
    </main>
  );
}
```

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run`
Expected: 111 passed (106 baseline + 5 from Tasks 2–3).

- [ ] **Step 3: Run build**

Run: `cd frontend && npm run build`
Expected: clean build, `/[orgSlug]/workspace` listed as a dynamic route.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/[orgSlug]/workspace/page.tsx"
git commit -m "feat(frontend): Workspace page wiring — Files tab, Minutes/Assets placeholders"
```

---

### Task 8: Live verification

**No files changed in this task unless a bug is found.**

- [ ] **Step 1: Start the stack**

Ensure `docker compose` (postgres/minio/redis/mailpit) is up, backend dev
server and frontend dev server both running.

- [ ] **Step 2: Drive the full flow via Playwright, as a committee account**

- Navigate to `/workspace` — confirm Files tab is active by default,
  Minutes/Assets tabs show the "coming in a later sub-slice" message.
- Upload one file of each allowed type (start with a small PDF) via
  "Upload file" — title + category + file — confirm it appears in the
  list with the correct category badge, uploader name (your own), size,
  and relative time.
- Try uploading an unsupported file type (e.g. a `.mp4` or oversized file)
  — confirm the inline validation error shows and no network request
  fires.
- Use the category filter — confirm the list narrows correctly, and "All
  categories" shows everything again.
- Click Download on a file — confirm a real signed URL opens in a new tab
  and the file downloads/opens correctly.
- Click Remove on a file, confirm via the dialog — confirm it disappears
  from the list.

- [ ] **Step 3: Switch to a non-committee account**

- Navigate to `/workspace` — confirm the Files tab shows the file list and
  Download button, but no "Upload file" button and no Remove button on any
  row.

- [ ] **Step 4: Both themes**

Screenshot `/workspace` in light and dark mode — confirm the category
badges render as plain outline badges (no domain-hue leakage), the
Workspace nav icon keeps its hue, and nothing else on the page picks up a
domain color it shouldn't.

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

After Task 8 passes with zero or fixed bugs: pause before docs-sync
(standing preference) — wait for "continue," then append a "Slice 9"
section to `docs/uiux.md` and update `docs/current-context.md` (mark this
sub-slice shipped, note Meeting Minutes and Asset Management remain as the
next two Workspace sub-slices). Then finish branch: verify tests, merge
`feature/frontend-slice9-workspace-files` to `main` locally, delete the
branch — no push, no asking (standing default).
