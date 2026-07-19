# Frontend Slice 5 — Attendance / QR Check-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build the Attendance feature against the live
`AttendanceController`: a participant's own QR check-in code, a
committee/volunteer camera-based scanner (native `BarcodeDetector` with a
manual-entry fallback), and a checked-in roster with mark-absent — names
resolved client-side from already-built endpoints, no backend change.

**Spec:** `docs/superpowers/specs/2026-07-19-frontend-slice5-attendance-design.md`
— authority on behavior; this plan sequences the work.

**Tech stack:** unchanged from Slices 1–4 (Next.js App Router, Tailwind v4,
shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Vitest + RTL),
plus one new runtime dependency this slice: `qrcode` (QR image encoding).

## Global constraints

- Baseline before starting: frontend 64/64 Vitest, clean `npm run build`;
  backend 101 unit / 326 e2e (unchanged since Slice 4 merge, `82dc4ab`).
  Backend is **not touched** this slice — no new endpoints needed, full
  contract verified against the existing `AttendanceController`/
  `AttendanceService` source during brainstorming.
- Branch: `feature/frontend-slice5-attendance`, cut from `main` at the
  start of Task 1.
- One commit per task. `npm test` + `npm run build` clean before each
  commit.
- `qrcode` is the **only** new dependency this slice — camera scanning uses
  the browser-native `BarcodeDetector` API (feature-detected, no library),
  per the explicit design choice. Install both `qrcode` and its type
  package `@types/qrcode` (dev dependency) in Task 4, the task that first
  needs them — not earlier.
- Status badges use semantic tokens (`REGISTERED`=neutral, `PRESENT`=success,
  `ABSENT`=danger) — never the Attendance domain hue (teal,
  `--domain-attendance`), which stays on the nav icon only (already wired,
  unchanged this slice).
- No backend join for participant names — `AttendanceRoster` resolves each
  row's name by cross-referencing `Attendance.registrationId` →
  `Registration.userId` (Slice 3's `useRegistrations`) →
  `Member.user.fullName` (Slice 4's `useMembers`), client-side, via a pure
  function with its own unit tests.
- Live verification (Slices 1–4's pattern): after the full flow is wired,
  actually drive it against the running dev backend. Camera scanning itself
  isn't drivable via Playwright in this environment — verify the manual
  token-entry fallback instead, which exercises the identical
  `useScanAttendance` mutation and backend contract as the camera path.
- Icons: Lucide only.

---

### Task 1: Data layer — types, MANAGE_ATTENDANCE tier, query hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Modify: `frontend/features/orgs/roles.ts`
- Modify: `frontend/features/orgs/__tests__/roles.test.ts`
- Create: `frontend/features/attendance/use-attendance.ts`

**Interfaces:**
- Produces: `AttendanceStatus` type, `Attendance` type, `MyAttendance` type,
  `MANAGE_ATTENDANCE_ROLES`, `canManageAttendance(role: MembershipRole):
  boolean`, `useMyAttendance(orgId, eventId)`, `useAttendanceList(orgId,
  eventId)`, `useScanAttendance(orgId, eventId)`, `useMarkAbsent(orgId,
  eventId)` — all consumed by later tasks.

**Steps:**

- [ ] **Step 1: Add the attendance types.** In `types/api.ts`, append
  (field set per `prisma/schema.prisma:209-223`, cross-checked against
  `attendance.service.ts` during brainstorming):

```ts
export type AttendanceStatus = 'REGISTERED' | 'PRESENT' | 'ABSENT';

export interface Attendance {
  id: string;
  registrationId: string;
  eventId: string;
  organizationId: string;
  status: AttendanceStatus;
  scannedAt: string | null;
  scannedBy: string | null;
  createdAt: string;
}

// GET .../attendance/me only — a freshly-signed, non-expiring token, never
// persisted server-side (no qrTokenHash column).
export interface MyAttendance extends Attendance {
  token: string;
}
```

- [ ] **Step 2: Failing test for `canManageAttendance`.** Add to
  `features/orgs/__tests__/roles.test.ts` (append a new `describe` block
  after the existing `canManageRoles` one, and add `canManageAttendance` to
  the import line at the top):

```ts
import { canManageAttendance, canManageMembers, canManageRoles, isCommittee } from '@/features/orgs/roles';
```

```ts
describe('canManageAttendance', () => {
  it('is true for MANAGE_EVENTS tier plus VOLUNTEER (the first tier this frontend gives VOLUNTEER any capability in)', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: true, TREASURER: true,
      EVENT_DIRECTOR: true, COMMITTEE: true, VOLUNTEER: true, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageAttendance(role)).toBe(expected[role]);
  });
});
```

- [ ] **Step 3: Run tests — verify red.** `npm test` — fails,
  `canManageAttendance` doesn't exist yet.

- [ ] **Step 4: Implement `canManageAttendance`.** In
  `features/orgs/roles.ts`, append:

```ts
// Mirrors backend MANAGE_ATTENDANCE (MANAGE_EVENTS + VOLUNTEER) — the
// first role group in this frontend that gives VOLUNTEER any capability.
export const MANAGE_ATTENDANCE_ROLES: MembershipRole[] = [...COMMITTEE_ROLES, 'VOLUNTEER'];

export function canManageAttendance(role: MembershipRole): boolean {
  return MANAGE_ATTENDANCE_ROLES.includes(role);
}
```

- [ ] **Step 5: Run tests — verify green.** `npm test`.

- [ ] **Step 6: Implement `use-attendance.ts`** (no test file — thin
  TanStack Query wiring, same pattern as
  `features/registrations/use-registrations.ts`):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Attendance, MyAttendance } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/attendance`;
}

export function useMyAttendance(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'attendance', 'me'],
    queryFn: () => api<MyAttendance>(`${base(orgId, eventId)}/me`),
    retry: false, // a 404 here is a meaningful answer (no attendance row), not a flake
  });
}

export function useAttendanceList(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'attendance'],
    queryFn: () => api<Attendance[]>(base(orgId, eventId)),
  });
}

function useInvalidateAttendance(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'attendance'] });
  };
}

export function useScanAttendance(orgId: string, eventId: string) {
  const invalidate = useInvalidateAttendance(orgId, eventId);
  return useMutation({
    mutationFn: (token: string) =>
      api<Attendance>(`${base(orgId, eventId)}/scan`, { method: 'POST', body: { token } }),
    onSuccess: invalidate,
  });
}

export function useMarkAbsent(orgId: string, eventId: string) {
  const invalidate = useInvalidateAttendance(orgId, eventId);
  return useMutation({
    mutationFn: (attendanceId: string) =>
      api<Attendance>(`${base(orgId, eventId)}/${attendanceId}/absent`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 7: Verify + commit.** `npm test` + `npm run build`.

```bash
git checkout -b feature/frontend-slice5-attendance
git add frontend/types/api.ts frontend/features/orgs/roles.ts frontend/features/orgs/__tests__/roles.test.ts frontend/features/attendance/use-attendance.ts
git commit -m "feat(frontend): attendance data layer — types, MANAGE_ATTENDANCE tier, query hooks"
```

---

### Task 2: Participant name resolution

**Files:**
- Create: `frontend/features/attendance/resolve-name.ts`
- Create: `frontend/features/attendance/__tests__/resolve-name.test.ts`

**Interfaces:**
- Consumes: `Attendance`, `Registration`, `Member` types (Task 1 / existing
  Slice 3 / existing Slice 4).
- Produces: `resolveParticipantName(attendance: Attendance, registrations:
  Registration[], members: Member[]): string` — consumed by Task 6
  (`AttendanceRoster`).

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create
  `features/attendance/__tests__/resolve-name.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import type { Attendance, Member, Registration } from '@/types/api';

function makeAttendance(overrides: Partial<Attendance> = {}): Attendance {
  return {
    id: 'a1', registrationId: 'r1', eventId: 'e1', organizationId: 'o1',
    status: 'REGISTERED', scannedAt: null, scannedBy: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', eventId: 'e1', organizationId: 'o1', userId: 'u1', answers: null,
    status: 'APPROVED', consentRecordId: null, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1', userId: 'u1', organizationId: 'o1', role: 'PARTICIPANT', status: 'ACTIVE',
    studentId: null, faculty: null, programme: null, intake: null, phone: null,
    committeeHistory: null, joinedAt: '2026-01-01T00:00:00Z',
    user: { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com' },
    ...overrides,
  };
}

describe('resolveParticipantName', () => {
  it('resolves the full name when both the registration and member are found', () => {
    const name = resolveParticipantName(makeAttendance(), [makeRegistration()], [makeMember()]);
    expect(name).toBe('Ada Lovelace');
  });

  it('falls back to the raw registrationId when no matching registration exists', () => {
    const name = resolveParticipantName(makeAttendance({ registrationId: 'missing' }), [makeRegistration()], [makeMember()]);
    expect(name).toBe('missing');
  });

  it('falls back to the raw userId when the registration exists but no member matches', () => {
    const name = resolveParticipantName(makeAttendance(), [makeRegistration({ userId: 'orphan-user' })], [makeMember()]);
    expect(name).toBe('orphan-user');
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test` — fails, module
  doesn't exist yet.

- [ ] **Step 3: Implement `resolve-name.ts`:**

```ts
import type { Attendance, Member, Registration } from '@/types/api';

// Neither GET /attendance nor GET /registrations joins a participant's
// name — resolve it client-side from two already-fetched lists. A missing
// registration or member (shouldn't happen given the lifecycle guarantees,
// but not impossible under a race) falls back to a raw id rather than
// crashing or hiding the row.
export function resolveParticipantName(
  attendance: Attendance,
  registrations: Registration[],
  members: Member[],
): string {
  const registration = registrations.find((r) => r.id === attendance.registrationId);
  if (!registration) return attendance.registrationId;
  const member = members.find((m) => m.userId === registration.userId);
  if (!member) return registration.userId;
  return member.user.fullName;
}
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Verify + commit.** `npm run build`.

```bash
git add frontend/features/attendance/resolve-name.ts frontend/features/attendance/__tests__/resolve-name.test.ts
git commit -m "feat(frontend): attendance participant-name resolution from registrations+members"
```

---

### Task 3: AttendanceStatusBadge

**Files:**
- Create: `frontend/components/attendance/attendance-status-badge.tsx`

**Interfaces:**
- Consumes: `AttendanceStatus` (Task 1).
- Produces: `AttendanceStatusBadge({ status })` — consumed by Task 6.

**Steps:**

- [ ] **Step 1: Implement the badge.** Same shape as
  `MemberStatusBadge`/`RegistrationStatusBadge`, semantic tokens only:

```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@/types/api';

const STATUS_STYLES: Record<AttendanceStatus, { label: string; className: string }> = {
  REGISTERED: {
    label: 'Registered',
    className: 'border-border bg-surface-secondary text-foreground-muted',
  },
  PRESENT: { label: 'Present', className: 'border-success/40 bg-success/10 text-success' },
  ABSENT: { label: 'Absent', className: 'border-danger/40 bg-danger/10 text-danger' },
};

export function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/attendance/attendance-status-badge.tsx
git commit -m "feat(frontend): attendance status badge"
```

---

### Task 4: QR display — install `qrcode`, `MyQrDialog`, wire into `MyRegistrationPanel`

**Files:**
- Modify: `frontend/package.json` (via `npm install`)
- Create: `frontend/components/attendance/my-qr-dialog.tsx`
- Modify: `frontend/components/registrations/my-registration-panel.tsx`

**Interfaces:**
- Consumes: `useMyAttendance` (Task 1).
- Produces: `MyQrDialog({ orgId, eventId, open, onOpenChange })` — consumed
  by the modified `MyRegistrationPanel`.

**Steps:**

- [ ] **Step 1: Install the dependency.**

```bash
cd frontend && npm install qrcode && npm install -D @types/qrcode
```

- [ ] **Step 2: Implement `MyQrDialog`.**

```tsx
'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMyAttendance } from '@/features/attendance/use-attendance';

interface MyQrDialogProps {
  orgId: string;
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MyQrDialog({ orgId, eventId, open, onOpenChange }: MyQrDialogProps) {
  const attendance = useMyAttendance(orgId, eventId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (attendance.data?.token) {
      QRCode.toDataURL(attendance.data.token).then(setImageUrl);
    } else {
      setImageUrl(null);
    }
  }, [attendance.data?.token]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your check-in code</DialogTitle>
          <DialogDescription>Show this at the door to be scanned in.</DialogDescription>
        </DialogHeader>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL, next/image adds nothing here
          <img src={imageUrl} alt="Check-in QR code" className="mx-auto size-56" />
        ) : (
          <p className="text-sm text-foreground-muted">
            {attendance.isPending ? 'Loading…' : 'No check-in code available.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire into `MyRegistrationPanel`.** In
  `components/registrations/my-registration-panel.tsx`, add the import,
  add `qrOpen` state, render the "Show my check-in code" button only when
  `registration.status === 'APPROVED'`, and render `MyQrDialog`:

```ts
import { MyQrDialog } from '@/components/attendance/my-qr-dialog';
```

```tsx
const [qrOpen, setQrOpen] = useState(false);
```

Add inside the `<div className="flex items-center gap-2">` block, after the
existing cancel button:

```tsx
{registration.status === 'APPROVED' && (
  <Button variant="secondary" size="sm" onClick={() => setQrOpen(true)}>
    Show my check-in code
  </Button>
)}
```

Add just before the closing `</div>` of the component's return, alongside
the existing cancel `Dialog`:

```tsx
<MyQrDialog orgId={orgId} eventId={event.id} open={qrOpen} onOpenChange={setQrOpen} />
```

- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/package.json frontend/package-lock.json frontend/components/attendance/my-qr-dialog.tsx frontend/components/registrations/my-registration-panel.tsx
git commit -m "feat(frontend): participant check-in QR display"
```

---

### Task 5: QrScanner (BarcodeDetector + manual fallback)

**Files:**
- Create: `frontend/components/attendance/qr-scanner.tsx`

**Interfaces:**
- Consumes: `useScanAttendance` (Task 1).
- Produces: `QrScanner({ orgId, eventId })` — consumed by Task 7 (event
  scan page).

**Steps:**

- [ ] **Step 1: Implement the scanner.** Feature-detects
  `'BarcodeDetector' in window` (not yet in TypeScript's default DOM lib —
  declare a minimal ambient type rather than adding a `@types` package for
  one interface). Camera path decodes frames in a loop via
  `requestAnimationFrame`, de-duplicating a still-in-frame value so it
  isn't resubmitted every frame. Manual path is a plain form using the same
  mutation. Feedback auto-clears after 2 seconds (per spec) so the scanner
  is immediately ready for the next person.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useScanAttendance } from '@/features/attendance/use-attendance';
import { ApiError } from '@/lib/api';

// BarcodeDetector isn't in TypeScript's default DOM lib yet.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike;
  }
}

type Feedback = { kind: 'success' | 'error'; message: string } | null;

export function QrScanner({ orgId, eventId }: { orgId: string; eventId: string }) {
  const scan = useScanAttendance(orgId, eventId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [manualToken, setManualToken] = useState('');
  const lastValueRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window);
  }, []);

  useEffect(() => {
    if (!supported) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let frame: number;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const Detector = window.BarcodeDetector!;
        const detector = new Detector({ formats: ['qr_code'] });

        const tick = async () => {
          if (stopped) return;
          if (videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const results = await detector.detect(videoRef.current);
              const value = results[0]?.rawValue;
              if (value && value !== lastValueRef.current) {
                lastValueRef.current = value;
                submit(value);
              }
            } catch {
              // transient decode failure — try again next frame
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setSupported(false); // camera denied/unavailable — fall back to manual entry
      }
    }
    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally
    // re-running only on `supported` (camera start/stop), not on every
    // `submit` closure recreated by render; `submit` calls `scan.mutate`,
    // whose reference is stable across renders for this hook instance, so
    // the closure captured at effect-setup time stays correct.
  }, [supported]);

  function submit(token: string) {
    setFeedback(null);
    scan.mutate(token, {
      onSuccess: () => {
        setFeedback({ kind: 'success', message: 'Checked in.' });
        setTimeout(() => {
          setFeedback(null);
          lastValueRef.current = null;
        }, 2000);
      },
      onError: (e) => {
        setFeedback({
          kind: 'error',
          message: e instanceof ApiError ? e.message : 'Something went wrong',
        });
        setTimeout(() => {
          setFeedback(null);
          lastValueRef.current = null;
        }, 2000);
      },
    });
  }

  if (supported === null) return null;

  return (
    <div className="flex flex-col gap-3">
      {feedback && (
        <p
          role="alert"
          className={
            feedback.kind === 'success'
              ? 'rounded-md bg-success/10 px-3 py-2 text-sm text-success'
              : 'rounded-md bg-danger/10 px-3 py-2 text-sm text-danger'
          }
        >
          {feedback.message}
        </p>
      )}

      {supported ? (
        <video ref={videoRef} className="w-full max-w-sm rounded-lg" muted playsInline />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (manualToken.trim()) {
              submit(manualToken.trim());
              setManualToken('');
            }
          }}
          className="flex max-w-sm gap-2"
        >
          <Input
            placeholder="Paste or type check-in token"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            aria-label="Check-in token"
          />
          <Button type="submit" disabled={scan.isPending || !manualToken.trim()}>
            {scan.isPending && <Loader2 className="size-4 animate-spin" />}
            Check in
          </Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/attendance/qr-scanner.tsx
git commit -m "feat(frontend): QR scanner — BarcodeDetector camera scan, manual fallback"
```

---

### Task 6: AttendanceRoster (checked-in list + mark absent)

**Files:**
- Create: `frontend/components/attendance/attendance-roster.tsx`

**Interfaces:**
- Consumes: `useAttendanceList`, `useMarkAbsent` (Task 1),
  `AttendanceStatusBadge` (Task 3), `resolveParticipantName` (Task 2),
  `useRegistrations` (existing, Slice 3), `useMembers` (existing, Slice 4),
  `relativeTime` (existing, `features/dashboard/format.ts`).
- Produces: `AttendanceRoster({ orgId, eventId })` — consumed by Task 7.

**Steps:**

- [ ] **Step 1: Implement the roster.** Status filter
  (All/Registered/Present/Absent, client-side, same segmented-button
  pattern as `RegistrationsTable`). Each row resolves its display name via
  `resolveParticipantName`. "Mark absent" shown only for `REGISTERED` rows
  (terminal-state hiding, matching `RegistrationsTable`'s reject-button
  pattern), behind a `Dialog` confirm.

```tsx
'use client';

import { useMemo, useState } from 'react';
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
import { AttendanceStatusBadge } from '@/components/attendance/attendance-status-badge';
import { useAttendanceList, useMarkAbsent } from '@/features/attendance/use-attendance';
import { resolveParticipantName } from '@/features/attendance/resolve-name';
import { useRegistrations } from '@/features/registrations/use-registrations';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AttendanceStatus } from '@/types/api';

type StatusFilter = 'all' | AttendanceStatus;
const FILTERS: StatusFilter[] = ['all', 'REGISTERED', 'PRESENT', 'ABSENT'];
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  REGISTERED: 'Registered',
  PRESENT: 'Present',
  ABSENT: 'Absent',
};

export function AttendanceRoster({ orgId, eventId }: { orgId: string; eventId: string }) {
  const attendance = useAttendanceList(orgId, eventId);
  const registrations = useRegistrations(orgId, eventId);
  const members = useMembers(orgId, {});
  const markAbsent = useMarkAbsent(orgId, eventId);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [markingAbsent, setMarkingAbsent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => (attendance.data ?? []).filter((a) => statusFilter === 'all' || a.status === statusFilter),
    [attendance.data, statusFilter],
  );

  if (attendance.isPending) return null;
  if (attendance.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load attendance.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant="ghost"
            size="sm"
            onClick={() => setStatusFilter(f)}
            className={cn(statusFilter === f && 'bg-primary/10 text-primary')}
          >
            {FILTER_LABELS[f]}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-foreground-muted">
          {statusFilter === 'all' ? 'No one registered yet.' : 'No one matches this filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((a) => {
            const name = resolveParticipantName(a, registrations.data ?? [], members.data ?? []);
            const canMarkAbsent = a.status === 'REGISTERED';
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
              >
                <span>{name}</span>
                <div className="flex items-center gap-2">
                  <AttendanceStatusBadge status={a.status} />
                  <span className="hidden text-xs text-foreground-subtle sm:inline">
                    {relativeTime(a.createdAt)}
                  </span>
                  {canMarkAbsent && (
                    <Button variant="destructive" size="sm" onClick={() => setMarkingAbsent(a.id)}>
                      Mark absent
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={markingAbsent !== null} onOpenChange={(open) => !open && setMarkingAbsent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark absent?</DialogTitle>
            <DialogDescription>They&apos;ll be recorded as not attending this event.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMarkingAbsent(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={markAbsent.isPending}
              onClick={() => {
                if (!markingAbsent) return;
                setError(null);
                markAbsent.mutate(markingAbsent, {
                  onSuccess: () => setMarkingAbsent(null),
                  onError: (e) => {
                    setMarkingAbsent(null);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {markAbsent.isPending && <Loader2 className="size-4 animate-spin" />}
              Mark absent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/attendance/attendance-roster.tsx
git commit -m "feat(frontend): committee attendance roster — filter, mark absent"
```

---

### Task 7: Wire the `/attendance` pages

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/attendance/page.tsx` (replace
  placeholder)
- Create: `frontend/app/(app)/[orgSlug]/attendance/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `canManageAttendance` (Task 1), `QrScanner` (Task 5),
  `AttendanceRoster` (Task 6), `useEvents`/`useEvent` (existing, Slice 2).

**Steps:**

- [ ] **Step 1: Event-picker page.** Content gated by
  `canManageAttendance(membership.role)` — non-eligible viewers see a short
  explainer instead of the event list (the nav item itself stays visible to
  everyone, matching `GET /me` being for any member; only this page's
  content branches, same as the dashboard's role branch).

```tsx
'use client';

import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvents } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageAttendance } from '@/features/orgs/roles';

export default function AttendancePage() {
  const { org, membership } = useOrg();
  const eligible = canManageAttendance(membership.role);
  const events = useEvents(org.id);

  if (!eligible) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
          <CalendarDays className="size-5 text-domain-attendance" />
        </div>
        <h1 className="text-xl font-semibold">Check-in tools</h1>
        <p className="text-sm text-foreground-muted">
          Check-in tools are for committee and volunteers. Find your own check-in code on an
          event&apos;s page.
        </p>
      </main>
    );
  }

  const nonDraft = (events.data ?? []).filter((e) => e.status !== 'DRAFT');

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Attendance</h1>
      {events.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      )}
      {events.data && nonDraft.length === 0 && (
        <p className="py-8 text-center text-sm text-foreground-muted">
          No events to check in for yet.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {nonDraft.map((e) => (
          <Link
            key={e.id}
            href={`/${org.slug}/attendance/${e.id}`}
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

- [ ] **Step 2: Scan page.** `canManageAttendance`-gated redirect (mirrors
  the events new/edit pages' pattern). Renders `QrScanner` and
  `AttendanceRoster` for the picked event.

```tsx
'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { QrScanner } from '@/components/attendance/qr-scanner';
import { AttendanceRoster } from '@/components/attendance/attendance-roster';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageAttendance } from '@/features/orgs/roles';

export default function AttendanceScanPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const eligible = canManageAttendance(membership.role);
  const event = useEvent(org.id, eventId);

  useEffect(() => {
    if (!eligible) router.replace(`/${org.slug}/attendance`);
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
        href={`/${org.slug}/attendance`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>
      <h1 className="text-2xl font-semibold">{event.data.title}</h1>
      <QrScanner orgId={org.id} eventId={eventId} />
      <AttendanceRoster orgId={org.id} eventId={eventId} />
    </main>
  );
}
```

- [ ] **Step 3: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/attendance"
git commit -m "feat(frontend): attendance event picker + scan page wired in"
```

---

### Task 8: Live verification + polish

Not a code task on its own — a checkpoint, same as Slices 1–4's live-driven
tasks. No separate commit unless verification surfaces a real bug (then fix
+ commit as its own small commit, description reflecting the actual bug).

- [ ] **Step 1:** `docker compose up -d` if the stack has stopped. Start
  backend (`npm run start:dev`) and frontend (`npm run dev`) dev servers.
  If port 3000 is held by a stale process, `taskkill //PID <pid> //F`
  before starting (recurring issue this session, not a code bug).
- [ ] **Step 2:** As a President (org creator), create and publish an
  event, register a second (participant) account for it — reuse the
  register-a-second-account pattern from Slices 3–4.
- [ ] **Step 3:** As the participant, open the event detail page, confirm
  the "Show my check-in code" button appears once approved, click it,
  confirm a QR image renders in the dialog.
- [ ] **Step 4:** As the President, navigate to `/attendance`, confirm the
  event picker lists the published event, click into it, confirm the
  roster shows the participant's real name (not a raw id) with status
  Registered.
- [ ] **Step 5:** Fetch the participant's token directly (e.g. via a
  logged-in curl call to `GET .../attendance/me` with their access token,
  same pattern used for account setup in prior slices' live verification)
  and submit it through the manual-entry fallback form on the scan page —
  confirm status flips to Present in the roster and the "Mark absent"
  button disappears for that row.
- [ ] **Step 6:** Submit the same token again through manual entry —
  confirm the "Attendance already resolved (scanned or marked absent)"
  message surfaces inline.
- [ ] **Step 7:** Register a third account for the event, leave them
  unresolved (don't scan), use "Mark absent" on their roster row with the
  confirm dialog — confirm status flips to Absent and the action
  disappears for that row.
- [ ] **Step 8:** As a plain PARTICIPANT account (not committee/volunteer),
  navigate to `/attendance` directly — confirm the explainer renders, not
  the event picker.
- [ ] **Step 9:** Screenshot the event picker, the scan page (manual-entry
  fallback state), and the QR-code dialog in both light and dark themes
  (Playwright) — confirm status badges read correctly in both and the
  Attendance domain hue (teal) never appears on a status badge.
- [ ] **Step 10:** Full regression — `npm test` (frontend) and `npm test
  && npm run test:e2e` (backend, confirming this slice touched zero
  backend files) — both must match the pre-slice baseline (frontend
  64+new/64+new all green; backend 101/326 unchanged).

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** update `docs/uiux.md` with a "Slice 5 — Attendance / QR
Check-in (shipped)" section (the new `MANAGE_ATTENDANCE`/VOLUNTEER tier,
the `BarcodeDetector` feature-detection + manual-fallback pattern, the
client-side name-resolution join and why no backend join was requested,
the first new runtime dependency (`qrcode`) this frontend has added).
Update `docs/current-context.md` (untracked) — mark Slice 5 shipped, note
remaining candidates (Certificates, Feedback, Analytics, Workspace,
Settings — all unscoped placeholders with no prior slice having carved
them out specifically).

**Finish branch:** verify frontend `npm test`/`npm run build` and backend
`npm test`/`npm run test:e2e` all green → merge
`feature/frontend-slice5-attendance` to `main` locally, delete branch.
Never push.
