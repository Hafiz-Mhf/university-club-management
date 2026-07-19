# Frontend Slice 6 — Certificates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build the Certificates feature against the live
`CertificatesController`: a participant's own certificate download (shown
from the event they attended), and committee per-event certificate
management (list, manual upload as an admin fallback, remove). Generation
itself is already fully automatic on the backend — this slice only builds
the viewing/managing surface.

**Spec:** `docs/superpowers/specs/2026-07-19-frontend-slice6-certificates-design.md`
— authority on behavior; this plan sequences the work.

**Tech stack:** unchanged from Slices 1–5 (Next.js App Router, Tailwind v4,
shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Vitest + RTL). No
new npm dependency this slice — file upload uses the native `FormData`/
`<input type="file">` browser APIs.

## Global constraints

- Baseline before starting: frontend 68/68 Vitest, clean `npm run build`;
  backend 101 unit / 326 e2e (unchanged since Slice 5 merge, `af0a34b`).
  Backend is **not touched** this slice — no new endpoints needed, full
  contract verified against the existing `CertificatesController`/
  `CertificatesService`/`CertificateGenerationService` source during
  brainstorming.
- Branch: `feature/frontend-slice6-certificates`, cut from `main` at the
  start of Task 1.
- One commit per task. `npm test` + `npm run build` clean before each
  commit.
- No new role tier — reuses `isCommittee` from Slice 2
  (`features/orgs/roles.ts`), unlike Slice 5's VOLUNTEER-inclusive
  `MANAGE_ATTENDANCE_ROLES`. `CertificatesController` gates every
  committee-only route with the backend's `MANAGE_EVENTS` group, which
  `isCommittee` already mirrors exactly.
- Signed URLs only — never render or log a raw `storageKey` anywhere in the
  UI.
- PDF/5MB validated both client-side (fast-fail UX, via
  `validateCertificateFile`, Task 4) and server-side (the real boundary —
  client validation never replaces it).
- No domain-hue collision — Certificates' domain hue stays on the nav icon
  only (already wired, unchanged this slice). There is no multi-state
  status badge in this feature (a certificate either exists or doesn't),
  so semantic status tokens don't apply here the way they did in Slices
  2/3/5.
- Icons: Lucide only.

---

### Task 1: Data layer — types, `apiUpload`, query hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/__tests__/api.test.ts`
- Create: `frontend/features/certificates/use-certificates.ts`

**Interfaces:**
- Produces: `Certificate` type, `MyCertificate` type, `apiUpload<T>(path:
  string, formData: FormData): Promise<T>`, `useMyCertificate(orgId,
  eventId)`, `useCertificateList(orgId, eventId)`,
  `useUploadCertificate(orgId, eventId)`, `useRemoveCertificate(orgId,
  eventId)` — all consumed by later tasks.

**Steps:**

- [ ] **Step 1: Add the certificate types.** In `types/api.ts`, append
  (field set per `prisma/schema.prisma:225-239`, cross-checked against
  `certificates.service.ts` during brainstorming):

```ts
export interface Certificate {
  id: string;
  eventId: string;
  organizationId: string;
  userId: string;
  storageKey: string;
  fileSizeBytes: number;
  uploadedByUserId: string;
  createdAt: string;
}

// GET .../certificates/me and GET .../certificates/:id/download only — a
// freshly-signed, 5-minute download URL, never persisted client-side.
export interface MyCertificate extends Certificate {
  downloadUrl: string;
}
```

- [ ] **Step 2: Write the failing tests for `apiUpload`.** Append to
  `lib/__tests__/api.test.ts` (add `apiUpload` to the import line at the
  top):

```ts
import { api, apiUpload, ApiError, setOnAuthFailure, setOnConsentStale } from '@/lib/api';
```

```ts
describe('apiUpload', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().clearSession();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    setOnAuthFailure(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the FormData body as-is with no manually-set Content-Type header', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'cert-1' }));
    const formData = new FormData();
    formData.set('userId', 'u1');

    await apiUpload('/organizations/o1/events/e1/certificates', formData);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3001/organizations/o1/events/e1/certificates');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(formData);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('on 401: refreshes once, retries the original upload once', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'stale',
      refreshToken: 'ref-1',
      consentStale: false,
    });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        jsonResponse(201, { accessToken: 'fresh', refreshToken: 'ref-2', consentStale: false }),
      )
      .mockResolvedValueOnce(jsonResponse(201, { id: 'cert-1' }));

    const result = await apiUpload<{ id: string }>('/path', new FormData());

    expect(result).toEqual({ id: 'cert-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryCall = fetchMock.mock.calls[2];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('non-401 errors surface as ApiError', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'tok',
      refreshToken: 'ref',
      consentStale: false,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { message: 'A certificate already exists for this person and event' }));

    const err = await apiUpload('/path', new FormData()).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('A certificate already exists for this person and event');
  });
});
```

- [ ] **Step 3: Run tests — verify red.** `npm test` — fails, `apiUpload`
  doesn't exist yet.

- [ ] **Step 4: Implement `apiUpload`.** In `lib/api.ts`, append (after the
  existing `api` function, at the end of the file):

```ts
async function uploadRequest(path: string, formData: FormData, retrying: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  const accessToken = useAuthStore.getState().accessToken;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  // No Content-Type set here — the browser derives the multipart boundary
  // from the FormData body itself. Setting it manually would omit the
  // boundary and break parsing server-side.
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (res.status === 401 && !retrying) {
    if (useAuthStore.getState().getRefreshToken()) {
      const refreshed = await refreshSession();
      if (refreshed) return uploadRequest(path, formData, true);
      useAuthStore.getState().clearSession();
      onAuthFailure?.();
    }
  }

  return res;
}

export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const res = await uploadRequest(path, formData, false);
  const body = await parseBody(res);

  if (!res.ok) {
    const message = messageOf(body, res.statusText);
    if (res.status === 403 && message === CONSENT_STALE_MESSAGE) {
      useAuthStore.getState().setConsentStale(true);
      onConsentStale?.();
    }
    throw new ApiError(res.status, message);
  }

  return body as T;
}
```

- [ ] **Step 5: Run tests — verify green.** `npm test`.

- [ ] **Step 6: Implement `use-certificates.ts`** (no test file — thin
  TanStack Query wiring, same pattern as
  `features/attendance/use-attendance.ts`):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiUpload } from '@/lib/api';
import type { Certificate, MyCertificate } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/certificates`;
}

export function useMyCertificate(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'certificate', 'me'],
    queryFn: () => api<MyCertificate>(`${base(orgId, eventId)}/me`),
    retry: false, // a 404 here is a meaningful answer (no certificate yet), not a flake
  });
}

export function useCertificateList(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'certificates'],
    queryFn: () => api<Certificate[]>(base(orgId, eventId)),
  });
}

function useInvalidateCertificates(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'certificates'] });
  };
}

export function useUploadCertificate(orgId: string, eventId: string) {
  const invalidate = useInvalidateCertificates(orgId, eventId);
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiUpload<Certificate>(base(orgId, eventId), formData),
    onSuccess: invalidate,
  });
}

export function useRemoveCertificate(orgId: string, eventId: string) {
  const invalidate = useInvalidateCertificates(orgId, eventId);
  return useMutation({
    mutationFn: (certificateId: string) =>
      api<{ removed: true }>(`${base(orgId, eventId)}/${certificateId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 7: Verify + commit.** `npm test` + `npm run build`.

```bash
git checkout -b feature/frontend-slice6-certificates
git add frontend/types/api.ts frontend/lib/api.ts frontend/lib/__tests__/api.test.ts frontend/features/certificates/use-certificates.ts
git commit -m "feat(frontend): certificates data layer — types, apiUpload, query hooks"
```

---

### Task 2: `resolveMemberName` — one-hop name resolution

**Files:**
- Create: `frontend/features/certificates/resolve-member-name.ts`
- Create: `frontend/features/certificates/__tests__/resolve-member-name.test.ts`

**Interfaces:**
- Consumes: `Member` type (existing, Slice 4).
- Produces: `resolveMemberName(userId: string, members: Member[]): string`
  — consumed by Task 4 (`CertificateManager`'s list, where each row's
  `Certificate.userId` maps directly to a member with no registration
  indirection needed).

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create
  `features/certificates/__tests__/resolve-member-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import type { Member } from '@/types/api';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1', userId: 'u1', organizationId: 'o1', role: 'PARTICIPANT', status: 'ACTIVE',
    studentId: null, faculty: null, programme: null, intake: null, phone: null,
    committeeHistory: null, joinedAt: '2026-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveMemberName', () => {
  it('resolves the full name when a matching member is found', () => {
    expect(resolveMemberName('u1', [makeMember()])).toBe('Ada Lovelace');
  });

  it('falls back to the raw userId when no matching member exists', () => {
    expect(resolveMemberName('missing-user', [makeMember()])).toBe('missing-user');
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test` — fails, module
  doesn't exist yet.

- [ ] **Step 3: Implement `resolve-member-name.ts`:**

```ts
import type { Member } from '@/types/api';

// GET /certificates returns raw rows with only userId, no name join —
// resolve it client-side from the already-fetched member list. A missing
// member (not possible under normal lifecycle, but not ruled out under a
// race with removal) falls back to the raw id rather than crashing.
export function resolveMemberName(userId: string, members: Member[]): string {
  const member = members.find((m) => m.userId === userId);
  return member ? member.user.fullName : userId;
}
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Verify + commit.** `npm run build`.

```bash
git add frontend/features/certificates/resolve-member-name.ts frontend/features/certificates/__tests__/resolve-member-name.test.ts
git commit -m "feat(frontend): certificate holder name resolution from members"
```

---

### Task 3: `MyCertificatePanel` — participant view

**Files:**
- Create: `frontend/components/certificates/my-certificate-panel.tsx`
- Modify: `frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `useMyCertificate` (Task 1).
- Produces: `MyCertificatePanel({ orgId, eventId })` — rendered on the
  event detail page.

**Steps:**

- [ ] **Step 1: Implement `MyCertificatePanel`.** Renders nothing while
  loading or on a 404 (no certificate is the default state before an
  event completes); shows a download link once found.

```tsx
'use client';

import { Download } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { useMyCertificate } from '@/features/certificates/use-certificates';

export function MyCertificatePanel({ orgId, eventId }: { orgId: string; eventId: string }) {
  const certificate = useMyCertificate(orgId, eventId);

  if (!certificate.data) return null;

  return (
    <a
      href={certificate.data.downloadUrl}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
    >
      <Download className="size-3.5" />
      Download certificate
    </a>
  );
}
```

- [ ] **Step 2: Wire into the event detail page.** In
  `app/(app)/[orgSlug]/events/[eventId]/page.tsx`, add the import:

```ts
import { MyCertificatePanel } from '@/components/certificates/my-certificate-panel';
```

Add right after the existing `<MyRegistrationPanel orgId={org.id} event={e} />`
line (inside the `(tab === 'overview' || !committee)` block, before
`LifecycleActions`):

```tsx
<MyRegistrationPanel orgId={org.id} event={e} />

<MyCertificatePanel orgId={org.id} eventId={e.id} />

<LifecycleActions event={e} orgId={org.id} orgSlug={org.slug} role={membership.role} />
```

- [ ] **Step 3: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/certificates/my-certificate-panel.tsx "frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx"
git commit -m "feat(frontend): participant certificate download panel"
```

---

### Task 4: `CertificateManager` — committee list + upload + remove

**Files:**
- Create: `frontend/features/certificates/validate-file.ts`
- Create: `frontend/features/certificates/__tests__/validate-file.test.ts`
- Create: `frontend/components/certificates/certificate-manager.tsx`

**Interfaces:**
- Consumes: `useCertificateList`, `useUploadCertificate`,
  `useRemoveCertificate` (Task 1), `resolveMemberName` (Task 2),
  `useAttendanceList` (existing, Slice 5), `useMembers` (existing, Slice
  4), `resolveParticipantName` (existing, Slice 5 — used for the upload
  picker's options, since its source list is `Attendance[]`, not
  `Certificate[]`), `relativeTime` (existing,
  `features/dashboard/format.ts`).
- Produces: `validateCertificateFile(file: File): string | null` (returns
  an error message, or `null` if valid), `CertificateManager({ orgId,
  eventId })` — consumed by Task 5.

**Steps:**

- [ ] **Step 1: Write the failing tests for `validate-file.ts`.** Create
  `features/certificates/__tests__/validate-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateCertificateFile } from '@/features/certificates/validate-file';

function makeFile(sizeBytes: number, type: string): File {
  return new File([new Uint8Array(sizeBytes)], 'cert.pdf', { type });
}

describe('validateCertificateFile', () => {
  it('accepts a PDF under 5MB', () => {
    expect(validateCertificateFile(makeFile(1024, 'application/pdf'))).toBeNull();
  });

  it('rejects a non-PDF mime type', () => {
    expect(validateCertificateFile(makeFile(1024, 'image/png')))
      .toBe('Only PDF files are accepted');
  });

  it('rejects a file over 5MB', () => {
    expect(validateCertificateFile(makeFile(5 * 1024 * 1024 + 1, 'application/pdf')))
      .toBe('File exceeds the 5MB limit');
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test` — fails, module
  doesn't exist yet.

- [ ] **Step 3: Implement `validate-file.ts`** (mirrors the backend's own
  limits in `certificates.service.ts` — `ALLOWED_MIME`/`MAX_FILE_BYTES` —
  as a fast-fail UX check; the backend re-validates both regardless, so
  this is never the real security boundary):

```ts
const ALLOWED_MIME = 'application/pdf';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function validateCertificateFile(file: File): string | null {
  if (file.type !== ALLOWED_MIME) return 'Only PDF files are accepted';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 5MB limit';
  return null;
}
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Implement `CertificateManager`.** List with resolved
  names, remove behind a confirm dialog, upload form restricted to
  `PRESENT` attendees who don't already have a certificate.

```tsx
'use client';

import { useMemo, useRef, useState } from 'react';
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
import {
  useCertificateList,
  useRemoveCertificate,
  useUploadCertificate,
} from '@/features/certificates/use-certificates';
import { resolveMemberName } from '@/features/certificates/resolve-member-name';
import { validateCertificateFile } from '@/features/certificates/validate-file';
import { useAttendanceList } from '@/features/attendance/use-attendance';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import { useRegistrations } from '@/features/registrations/use-registrations';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { api, ApiError } from '@/lib/api';

function formatFileSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function CertificateManager({ orgId, eventId }: { orgId: string; eventId: string }) {
  const certificates = useCertificateList(orgId, eventId);
  const attendance = useAttendanceList(orgId, eventId);
  const registrations = useRegistrations(orgId, eventId);
  const members = useMembers(orgId, {});
  const upload = useUploadCertificate(orgId, eventId);
  const remove = useRemoveCertificate(orgId, eventId);

  const [selectedUserId, setSelectedUserId] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const certifiedUserIds = useMemo(
    () => new Set((certificates.data ?? []).map((c) => c.userId)),
    [certificates.data],
  );

  const eligibleAttendees = useMemo(
    () =>
      (attendance.data ?? []).filter((a) => {
        if (a.status !== 'PRESENT') return false;
        const registration = (registrations.data ?? []).find((r) => r.id === a.registrationId);
        return registration ? !certifiedUserIds.has(registration.userId) : true;
      }),
    [attendance.data, registrations.data, certifiedUserIds],
  );

  if (certificates.isPending) return null;
  if (certificates.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load certificates.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const file = fileInputRef.current?.files?.[0];
          if (!selectedUserId || !file) return;
          const validationError = validateCertificateFile(file);
          if (validationError) {
            setFileError(validationError);
            return;
          }
          setFileError(null);
          setUploadError(null);
          const formData = new FormData();
          formData.set('userId', selectedUserId);
          formData.set('file', file);
          upload.mutate(formData, {
            onSuccess: () => {
              setSelectedUserId('');
              if (fileInputRef.current) fileInputRef.current.value = '';
            },
            onError: (err) => {
              setUploadError(err instanceof ApiError ? err.message : 'Something went wrong');
            },
          });
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <select
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          aria-label="Attendee"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="">Select attendee…</option>
          {eligibleAttendees.map((a) => (
            <option key={a.id} value={resolveAttendeeUserId(a, registrations.data ?? [])}>
              {resolveParticipantName(a, registrations.data ?? [], members.data ?? [])}
            </option>
          ))}
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          aria-label="Certificate PDF"
          className="text-sm"
        />
        <Button type="submit" size="sm" disabled={upload.isPending || !selectedUserId}>
          {upload.isPending && <Loader2 className="size-4 animate-spin" />}
          Upload
        </Button>
      </form>
      {fileError && (
        <p role="alert" className="text-sm text-danger">{fileError}</p>
      )}
      {uploadError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {uploadError}
        </p>
      )}

      {(certificates.data ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No certificates issued yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {(certificates.data ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
            >
              <span>{resolveMemberName(c.userId, members.data ?? [])}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-foreground-subtle">
                  {formatFileSize(c.fileSizeBytes)} · {relativeTime(c.createdAt)}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const { downloadUrl } = await (
                      await import('@/lib/api')
                    ).api<{ downloadUrl: string }>(
                      `/organizations/${orgId}/events/${eventId}/certificates/${c.id}/download`,
                    );
                    window.open(downloadUrl, '_blank', 'noreferrer');
                  }}
                >
                  Download
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRemoving(c.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove certificate?</DialogTitle>
            <DialogDescription>
              They&apos;ll no longer be able to download it. You can re-upload it later.
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

function resolveAttendeeUserId(
  attendance: { registrationId: string },
  registrations: { id: string; userId: string }[],
): string {
  return registrations.find((r) => r.id === attendance.registrationId)?.userId ?? '';
}
```

- [ ] **Step 6: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/features/certificates/validate-file.ts frontend/features/certificates/__tests__/validate-file.test.ts frontend/components/certificates/certificate-manager.tsx
git commit -m "feat(frontend): committee certificate manager — list, upload, remove"
```

---

### Task 5: Wire the `/certificates` pages

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/certificates/page.tsx` (replace
  placeholder)
- Create: `frontend/app/(app)/[orgSlug]/certificates/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `isCommittee` (existing, Slice 2), `CertificateManager` (Task
  4), `useEvents`/`useEvent` (existing, Slice 2).

**Steps:**

- [ ] **Step 1: Event-picker page.** Same shape as Slice 5's
  `/attendance` picker, gated by `isCommittee` instead of
  `canManageAttendance` (no VOLUNTEER capability here).

```tsx
'use client';

import Link from 'next/link';
import { Award } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvents } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function CertificatesPage() {
  const { org, membership } = useOrg();
  const eligible = isCommittee(membership.role);
  const events = useEvents(org.id);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <Award className="size-5 text-domain-certificates" />
        </div>
        <h1 className="text-xl font-semibold">Certificates</h1>
        <p className="text-sm text-foreground-muted">
          Certificates are managed by committee. Find your own certificate on an
          event&apos;s page once it&apos;s ready.
        </p>
      </main>
    );
  }

  const nonDraft = (events.data ?? []).filter((e) => e.status !== 'DRAFT');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Certificates</h1>
      {events.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}
      {events.data && nonDraft.length === 0 && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No events to manage certificates for yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {nonDraft.map((e) => (
          <Link
            key={e.id}
            href={`/${org.slug}/certificates/${e.id}`}
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

- [ ] **Step 2: Manage page.** `isCommittee`-gated redirect (mirrors
  Slice 5's scan page pattern). Renders `CertificateManager` for the
  picked event.

```tsx
'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { CertificateManager } from '@/components/certificates/certificate-manager';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';

export default function CertificatesManagePage({
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
    if (!eligible) router.replace(`/${org.slug}/certificates`);
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
        href={`/${org.slug}/certificates`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>
      <h1 className="text-2xl font-semibold">{event.data.title}</h1>
      <CertificateManager orgId={org.id} eventId={eventId} />
    </main>
  );
}
```

- [ ] **Step 3: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/certificates"
git commit -m "feat(frontend): certificates event picker + manage page wired in"
```

---

### Task 6: Live verification + polish

Not a code task on its own — a checkpoint, same as Slices 1–5's
live-driven tasks. No separate commit unless verification surfaces a real
bug (then fix + commit as its own small commit, description reflecting
the actual bug).

- [ ] **Step 1:** `docker compose up -d` if the stack has stopped. Start
  backend (`npm run start:dev`) and frontend (`npm run dev`) dev servers.
  If port 3000/3001 is held by a stale process, `taskkill //PID <pid> //F`
  before starting.
- [ ] **Step 2:** As a President (org creator), create and publish an
  event with `requireFeedbackForCertificate: false` (so certificate
  generation fires immediately on completion, no feedback-window wait —
  reuse the register-a-second-account pattern from Slices 3–5), register
  a second (participant) account for it.
- [ ] **Step 3:** As the President, mark the participant `PRESENT` via
  `/attendance` (manual-entry fallback, same as Slice 5's flow), then
  complete the event.
- [ ] **Step 4:** As the participant, open the event detail page, confirm
  "Download certificate" appears once generation has finished (may need a
  short wait/refetch for the BullMQ job to process — poll
  `GET .../certificates/me` via curl if the UI doesn't show it within a
  few seconds, to distinguish a real bug from job-processing latency),
  click it, confirm a real PDF downloads.
- [ ] **Step 5:** As the President, navigate to `/certificates`, confirm
  the event picker lists the event, click into it, confirm the list shows
  the participant's real name (not a raw id) with correct file size and
  upload time.
- [ ] **Step 6:** Remove the certificate via the confirm dialog, confirm
  the row disappears and `certificates.isPending` transition doesn't
  flash an error state.
- [ ] **Step 7:** Re-upload a certificate for the same participant through
  the upload form (any small PDF file), confirm it reappears in the list
  and the attendee dropdown no longer offers them (since they now have
  one again).
- [ ] **Step 8:** Register a third account, mark them `PRESENT` too but do
  **not** generate/upload a certificate for them — confirm they still
  appear in the upload dropdown (eligible, no certificate yet) while the
  first participant does not.
- [ ] **Step 9:** As a plain PARTICIPANT account (not committee),
  navigate to `/certificates` directly — confirm the explainer renders,
  not the event picker.
- [ ] **Step 10:** Screenshot the event picker, the manage page (list +
  upload form), and the participant's event-detail download button in
  both light and dark themes (Playwright) — confirm no domain-hue leakage
  onto anything but the nav icon.
- [ ] **Step 11:** Full regression — `npm test` (frontend) and `npm test
  && npm run test:e2e` (backend, confirming this slice touched zero
  backend files) — both must match the pre-slice baseline (frontend
  68+new/68+new all green; backend 101/326 unchanged).

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** update `docs/uiux.md` with a "Slice 6 — Certificates
(shipped)" section (generation being fully automatic vs. this slice only
building the viewing surface, the `apiUpload` sibling function as this
frontend's first multipart upload, the one-hop `resolveMemberName` vs.
Slice 5's two-hop `resolveParticipantName` reused for the upload picker,
no new role tier needed). Update `docs/current-context.md` (untracked) —
mark Slice 6 shipped, note remaining candidates (Feedback, Analytics,
Workspace, Settings).

**Finish branch:** verify frontend `npm test`/`npm run build` and backend
`npm test`/`npm run test:e2e` all green → merge
`feature/frontend-slice6-certificates` to `main` locally, delete branch.
Never push.
