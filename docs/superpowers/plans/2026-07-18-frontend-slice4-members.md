# Frontend Slice 4 — Members — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build the Members feature against the live `MembershipsController`:
list (search + server-side role/status filter), add a member, member detail
with committee history, edit profile/status, change role (President/VP
only), remove — while fixing two real type/backend mismatches in the
existing `types/api.ts` (`MembershipRole` had a stray `'ALUMNI'` value;
`MyMembership.status` had a stray `'INACTIVE'` value).

**Spec:** `docs/superpowers/specs/2026-07-18-frontend-slice4-members-design.md`
— authority on behavior; this plan sequences the work.

**Tech stack:** unchanged from Slices 1–3 (Next.js App Router, Tailwind v4,
shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Vitest + RTL).

## Global constraints

- Baseline before starting: frontend 54/54 Vitest, clean `npm run build`;
  backend 101 unit / 326 e2e (unchanged since Slice 3 merge, `5f8f1e5`).
  Backend is **not touched** this slice.
- Branch: `feature/frontend-slice4-members`, cut from `main` at the start of
  Task 1.
- One commit per task. `npm test` + `npm run build` clean before each
  commit.
- **There is no `GET /organizations/:orgId/members/:membershipId`.** The
  detail and edit pages find the target row inside the already-fetched
  (unfiltered) member list — never invent a single-fetch hook that doesn't
  exist on the backend.
- No new shadcn components — role/status selects are plain styled
  `<select>`, matching the precedent from Slices 2–3's event/registration
  forms.
- Role badges use the shared `Badge` component with `variant="outline"` and
  **no color-coding** (role is not a success/failure signal). Status badges
  use semantic tokens (`--success`/`--neutral`) — never the domain hue.
  Members has no assigned domain hue (`nav-items.ts` keeps
  Dashboard/Members/Settings neutral by design) and this slice doesn't
  introduce one.
- Live verification (Slices 1–3's pattern): after the full flow is wired,
  actually drive it against the running dev backend — add, filter, edit,
  change role, hit the last-active-president guardrail three ways, remove —
  rather than relying on unit tests alone for page-level correctness.
- Icons: Lucide only.

---

### Task 1: Data layer — type fixes, role tier, query hooks

**Files:**
- Modify: `frontend/types/api.ts`
- Modify: `frontend/features/orgs/roles.ts`
- Modify: `frontend/features/orgs/__tests__/roles.test.ts`
- Create: `frontend/features/members/use-members.ts`

**Interfaces:**
- Produces: `MemberStatus` type, `Member` type, `MANAGE_ROLES_ROLES`,
  `canManageRoles(role: MembershipRole): boolean`, `useMembers(orgId,
  filters: { status?: MemberStatus; role?: MembershipRole })`,
  `useAddMember(orgId)`, `useUpdateMember(orgId, membershipId)`,
  `useChangeRole(orgId, membershipId)`, `useRemoveMember(orgId)` — all
  consumed by later tasks' pages/components.

**Steps:**

- [ ] **Step 1: Fix the type mismatches and add `MemberStatus`/`Member`.**
  In `types/api.ts`, replace the `MembershipRole` union (remove the stray
  `'ALUMNI'` — confirmed against `prisma/schema.prisma`'s `Role` enum,
  which has 9 values, none of them ALUMNI) and `MyMembership` (remove the
  stray `'INACTIVE'` from `status`, replace with the new `MemberStatus`
  type):

```ts
export type MembershipRole =
  | 'PRESIDENT'
  | 'VICE_PRESIDENT'
  | 'SECRETARY'
  | 'TREASURER'
  | 'EVENT_DIRECTOR'
  | 'COMMITTEE'
  | 'VOLUNTEER'
  | 'PARTICIPANT'
  | 'ADVISOR';

export type MemberStatus = 'ACTIVE' | 'ALUMNI';

export interface MyMembership {
  id: string;
  role: MembershipRole;
  status: MemberStatus;
}
```

  Then append, after the existing `ConsentRecordItem` interface:

```ts
export interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MemberStatus;
  studentId: string | null;
  faculty: string | null;
  programme: string | null;
  intake: string | null;
  phone: string | null;
  committeeHistory: { role: MembershipRole; until: string }[];
  joinedAt: string;
  user: {
    id: string;
    fullName: string;
    email: string;
  };
}
```

- [ ] **Step 2: Failing test for `canManageRoles`.** Add to
  `features/orgs/__tests__/roles.test.ts` (append a new `describe` block
  after the existing `canManageMembers` one — the file already imports
  `MembershipRole` and defines `ALL`; **update `ALL` first** since it still
  lists the now-removed `'ALUMNI'` role):

```ts
const ALL: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];
```

  Then append:

```ts
describe('canManageRoles', () => {
  it('is true only for PRESIDENT and VICE_PRESIDENT', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: false, TREASURER: false,
      EVENT_DIRECTOR: false, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageRoles(role)).toBe(expected[role]);
  });
});
```

  And add `canManageRoles` to the existing import line at the top of the
  file:

```ts
import { canManageMembers, canManageRoles, isCommittee } from '@/features/orgs/roles';
```

- [ ] **Step 3: Run tests — verify red.** `npm test` — fails, `canManageRoles`
  doesn't exist yet, and the `Record<MembershipRole, boolean>` object
  literals in the two existing `describe` blocks (`isCommittee`,
  `canManageMembers`) will also fail to compile until `ALL`'s `'ALUMNI'`
  entry and the two `expected` objects' `ALUMNI: false` lines are removed
  from those blocks too (they were written against the old 10-value union).
  Remove the `ALUMNI: false,` line from both existing `expected` object
  literals in this same step, alongside the `ALL` update from Step 2.

- [ ] **Step 4: Implement `canManageRoles`.** In `features/orgs/roles.ts`,
  append:

```ts
// Mirrors backend MANAGE_ROLES — President/VP only, gates role changes and
// removal (stricter than MANAGE_MEMBERS, which excludes only COMMITTEE).
export const MANAGE_ROLES_ROLES: MembershipRole[] = ['PRESIDENT', 'VICE_PRESIDENT'];

export function canManageRoles(role: MembershipRole): boolean {
  return MANAGE_ROLES_ROLES.includes(role);
}
```

- [ ] **Step 5: Run tests — verify green.** `npm test`.

- [ ] **Step 6: Implement `use-members.ts`** (no test file — thin
  TanStack Query wiring, same pattern as `features/events/use-events.ts`):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Member, MemberStatus, MembershipRole } from '@/types/api';

interface MemberFilters {
  status?: MemberStatus;
  role?: MembershipRole;
}

function base(orgId: string) {
  return `/organizations/${orgId}/members`;
}

function queryString(filters: MemberFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.role) params.set('role', filters.role);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function useMembers(orgId: string, filters: MemberFilters = {}) {
  return useQuery({
    queryKey: ['org', orgId, 'members', filters],
    queryFn: () => api<Member[]>(`${base(orgId)}${queryString(filters)}`),
  });
}

function useInvalidateMembers(orgId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'members'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'me'] });
  };
}

export interface AddMemberInput {
  email: string;
  role: MembershipRole;
  studentId?: string;
  faculty?: string;
  programme?: string;
  intake?: string;
  phone?: string;
}

export function useAddMember(orgId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (input: AddMemberInput) =>
      api<Member>(base(orgId), { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export interface UpdateMemberInput {
  status?: MemberStatus;
  studentId?: string;
  faculty?: string;
  programme?: string;
  intake?: string;
  phone?: string;
}

export function useUpdateMember(orgId: string, membershipId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (input: UpdateMemberInput) =>
      api<Member>(`${base(orgId)}/${membershipId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useChangeRole(orgId: string, membershipId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (role: MembershipRole) =>
      api<Member>(`${base(orgId)}/${membershipId}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: invalidate,
  });
}

export function useRemoveMember(orgId: string) {
  const invalidate = useInvalidateMembers(orgId);
  return useMutation({
    mutationFn: (membershipId: string) =>
      api<{ removed: true }>(`${base(orgId)}/${membershipId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 7: Verify + commit.** `npm test` + `npm run build`.

```bash
git checkout -b feature/frontend-slice4-members
git add frontend/types/api.ts frontend/features/orgs/roles.ts frontend/features/orgs/__tests__/roles.test.ts frontend/features/members/use-members.ts
git commit -m "feat(frontend): members data layer — type fixes, MANAGE_ROLES tier, query hooks"
```

---

### Task 2: Add/edit member schemas

**Files:**
- Create: `frontend/features/members/schemas.ts`
- Create: `frontend/features/members/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `MembershipRole`, `MemberStatus` from `types/api.ts` (Task 1).
- Produces: `addMemberSchema`, `AddMemberFormInput`, `editMemberSchema`,
  `EditMemberFormInput` — consumed by Task 5 (add page) and Task 7 (edit
  page).

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create
  `features/members/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addMemberSchema, editMemberSchema } from '@/features/members/schemas';

describe('addMemberSchema', () => {
  const base = { email: 'a@example.com', role: 'VOLUNTEER' as const };

  it('accepts a minimal valid input', () => {
    expect(addMemberSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const r = addMemberSchema.safeParse({ ...base, email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('requires a role', () => {
    const r = addMemberSchema.safeParse({ email: base.email });
    expect(r.success).toBe(false);
  });

  it('accepts all optional profile fields blank', () => {
    const full = { ...base, studentId: '', faculty: '', programme: '', intake: '', phone: '' };
    expect(addMemberSchema.safeParse(full).success).toBe(true);
  });

  it('accepts all optional profile fields filled', () => {
    const full = {
      ...base, studentId: 'S123', faculty: 'Engineering', programme: 'CS',
      intake: '2026', phone: '+60123456789',
    };
    expect(addMemberSchema.safeParse(full).success).toBe(true);
  });
});

describe('editMemberSchema', () => {
  const base = { status: 'ACTIVE' as const };

  it('accepts status alone', () => {
    expect(editMemberSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid status value', () => {
    const r = editMemberSchema.safeParse({ status: 'SUSPENDED' });
    expect(r.success).toBe(false);
  });

  it('accepts ALUMNI as a valid status', () => {
    expect(editMemberSchema.safeParse({ status: 'ALUMNI' }).success).toBe(true);
  });

  it('has no role or email field in its shape', () => {
    const parsed = editMemberSchema.safeParse({ ...base, role: 'PRESIDENT', email: 'x@example.com' });
    // Zod strips unknown keys by default (non-strict) — the parsed output
    // must not carry them through, mirroring the backend DTO's structural
    // safety (UpdateMemberDto has no role/email field at all).
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('role' in parsed.data).toBe(false);
      expect('email' in parsed.data).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test` — fails, module
  doesn't exist yet.

- [ ] **Step 3: Implement `schemas.ts`:**

```ts
import { z } from 'zod';

// Mirrors backend AddMemberDto — email + role required, profile fields
// optional strings (backend does the real validation; this just keeps
// obvious errors off the wire).
export const addMemberSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role: z.enum([
    'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
    'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
  ]),
  studentId: z.string().optional(),
  faculty: z.string().optional(),
  programme: z.string().optional(),
  intake: z.string().optional(),
  phone: z.string().optional(),
});

export type AddMemberFormInput = z.infer<typeof addMemberSchema>;

// Mirrors backend UpdateMemberDto exactly — no role, no email. Status is
// optional at the schema level (UpdateMemberDto's status is optional too),
// the edit page always sends one because its form always seeds a value.
export const editMemberSchema = z.object({
  status: z.enum(['ACTIVE', 'ALUMNI']).optional(),
  studentId: z.string().optional(),
  faculty: z.string().optional(),
  programme: z.string().optional(),
  intake: z.string().optional(),
  phone: z.string().optional(),
});

export type EditMemberFormInput = z.infer<typeof editMemberSchema>;
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Verify + commit.** `npm run build`.

```bash
git add frontend/features/members/schemas.ts frontend/features/members/__tests__/schemas.test.ts
git commit -m "feat(frontend): add/edit member schemas"
```

---

### Task 3: Badges + not-found component

**Files:**
- Create: `frontend/components/members/member-role-badge.tsx`
- Create: `frontend/components/members/member-status-badge.tsx`
- Create: `frontend/components/members/member-not-found.tsx`

**Interfaces:**
- Consumes: `MembershipRole`, `MemberStatus` from `types/api.ts` (Task 1).
- Produces: `MemberRoleBadge({ role })`, `MemberStatusBadge({ status })`,
  `MemberNotFound()` — consumed by Task 4 (list), Task 6 (detail), Task 7
  (edit).

**Steps:**

- [ ] **Step 1: `MemberRoleBadge`.** Plain outline badge, human-readable
  label, no color-coding:

```tsx
import { Badge } from '@/components/ui/badge';
import type { MembershipRole } from '@/types/api';

const ROLE_LABELS: Record<MembershipRole, string> = {
  PRESIDENT: 'President',
  VICE_PRESIDENT: 'Vice President',
  SECRETARY: 'Secretary',
  TREASURER: 'Treasurer',
  EVENT_DIRECTOR: 'Event Director',
  COMMITTEE: 'Committee',
  VOLUNTEER: 'Volunteer',
  PARTICIPANT: 'Participant',
  ADVISOR: 'Advisor',
};

export function MemberRoleBadge({ role }: { role: MembershipRole }) {
  return (
    <Badge variant="outline" className="shrink-0">
      {ROLE_LABELS[role]}
    </Badge>
  );
}
```

- [ ] **Step 2: `MemberStatusBadge`.** Semantic tokens, same family as
  `EventStatusBadge`/`RegistrationStatusBadge`:

```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MemberStatus } from '@/types/api';

const STATUS_STYLES: Record<MemberStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'border-success/40 bg-success/10 text-success' },
  ALUMNI: { label: 'Alumni', className: 'border-border bg-surface-secondary text-foreground-muted' },
};

export function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
```

- [ ] **Step 3: `MemberNotFound`.** Same visual weight and vagueness as
  `EventNotFound` — no distinction shown between "removed", "foreign org",
  or "still loading and legitimately absent":

```tsx
import { UserX } from 'lucide-react';

export function MemberNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-secondary">
        <UserX className="size-5 text-foreground-muted" />
      </div>
      <h1 className="text-xl font-semibold">Member not found</h1>
      <p className="text-sm text-foreground-muted">
        It may have been removed, or you don&apos;t have access to it.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/members/member-role-badge.tsx frontend/components/members/member-status-badge.tsx frontend/components/members/member-not-found.tsx
git commit -m "feat(frontend): member role/status badges, not-found state"
```

---

### Task 4: Members list page

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/members/page.tsx` (replace
  placeholder)

**Interfaces:**
- Consumes: `useMembers` (Task 1), `MemberRoleBadge`, `MemberStatusBadge`
  (Task 3), `isCommittee`, `canManageMembers` (existing), `relativeTime`
  (existing, `features/dashboard/format.ts`).

**Steps:**

- [ ] **Step 1: List page.** `'use client'`; `useOrg()` for `org`/
  `membership`. Local state: `search` (string), `roleFilter` (`'all' |
  MembershipRole`), `statusFilter` (`'all' | MemberStatus`). Pass
  `roleFilter`/`statusFilter` straight into `useMembers(org.id, { role:
  roleFilter === 'all' ? undefined : roleFilter, status: statusFilter ===
  'all' ? undefined : statusFilter })` — the refetch on filter change is
  the point (server-side filtering, per the spec's explicit choice).
  Search stays client-side (`useMemo`, substring match on
  `member.user.fullName`/`member.user.email`, case-insensitive) applied on
  top of whatever the server already returned. "Add member" link
  (`canManageMembers(membership.role)`-gated) → `/members/new`. Each row:
  name, email, `MemberRoleBadge`, `MemberStatusBadge`,
  `relativeTime(member.joinedAt)` — wrapped in a `Link` to
  `/members/${member.id}`. Empty states: no members at all is impossible
  (the viewer is always at least one), so only two: filters produce zero
  results ("No members match your search or filter") vs. genuinely nothing
  to show is not a reachable state — omit that branch entirely (would be
  dead code, since the org creator is always a member).

```tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, UserPlus } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberRoleBadge } from '@/components/members/member-role-badge';
import { MemberStatusBadge } from '@/components/members/member-status-badge';
import { useMembers } from '@/features/members/use-members';
import { relativeTime } from '@/features/dashboard/format';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers } from '@/features/orgs/roles';
import type { MemberStatus, MembershipRole } from '@/types/api';

type RoleFilter = 'all' | MembershipRole;
type StatusFilter = 'all' | MemberStatus;

const ROLE_OPTIONS: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

export default function MembersPage() {
  const { org, membership } = useOrg();
  const canAdd = canManageMembers(membership.role);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const members = useMembers(org.id, {
    role: roleFilter === 'all' ? undefined : roleFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const filtered = useMemo(() => {
    if (!members.data) return [];
    if (!search) return members.data;
    const q = search.toLowerCase();
    return members.data.filter(
      (m) => m.user.fullName.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [members.data, search]);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Members</h1>
        {canAdd && (
          <Link href={`/${org.slug}/members/new`} className={buttonVariants()}>
            <UserPlus className="size-4" />
            Add member
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            placeholder="Search members…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            aria-label="Search members by name or email"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          aria-label="Filter by role"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="ALUMNI">Alumni</option>
        </select>
      </div>

      {members.isPending && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {members.data && filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-foreground-muted">
          No members match your search or filter.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {filtered.map((m) => (
          <Link
            key={m.id}
            href={`/${org.slug}/members/${m.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{m.user.fullName}</span>
              <span className="text-xs text-foreground-muted">{m.user.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <MemberRoleBadge role={m.role} />
              <MemberStatusBadge status={m.status} />
              <span className="hidden text-xs text-foreground-subtle sm:inline">
                {relativeTime(m.joinedAt)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/members/page.tsx"
git commit -m "feat(frontend): members list — search, server-side role/status filter"
```

---

### Task 5: Add member page

**Files:**
- Create: `frontend/app/(app)/[orgSlug]/members/new/page.tsx`

**Interfaces:**
- Consumes: `useAddMember` (Task 1), `addMemberSchema`,
  `AddMemberFormInput` (Task 2), `canManageMembers` (existing).

**Steps:**

- [ ] **Step 1: Add-member page.** `canManageMembers`-gated redirect
  (mirrors `NewEventPage`). RHF + `zodResolver(addMemberSchema)`. Fields:
  email, role (`<select>`, all 9 values), studentId/faculty/programme/
  intake/phone (all `Input`, optional). Top-level error banner surfaces
  `ApiError.message` verbatim (covers 404 "No account for that email", 409
  duplicate, 403 escalation-guard). On success → `router.push('/' +
  org.slug + '/members')`.

```tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addMemberSchema, type AddMemberFormInput } from '@/features/members/schemas';
import { useAddMember } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

const ROLE_OPTIONS: AddMemberFormInput['role'][] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

function Field({
  label, htmlFor, error, children,
}: {
  label: string; htmlFor: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export default function NewMemberPage() {
  const router = useRouter();
  const { org, membership } = useOrg();
  const canAdd = canManageMembers(membership.role);
  const addMember = useAddMember(org.id);

  useEffect(() => {
    if (!canAdd) router.replace(`/${org.slug}/members`);
  }, [canAdd, router, org.slug]);
  if (!canAdd) return null;

  const form = useForm<AddMemberFormInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      email: '', role: 'PARTICIPANT', studentId: '', faculty: '', programme: '', intake: '', phone: '',
    },
  });
  const errors = form.formState.errors;

  const topError =
    addMember.error instanceof ApiError
      ? addMember.error.message
      : addMember.error
        ? 'Something went wrong — please try again'
        : null;

  const onSubmit = form.handleSubmit((values) => {
    addMember.mutate(values, { onSuccess: () => router.push(`/${org.slug}/members`) });
  });

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Add member</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {topError && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {topError}
          </p>
        )}
        <Field label="Email" htmlFor="email" error={errors.email?.message}>
          <Input id="email" type="email" placeholder="member@example.com" {...form.register('email')} />
        </Field>
        <Field label="Role" htmlFor="role" error={errors.role?.message}>
          <select
            id="role"
            {...form.register('role')}
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student ID" htmlFor="studentId">
            <Input id="studentId" placeholder="Optional" {...form.register('studentId')} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" placeholder="Optional" {...form.register('phone')} />
          </Field>
          <Field label="Faculty" htmlFor="faculty">
            <Input id="faculty" placeholder="Optional" {...form.register('faculty')} />
          </Field>
          <Field label="Programme" htmlFor="programme">
            <Input id="programme" placeholder="Optional" {...form.register('programme')} />
          </Field>
          <Field label="Intake" htmlFor="intake">
            <Input id="intake" placeholder="Optional" {...form.register('intake')} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={addMember.isPending}>
            {addMember.isPending && <Loader2 className="size-4 animate-spin" />}
            Add member
          </Button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/members/new"
git commit -m "feat(frontend): add member page"
```

---

### Task 6: Member detail page + change-role dialog

**Files:**
- Create: `frontend/components/members/change-role-dialog.tsx`
- Create: `frontend/app/(app)/[orgSlug]/members/[membershipId]/page.tsx`

**Interfaces:**
- Consumes: `useMembers`, `useChangeRole`, `useRemoveMember` (Task 1),
  `MemberRoleBadge`, `MemberStatusBadge`, `MemberNotFound` (Task 3),
  `canManageMembers`, `canManageRoles` (existing/Task 1).
- Produces: `ChangeRoleDialog({ orgId, member, open, onOpenChange })` —
  used only by this task's detail page.

**Steps:**

- [ ] **Step 1: `ChangeRoleDialog`.** Select (defaults to the member's
  current role) + `Dialog` confirm, louder wording for PRESIDENT/
  VICE_PRESIDENT targets:

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
import { useChangeRole } from '@/features/members/use-members';
import { ApiError } from '@/lib/api';
import type { Member, MembershipRole } from '@/types/api';

const ROLE_OPTIONS: MembershipRole[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR',
  'COMMITTEE', 'VOLUNTEER', 'PARTICIPANT', 'ADVISOR',
];

interface ChangeRoleDialogProps {
  orgId: string;
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangeRoleDialog({ orgId, member, open, onOpenChange }: ChangeRoleDialogProps) {
  const changeRole = useChangeRole(orgId, member.id);
  const [nextRole, setNextRole] = useState<MembershipRole>(member.role);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const escalates = nextRole === 'PRESIDENT' || nextRole === 'VICE_PRESIDENT';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setConfirming(false);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>
            Current role: {member.role.replace('_', ' ')}.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        {!confirming ? (
          <>
            <select
              value={nextRole}
              onChange={(e) => setNextRole(e.target.value as MembershipRole)}
              aria-label="New role"
              className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={nextRole === member.role}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm">
              {escalates
                ? `This will give ${member.user.fullName} full org control as ${nextRole.replace('_', ' ')}.`
                : `Change ${member.user.fullName}'s role to ${nextRole.replace('_', ' ')}?`}
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Back
              </Button>
              <Button
                disabled={changeRole.isPending}
                onClick={() => {
                  setError(null);
                  changeRole.mutate(nextRole, {
                    onSuccess: () => onOpenChange(false),
                    onError: (e) => {
                      setConfirming(false);
                      setError(e instanceof ApiError ? e.message : 'Something went wrong');
                    },
                  });
                }}
              >
                {changeRole.isPending && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Member detail page.** No `GET /:id` — read from
  `useMembers(org.id, {})` (unfiltered) and `.find(m => m.id ===
  membershipId)`. Pending → skeleton. Loaded + no match → `MemberNotFound`.
  Shows profile fields (blank ones omitted), `committeeHistory` as a
  read-only list, and gated actions: Edit link (`canManageMembers`) →
  `/members/:id/edit`; "Change role" button (`canManageRoles`) opens
  `ChangeRoleDialog`; "Remove" button (`canManageRoles`) → `Dialog` confirm
  → `useRemoveMember` → redirect to `/members` on success, inline error
  (dialog stays open) on the 409 last-president guardrail.

```tsx
'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberRoleBadge } from '@/components/members/member-role-badge';
import { MemberStatusBadge } from '@/components/members/member-status-badge';
import { MemberNotFound } from '@/components/members/member-not-found';
import { ChangeRoleDialog } from '@/components/members/change-role-dialog';
import { useMembers, useRemoveMember } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers, canManageRoles } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

const PROFILE_FIELDS = [
  ['studentId', 'Student ID'],
  ['faculty', 'Faculty'],
  ['programme', 'Programme'],
  ['intake', 'Intake'],
  ['phone', 'Phone'],
] as const;

export default function MemberDetailPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const { membershipId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const members = useMembers(org.id, {});
  const remove = useRemoveMember(org.id);

  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  if (members.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  const member = members.data?.find((m) => m.id === membershipId);
  if (!member) return <MemberNotFound />;

  const canEdit = canManageMembers(membership.role);
  const canManageThisRole = canManageRoles(membership.role);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/members`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All members
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{member.user.fullName}</h1>
          <MemberRoleBadge role={member.role} />
          <MemberStatusBadge status={member.status} />
        </div>
        {canEdit && (
          <Link
            href={`/${org.slug}/members/${member.id}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      <p className="text-sm text-foreground-muted">{member.user.email}</p>

      <div className="flex flex-col gap-1 text-sm">
        {PROFILE_FIELDS.map(([key, label]) =>
          member[key] ? (
            <span key={key}>
              <span className="text-foreground-muted">{label}:</span> {member[key]}
            </span>
          ) : null,
        )}
      </div>

      {member.committeeHistory.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground-muted">Committee history</h2>
          <ul className="flex flex-col gap-0.5 text-sm text-foreground-muted">
            {member.committeeHistory.map((h, i) => (
              <li key={i}>
                Was {h.role.replace('_', ' ')} until {new Date(h.until).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManageThisRole && (
        <div className="flex flex-col gap-2">
          {removeError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {removeError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setRoleDialogOpen(true)}>
              Change role
            </Button>
            <Button variant="destructive" onClick={() => setConfirmingRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      )}

      <ChangeRoleDialog
        orgId={org.id}
        member={member}
        open={roleDialogOpen}
        onOpenChange={setRoleDialogOpen}
      />

      <Dialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {member.user.fullName}?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingRemove(false)}>
              Keep member
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                setRemoveError(null);
                remove.mutate(member.id, {
                  onSuccess: () => router.push(`/${org.slug}/members`),
                  onError: (e) => {
                    setRemoveError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
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

- [ ] **Step 3: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/members/change-role-dialog.tsx "frontend/app/(app)/[orgSlug]/members/[membershipId]/page.tsx"
git commit -m "feat(frontend): member detail — profile, committee history, role change, remove"
```

---

### Task 7: Edit member page

**Files:**
- Create: `frontend/app/(app)/[orgSlug]/members/[membershipId]/edit/page.tsx`

**Interfaces:**
- Consumes: `useMembers`, `useUpdateMember` (Task 1), `editMemberSchema`,
  `EditMemberFormInput` (Task 2), `MemberNotFound` (Task 3),
  `canManageMembers` (existing).

**Steps:**

- [ ] **Step 1: Edit page.** `canManageMembers`-gated redirect. Same
  find-in-list lookup as the detail page; not found → `MemberNotFound`
  (not a redirect — the id is still in the URL and might resolve once the
  query refetches, e.g. after a slow initial load; same reasoning as the
  detail page, kept consistent rather than redirecting one and not the
  other). Fields: status (`<select>`, ACTIVE/ALUMNI), the five profile
  fields, seeded via `defaultValues` computed once the member is found.
  Submit → `useUpdateMember`. Surfaces the 409 last-president message
  verbatim. On success → `router.push('/' + org.slug + '/members/' +
  membershipId)`.

```tsx
'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { MemberNotFound } from '@/components/members/member-not-found';
import { editMemberSchema, type EditMemberFormInput } from '@/features/members/schemas';
import { useMembers, useUpdateMember } from '@/features/members/use-members';
import { useOrg } from '@/features/orgs/org-provider';
import { canManageMembers } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';

function Field({
  label, htmlFor, children,
}: {
  label: string; htmlFor: string; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export default function EditMemberPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}) {
  const { membershipId } = use(params);
  const router = useRouter();
  const { org, membership } = useOrg();
  const canEdit = canManageMembers(membership.role);

  useEffect(() => {
    if (!canEdit) router.replace(`/${org.slug}/members/${membershipId}`);
  }, [canEdit, router, org.slug, membershipId]);

  const members = useMembers(org.id, {});
  const update = useUpdateMember(org.id, membershipId);

  const form = useForm<EditMemberFormInput>({
    resolver: zodResolver(editMemberSchema),
    defaultValues: { status: 'ACTIVE', studentId: '', faculty: '', programme: '', intake: '', phone: '' },
  });

  const member = members.data?.find((m) => m.id === membershipId);

  useEffect(() => {
    if (member) {
      form.reset({
        status: member.status,
        studentId: member.studentId ?? '',
        faculty: member.faculty ?? '',
        programme: member.programme ?? '',
        intake: member.intake ?? '',
        phone: member.phone ?? '',
      });
    }
  }, [member, form]);

  if (!canEdit) return null;

  if (members.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (!member) return <MemberNotFound />;

  const topError =
    update.error instanceof ApiError
      ? update.error.message
      : update.error
        ? 'Something went wrong — please try again'
        : null;

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(values, {
      onSuccess: () => router.push(`/${org.slug}/members/${membershipId}`),
    });
  });

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Edit {member.user.fullName}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {topError && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {topError}
          </p>
        )}
        <Field label="Status" htmlFor="status">
          <select
            id="status"
            {...form.register('status')}
            className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
          >
            <option value="ACTIVE">Active</option>
            <option value="ALUMNI">Alumni</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Student ID" htmlFor="studentId">
            <Input id="studentId" {...form.register('studentId')} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" {...form.register('phone')} />
          </Field>
          <Field label="Faculty" htmlFor="faculty">
            <Input id="faculty" {...form.register('faculty')} />
          </Field>
          <Field label="Programme" htmlFor="programme">
            <Input id="programme" {...form.register('programme')} />
          </Field>
          <Field label="Intake" htmlFor="intake">
            <Input id="intake" {...form.register('intake')} />
          </Field>
        </div>
        <div>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/members/[membershipId]/edit"
git commit -m "feat(frontend): edit member — profile fields, status"
```

---

### Task 8: Live verification + polish

Not a code task on its own — a checkpoint, same as Slices 1–3's live-driven
tasks. No separate commit unless verification surfaces a real bug (then fix
+ commit as its own small commit, description reflecting the actual bug).

- [ ] **Step 1:** `docker compose up -d` if the stack has stopped. Start
  backend (`npm run start:dev`) and frontend (`npm run dev`) dev servers.
  If port 3000 is held by a stale process, `taskkill //PID <pid> //F`
  before starting (recurring issue this session, not a code bug).
- [ ] **Step 2:** As a PRESIDENT (org creator), register a second account
  via `/register` and note its email — this is the account "added" as a
  member below (the backend requires the email to belong to an existing
  account; there's no user-creation-on-add flow).
- [ ] **Step 3:** Go to `/members`, confirm the org creator is listed as
  President, Active. Click "Add member", add the second account's email
  as VOLUNTEER with a couple of profile fields filled in, confirm redirect
  to the list and the new row appears.
- [ ] **Step 4:** Filter by role=VOLUNTEER, confirm only the new member
  shows; filter by status=ALUMNI, confirm the list goes empty with the
  correct empty-state message; clear filters, search by the new member's
  email substring, confirm it matches.
- [ ] **Step 5:** Open the new member's detail page, confirm profile
  fields render, confirm "Change role" and "Remove" are visible (President
  has MANAGE_ROLES). Change their role to COMMITTEE via the confirm
  dialog, reload, confirm the role badge updated and `committeeHistory`
  gained a "Was Volunteer until ..." entry.
- [ ] **Step 6:** Edit the member's profile (change faculty, mark status
  ALUMNI), confirm redirect back to detail and the change persisted.
  Change status back to ACTIVE (a non-president ALUMNI member has no
  last-president implications, should succeed normally).
- [ ] **Step 7:** As the org creator (sole PRESIDENT), attempt each of the
  three last-president guardrail triggers and confirm the 409 message
  surfaces inline in each case, no crash, no silent failure:
  (a) on `/members/:id/edit` for their own membership, set status to
  ALUMNI, submit — expect the inline error banner;
  (b) on their own detail page, open "Change role", pick a non-president
  role, confirm — expect the inline error, dialog stays open;
  (c) on their own detail page, click "Remove", confirm — expect the
  inline error in the confirm dialog, no redirect.
- [ ] **Step 8:** As a SECRETARY-tier account (promote the second account
  to SECRETARY first via the President's role-change flow, then log in as
  them), attempt to add a new member with role PRESIDENT — confirm the
  403 escalation-guard message surfaces verbatim on `/members/new`.
  Confirm this SECRETARY account does *not* see "Change role"/"Remove" on
  any member's detail page (MANAGE_ROLES-gated, they only have
  MANAGE_MEMBERS).
- [ ] **Step 9:** Remove a non-president member (the SECRETARY test
  account, demoted back to VOLUNTEER first by the President if needed —
  or simply performed by the President, who has both tiers), confirm
  redirect to the list and the row disappears.
- [ ] **Step 10:** Screenshot the members list and a member detail page in
  both light and dark themes (Playwright) — confirm role badges (neutral)
  and status badges (semantic tokens) read correctly in both, and neither
  ever renders with a domain-hue color (Members has none).
- [ ] **Step 11:** Full regression — `npm test` (frontend) and `npm test
  && npm run test:e2e` (backend, confirming this slice touched zero
  backend files) — both must match the pre-slice baseline (frontend
  54+new/54+new all green; backend 101/326 unchanged).

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** update `docs/uiux.md` with a "Slice 4 — Members (shipped)"
section (the three-tier RBAC split, the no-single-fetch-endpoint
constraint and how the detail/edit pages work around it, the two type
fixes and why they mattered, the last-president guardrail's three surface
points). Update `docs/current-context.md` (untracked) — mark Slice 4
shipped, note remaining candidate slices (Attendance/QR check-in is now
the only carved-out-but-unbuilt piece; Certificates, Feedback, Analytics,
Workspace, Settings remain unscoped placeholders).

**Finish branch:** verify frontend `npm test`/`npm run build` and backend
`npm test`/`npm run test:e2e` all green → merge
`feature/frontend-slice4-members` to `main` locally, delete branch. Never
push.
