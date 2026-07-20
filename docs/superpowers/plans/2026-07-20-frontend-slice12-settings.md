# Frontend Slice 12 (Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Settings page — the last unscoped nav placeholder — covering org profile/branding (committee-gated, two RBAC tiers) and My Account PDPA actions (export data, consent history, delete account — every member, no gate).

**Architecture:** `/settings` becomes a local-state tabbed page (same pattern as `/workspace`). Organization tab renders only for committee members; My Account tab always renders. No new backend endpoints — everything already exists and is exercised via `api`/`apiUpload` from `frontend/lib/api.ts`.

**Tech Stack:** Next.js App Router, TanStack Query, React Hook Form + Zod, Vitest.

## Global Constraints

- Frontend test baseline going in: **126/126** (Vitest). Backend baseline: **101/101** unit (untouched this slice — no backend files should need to change).
- Backend DTOs this slice's schemas must mirror exactly:
  - `UpdateOrganizationDto` (`backend/src/organizations/dto/update-organization.dto.ts`): `name?` (2-120 chars), `description?` (max 2000 chars), `socialLinks?: Record<string,string>`, `advisors?: string[]`.
  - `UpdateOrganizationSettingsDto` (`backend/src/organizations/dto/update-organization-settings.dto.ts`): `primaryColor?`/`secondaryColor?`, each `/^#([0-9a-fA-F]{6})$/`.
  - Branding image limits (`backend/src/organizations/organizations.service.ts`): MIME `image/png|jpeg|webp`, max 2MB (`2 * 1024 * 1024` bytes).
- RBAC tiers (verified against `backend/src/organizations/organizations.controller.ts`):
  - Profile edit + logo/banner upload/delete: `PRESIDENT`, `VICE_PRESIDENT`.
  - Colors: `PRESIDENT` only.
  - Organization tab visibility (not a backend gate, a frontend display choice): committee (`isCommittee`), consistent with the sidebar nav.
  - My Account tab: no gate, every authenticated user.
- One commit per task. Pause before Task 1 (after branch creation), pause before Task 12 (live verification), pause before docs-sync. Always merge-to-main on finish, no push.

---

### Task 1: Organization type fields + org-management role tiers

**Files:**
- Modify: `frontend/types/api.ts:32-41` (the `Organization` interface)
- Modify: `frontend/features/orgs/roles.ts`
- Test: `frontend/features/orgs/__tests__/roles.test.ts`

**Interfaces:**
- Produces: `Organization.socialLinks: Record<string,string> | null`, `Organization.advisors: string[] | null`; `canManageOrgProfile(role: MembershipRole): boolean`; `canManageOrgColors(role: MembershipRole): boolean`.

- [ ] **Step 1: Add the two missing fields to `Organization`**

In `frontend/types/api.ts`, the `Organization` interface currently ends:

```typescript
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
}
```

Replace it with:

```typescript
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  socialLinks: Record<string, string> | null;
  advisors: string[] | null;
}
```

- [ ] **Step 2: Write the failing role-tier tests**

Append to `frontend/features/orgs/__tests__/roles.test.ts` (it already imports `describe`/`expect`/`it`/`MembershipRole` and defines `ALL` — reuse those):

```typescript
describe('canManageOrgProfile', () => {
  it('is true only for PRESIDENT and VICE_PRESIDENT', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: true, SECRETARY: false, TREASURER: false,
      EVENT_DIRECTOR: false, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageOrgProfile(role)).toBe(expected[role]);
  });
});

describe('canManageOrgColors', () => {
  it('is true only for PRESIDENT', () => {
    const expected: Record<MembershipRole, boolean> = {
      PRESIDENT: true, VICE_PRESIDENT: false, SECRETARY: false, TREASURER: false,
      EVENT_DIRECTOR: false, COMMITTEE: false, VOLUNTEER: false, PARTICIPANT: false,
      ADVISOR: false,
    };
    for (const role of ALL) expect(canManageOrgColors(role)).toBe(expected[role]);
  });
});
```

Add `canManageOrgProfile, canManageOrgColors` to the existing import line at the top of the test file.

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run features/orgs/__tests__/roles.test.ts`
Expected: FAIL — `canManageOrgProfile is not defined` / `canManageOrgColors is not defined`.

- [ ] **Step 4: Implement the two role predicates**

Append to `frontend/features/orgs/roles.ts` (after the existing `canManageAttendance` block):

```typescript
// Mirrors backend OrganizationsController's `@Roles('PRESIDENT', 'VICE_PRESIDENT')`
// on profile/logo/banner endpoints — identical role set to MANAGE_ROLES_ROLES
// above, reused rather than duplicated, but named for this feature's own
// call sites so intent stays clear at each usage.
export function canManageOrgProfile(role: MembershipRole): boolean {
  return MANAGE_ROLES_ROLES.includes(role);
}

// Mirrors backend's `@Roles('PRESIDENT')` on PATCH .../settings — one tier
// stricter than canManageOrgProfile.
const ORG_COLORS_ROLES: MembershipRole[] = ['PRESIDENT'];

export function canManageOrgColors(role: MembershipRole): boolean {
  return ORG_COLORS_ROLES.includes(role);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run features/orgs/__tests__/roles.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Typecheck and commit**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors (catches any stray usage of the old `Organization` shape).

```bash
git add frontend/types/api.ts frontend/features/orgs/roles.ts frontend/features/orgs/__tests__/roles.test.ts
git commit -m "feat(frontend): org profile/color role tiers + socialLinks/advisors types"
```

---

### Task 2: Branding image client-side validation

**Files:**
- Create: `frontend/features/orgs/validate-branding-image.ts`
- Test: `frontend/features/orgs/__tests__/validate-branding-image.test.ts`

**Interfaces:**
- Produces: `validateBrandingImage(file: File): string | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { expect, it } from 'vitest';
import { validateBrandingImage } from '@/features/orgs/validate-branding-image';

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test', { type });
}

it('accepts a valid PNG under the size limit', () => {
  expect(validateBrandingImage(makeFile('image/png', 1024))).toBeNull();
});

it('accepts JPEG and WebP', () => {
  expect(validateBrandingImage(makeFile('image/jpeg', 1024))).toBeNull();
  expect(validateBrandingImage(makeFile('image/webp', 1024))).toBeNull();
});

it('rejects an unsupported MIME type', () => {
  expect(validateBrandingImage(makeFile('image/gif', 1024))).toBe('Only PNG, JPEG, or WebP images are accepted');
});

it('rejects a file over 2MB', () => {
  expect(validateBrandingImage(makeFile('image/png', 2 * 1024 * 1024 + 1))).toBe('File exceeds the 2MB limit');
});
```

Save as `frontend/features/orgs/__tests__/validate-branding-image.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run features/orgs/__tests__/validate-branding-image.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Mirrors backend/src/organizations/organizations.service.ts's own
// ALLOWED_IMAGE_MIME/MAX_IMAGE_BYTES as a fast-fail UX check; the backend
// re-validates both regardless.
export function validateBrandingImage(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Only PNG, JPEG, or WebP images are accepted';
  if (file.size > MAX_IMAGE_BYTES) return 'File exceeds the 2MB limit';
  return null;
}
```

Save as `frontend/features/orgs/validate-branding-image.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run features/orgs/__tests__/validate-branding-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/features/orgs/validate-branding-image.ts frontend/features/orgs/__tests__/validate-branding-image.test.ts
git commit -m "feat(frontend): branding image validation helper"
```

---

### Task 3: Org profile and color form schemas

**Files:**
- Create: `frontend/features/orgs/profile-schema.ts`
- Create: `frontend/features/orgs/color-schema.ts`
- Test: `frontend/features/orgs/__tests__/profile-schema.test.ts`
- Test: `frontend/features/orgs/__tests__/color-schema.test.ts`

**Interfaces:**
- Produces: `orgProfileSchema`, `type OrgProfileFormValues = { name: string; description: string; socialLinks: { key: string; value: string }[]; advisors: { name: string }[] }`; `orgColorSchema`, `type OrgColorFormValues = { primaryColor: string; secondaryColor: string }`.

- [ ] **Step 1: Write the failing profile-schema tests**

```typescript
import { expect, it } from 'vitest';
import { orgProfileSchema } from '@/features/orgs/profile-schema';

const base = {
  name: 'Chess Club',
  description: 'We play chess.',
  socialLinks: [{ key: 'instagram', value: 'https://instagram.com/chessclub' }],
  advisors: [{ name: 'Dr. Tan' }],
};

it('accepts a valid submission', () => {
  expect(orgProfileSchema.safeParse(base).success).toBe(true);
});

it('accepts empty socialLinks and advisors arrays', () => {
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [], advisors: [] }).success).toBe(true);
});

it('rejects a name under 2 characters', () => {
  expect(orgProfileSchema.safeParse({ ...base, name: 'A' }).success).toBe(false);
});

it('rejects a description over 2000 characters', () => {
  expect(orgProfileSchema.safeParse({ ...base, description: 'x'.repeat(2001) }).success).toBe(false);
});

it('rejects a socialLinks row with an empty key or value', () => {
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [{ key: '', value: 'x' }] }).success).toBe(false);
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [{ key: 'x', value: '' }] }).success).toBe(false);
});

it('rejects an advisors row with an empty name', () => {
  expect(orgProfileSchema.safeParse({ ...base, advisors: [{ name: '' }] }).success).toBe(false);
});
```

Save as `frontend/features/orgs/__tests__/profile-schema.test.ts`.

- [ ] **Step 2: Write the failing color-schema tests**

```typescript
import { expect, it } from 'vitest';
import { orgColorSchema } from '@/features/orgs/color-schema';

it('accepts valid 6-digit hex colors', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '#2563eb', secondaryColor: '#1e293b' }).success).toBe(true);
});

it('rejects a color missing the #', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '2563eb', secondaryColor: '#1e293b' }).success).toBe(false);
});

it('rejects a 3-digit shorthand hex', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '#fff', secondaryColor: '#1e293b' }).success).toBe(false);
});

it('rejects a non-hex string', () => {
  expect(orgColorSchema.safeParse({ primaryColor: 'blue', secondaryColor: '#1e293b' }).success).toBe(false);
});
```

Save as `frontend/features/orgs/__tests__/color-schema.test.ts`.

- [ ] **Step 3: Run both to verify they fail**

Run: `cd frontend && npx vitest run features/orgs/__tests__/profile-schema.test.ts features/orgs/__tests__/color-schema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `orgProfileSchema`**

```typescript
import { z } from 'zod';

// Mirrors backend UpdateOrganizationDto. socialLinks/advisors are edited as
// arrays here (repeatable form rows) and mapped back to
// Record<string,string> / string[] at submit time — the backend shape is
// free-form, so no fixed platform list or advisor-title field is invented.
export const orgProfileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120, 'Name must be at most 120 characters'),
  description: z.string().max(2000, 'Description must be at most 2000 characters'),
  socialLinks: z.array(
    z.object({
      key: z.string().min(1, 'Platform is required'),
      value: z.string().min(1, 'URL is required'),
    }),
  ),
  advisors: z.array(
    z.object({
      name: z.string().min(1, 'Name is required'),
    }),
  ),
});

export type OrgProfileFormValues = z.infer<typeof orgProfileSchema>;
```

Save as `frontend/features/orgs/profile-schema.ts`.

- [ ] **Step 5: Implement `orgColorSchema`**

```typescript
import { z } from 'zod';

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

// Mirrors backend UpdateOrganizationSettingsDto's @Matches pattern exactly.
export const orgColorSchema = z.object({
  primaryColor: z.string().regex(HEX_COLOR, 'Must be a hex color like #2563eb'),
  secondaryColor: z.string().regex(HEX_COLOR, 'Must be a hex color like #1e293b'),
});

export type OrgColorFormValues = z.infer<typeof orgColorSchema>;
```

Save as `frontend/features/orgs/color-schema.ts`.

- [ ] **Step 6: Run both to verify they pass**

Run: `cd frontend && npx vitest run features/orgs/__tests__/profile-schema.test.ts features/orgs/__tests__/color-schema.test.ts`
Expected: PASS (6 + 4 = 10 tests).

- [ ] **Step 7: Commit**

```bash
git add frontend/features/orgs/profile-schema.ts frontend/features/orgs/color-schema.ts frontend/features/orgs/__tests__/profile-schema.test.ts frontend/features/orgs/__tests__/color-schema.test.ts
git commit -m "feat(frontend): org profile and color form schemas"
```

---

### Task 4: Org profile/branding/color data hooks

**Files:**
- Modify: `frontend/features/orgs/use-orgs.ts`

**Interfaces:**
- Consumes: `api`, `apiUpload` from `frontend/lib/api.ts`; `Organization` from `frontend/types/api.ts`.
- Produces: `useUpdateOrgProfile(orgId)`, `useUpdateOrgSettings(orgId)`, `useUploadLogo(orgId)`, `useDeleteLogo(orgId)`, `useUploadBanner(orgId)`, `useDeleteBanner(orgId)` — all `useMutation` results whose `mutate`/`mutateAsync` callers pass the shapes shown below.

No test file for this task — this project's convention is that data-hook files (`use-assets.ts`, `use-minutes.ts`, `use-certificates.ts`) are exercised via their consumers' live verification, not unit-tested directly, since they're thin wrappers over `api`/`apiUpload`.

- [ ] **Step 1: Add `apiUpload` to the existing import and add a shared invalidator**

In `frontend/features/orgs/use-orgs.ts`, change the top import line from:

```typescript
import { api } from '@/lib/api';
```

to:

```typescript
import { api, apiUpload } from '@/lib/api';
```

Then add, after the existing `useCreateOrg` function (end of file):

```typescript
// Branding/profile changes affect both the list (org switcher, sidebar
// theme) and the detail query used by the Settings page — both are kept
// in sync on every mutation.
function useInvalidateOrg(orgId: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['org', orgId] });
    queryClient.invalidateQueries({ queryKey: ['orgs'] });
  };
}

export interface OrgProfileInput {
  name?: string;
  description?: string;
  socialLinks?: Record<string, string>;
  advisors?: string[];
}

export function useUpdateOrgProfile(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (input: OrgProfileInput) =>
      api<Organization>(`/organizations/${orgId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export interface OrgColorsInput {
  primaryColor?: string;
  secondaryColor?: string;
}

export function useUpdateOrgSettings(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (input: OrgColorsInput) =>
      api<Organization>(`/organizations/${orgId}/settings`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useUploadLogo(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<Organization>(`/organizations/${orgId}/logo`, formData),
    onSuccess: invalidate,
  });
}

export function useDeleteLogo(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: () => api<Organization>(`/organizations/${orgId}/logo`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useUploadBanner(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: (formData: FormData) => apiUpload<Organization>(`/organizations/${orgId}/banner`, formData),
    onSuccess: invalidate,
  });
}

export function useDeleteBanner(orgId: string) {
  const invalidate = useInvalidateOrg(orgId);
  return useMutation({
    mutationFn: () => api<Organization>(`/organizations/${orgId}/banner`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full frontend suite to confirm nothing else broke**

Run: `cd frontend && npm test -- --run`
Expected: 126/126 still passing (this task adds no new tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/features/orgs/use-orgs.ts
git commit -m "feat(frontend): org profile/branding/color mutation hooks"
```

---

### Task 5: SocialLinksFields + AdvisorsFields

**Files:**
- Create: `frontend/components/orgs/social-links-fields.tsx`
- Create: `frontend/components/orgs/advisors-fields.tsx`

**Interfaces:**
- Consumes: `Control`/`useFieldArray` from `react-hook-form`; `OrgProfileFormValues` from `frontend/features/orgs/profile-schema.ts`.
- Produces: `<SocialLinksFields control={form.control} errors={form.formState.errors} />`, `<AdvisorsFields control={form.control} errors={form.formState.errors} />` — both presentational, mounted only inside the profile form built in Task 6.

No dedicated component test — this project's convention (established since Slice 2) is that presentational form-row editors are verified via the live-verification task, not RTL, except where a piece of logic is pulled into a plain function (already covered by Tasks 2-3's schema/validator tests).

- [ ] **Step 1: Implement `SocialLinksFields`**

Uses `useFormContext` (not a `control` prop) so it can call `register` directly — the parent form (Task 6) wraps its `<form>` in RHF's `<FormProvider {...form}>`, which is what makes this context available.

```tsx
'use client';

import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OrgProfileFormValues } from '@/features/orgs/profile-schema';

export function SocialLinksFields({ errors }: { errors: FieldErrors<OrgProfileFormValues> }) {
  const { control, register } = useFormContext<OrgProfileFormValues>();
  const links = useFieldArray({ control, name: 'socialLinks' });

  return (
    <div className="flex flex-col gap-2">
      <Label>Social links</Label>
      {links.fields.map((f, index) => (
        <div key={f.id} className="flex items-start gap-2">
          <Input placeholder="Platform (e.g. instagram)" className="w-40" {...register(`socialLinks.${index}.key`)} />
          <Input placeholder="URL" className="flex-1" {...register(`socialLinks.${index}.value`)} />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => links.remove(index)} aria-label="Remove social link">
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {errors.socialLinks && (
        <p className="text-sm text-danger">Each social link needs a platform and a URL.</p>
      )}
      <Button type="button" variant="secondary" className="w-fit" onClick={() => links.append({ key: '', value: '' })}>
        <Plus className="size-4" />
        Add social link
      </Button>
    </div>
  );
}
```

Save as `frontend/components/orgs/social-links-fields.tsx`. This requires the parent form (Task 6) to wrap its `<form>` in RHF's `<FormProvider {...form}>` so `useFormContext` resolves — Task 6 does this.

- [ ] **Step 2: Implement `AdvisorsFields`**

```tsx
'use client';

import { useFieldArray, useFormContext, type FieldErrors } from 'react-hook-form';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { OrgProfileFormValues } from '@/features/orgs/profile-schema';

export function AdvisorsFields({ errors }: { errors: FieldErrors<OrgProfileFormValues> }) {
  const { control, register } = useFormContext<OrgProfileFormValues>();
  const advisors = useFieldArray({ control, name: 'advisors' });

  return (
    <div className="flex flex-col gap-2">
      <Label>Advisors</Label>
      {advisors.fields.map((f, index) => (
        <div key={f.id} className="flex items-start gap-2">
          <Input placeholder="Advisor name" className="flex-1" {...register(`advisors.${index}.name`)} />
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => advisors.remove(index)} aria-label="Remove advisor">
            <X className="size-4" />
          </Button>
        </div>
      ))}
      {errors.advisors && <p className="text-sm text-danger">Each advisor needs a name.</p>}
      <Button type="button" variant="secondary" className="w-fit" onClick={() => advisors.append({ name: '' })}>
        <Plus className="size-4" />
        Add advisor
      </Button>
    </div>
  );
}
```

Save as `frontend/components/orgs/advisors-fields.tsx`.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors about unused `control`/missing `FormProvider` context are fine to see now — Task 6 supplies the provider. If `tsc` reports a type error unrelated to the missing provider (e.g. a genuine prop mismatch), fix it before continuing; `useFormContext` itself typechecks standalone regardless of runtime provider presence.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/orgs/social-links-fields.tsx frontend/components/orgs/advisors-fields.tsx
git commit -m "feat(frontend): social links and advisors field-array editors"
```

---

### Task 6: OrganizationProfileForm

**Files:**
- Create: `frontend/components/orgs/organization-profile-form.tsx`

**Interfaces:**
- Consumes: `SocialLinksFields`, `AdvisorsFields` (Task 5); `orgProfileSchema`, `OrgProfileFormValues` (Task 3); `useUpdateOrgProfile`, `OrgProfileInput` (Task 4); `canManageOrgProfile` (Task 1).
- Produces: `<OrganizationProfileForm orgId={org.id} org={org} canManage={canManageOrgProfile(membership.role)} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SocialLinksFields } from '@/components/orgs/social-links-fields';
import { AdvisorsFields } from '@/components/orgs/advisors-fields';
import { orgProfileSchema, type OrgProfileFormValues } from '@/features/orgs/profile-schema';
import { useUpdateOrgProfile } from '@/features/orgs/use-orgs';
import { ApiError } from '@/lib/api';
import type { Organization } from '@/types/api';

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

export function OrganizationProfileForm({
  orgId,
  org,
  canManage,
}: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  const update = useUpdateOrgProfile(orgId);
  const form = useForm<OrgProfileFormValues>({
    resolver: zodResolver(orgProfileSchema),
    defaultValues: {
      name: org.name,
      description: org.description ?? '',
      socialLinks: Object.entries(org.socialLinks ?? {}).map(([key, value]) => ({ key, value })),
      advisors: (org.advisors ?? []).map((name) => ({ name })),
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    update.mutate({
      name: values.name,
      description: values.description,
      socialLinks: Object.fromEntries(values.socialLinks.map((l) => [l.key, l.value])),
      advisors: values.advisors.map((a) => a.name),
    });
  });

  if (!canManage) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{org.name}</p>
        <p className="text-sm text-foreground-muted">{org.description || 'No description yet.'}</p>
        <p className="text-xs text-foreground-subtle">Only the President or Vice President can edit organization details.</p>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {update.error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {update.error instanceof ApiError ? update.error.message : 'Something went wrong'}
          </p>
        )}
        {update.isSuccess && (
          <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">Saved.</p>
        )}

        <Field label="Name" htmlFor="org-name" error={errors.name?.message}>
          <Input id="org-name" {...form.register('name')} />
        </Field>
        <Field label="Description" htmlFor="org-description" error={errors.description?.message}>
          <Textarea id="org-description" rows={4} {...form.register('description')} />
        </Field>

        <SocialLinksFields errors={errors} />
        <AdvisorsFields errors={errors} />

        <Button type="submit" disabled={update.isPending} className="w-fit">
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          Save profile
        </Button>
      </form>
    </FormProvider>
  );
}
```

Save as `frontend/components/orgs/organization-profile-form.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors — `FormProvider` now supplies the context `SocialLinksFields`/`AdvisorsFields` need.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/orgs/organization-profile-form.tsx
git commit -m "feat(frontend): OrganizationProfileForm"
```

---

### Task 7: BrandingPanel (logo/banner upload + remove)

**Files:**
- Create: `frontend/components/orgs/branding-panel.tsx`

**Interfaces:**
- Consumes: `useUploadLogo`/`useDeleteLogo`/`useUploadBanner`/`useDeleteBanner` (Task 4); `validateBrandingImage` (Task 2).
- Produces: `<BrandingPanel orgId={org.id} org={org} canManage={canManageOrgProfile(membership.role)} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useDeleteBanner,
  useDeleteLogo,
  useUploadBanner,
  useUploadLogo,
} from '@/features/orgs/use-orgs';
import { validateBrandingImage } from '@/features/orgs/validate-branding-image';
import { ApiError } from '@/lib/api';
import type { Organization } from '@/types/api';

function BrandingSlot({
  label,
  imageUrl,
  onUpload,
  onRemove,
  isUploading,
  isRemoving,
}: {
  label: string;
  imageUrl: string | null | undefined;
  onUpload: (file: File) => void;
  onRemove: () => void;
  isUploading: boolean;
  isRemoving: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-foreground-subtle" />
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label={`${label} file`}
        className="text-sm"
        onChange={() => setError(null)}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isUploading}
          onClick={() => {
            const file = inputRef.current?.files?.[0];
            if (!file) return;
            const validationError = validateBrandingImage(file);
            if (validationError) {
              setError(validationError);
              return;
            }
            onUpload(file);
          }}
        >
          {isUploading && <Loader2 className="size-4 animate-spin" />}
          Upload
        </Button>
        {imageUrl && (
          <Button type="button" variant="destructive" size="sm" disabled={isRemoving} onClick={onRemove}>
            {isRemoving && <Loader2 className="size-4 animate-spin" />}
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function BrandingPanel({
  orgId,
  org,
  canManage,
}: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  const uploadLogo = useUploadLogo(orgId);
  const deleteLogo = useDeleteLogo(orgId);
  const uploadBanner = useUploadBanner(orgId);
  const deleteBanner = useDeleteBanner(orgId);

  if (!canManage) {
    return (
      <div className="flex flex-wrap gap-6">
        <BrandingPreviewOnly label="Logo" imageUrl={org.logoUrl} />
        <BrandingPreviewOnly label="Banner" imageUrl={org.bannerUrl} />
      </div>
    );
  }

  const mutationError = uploadLogo.error ?? deleteLogo.error ?? uploadBanner.error ?? deleteBanner.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        <BrandingSlot
          label="Logo"
          imageUrl={org.logoUrl}
          onUpload={(file) => {
            const formData = new FormData();
            formData.set('file', file);
            uploadLogo.mutate(formData);
          }}
          onRemove={() => deleteLogo.mutate()}
          isUploading={uploadLogo.isPending}
          isRemoving={deleteLogo.isPending}
        />
        <BrandingSlot
          label="Banner"
          imageUrl={org.bannerUrl}
          onUpload={(file) => {
            const formData = new FormData();
            formData.set('file', file);
            uploadBanner.mutate(formData);
          }}
          onRemove={() => deleteBanner.mutate()}
          isUploading={uploadBanner.isPending}
          isRemoving={deleteBanner.isPending}
        />
      </div>
      {mutationError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {mutationError instanceof ApiError ? mutationError.message : 'Something went wrong'}
        </p>
      )}
    </div>
  );
}

function BrandingPreviewOnly({ label, imageUrl }: { label: string; imageUrl: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed MinIO URL, next/image adds nothing here
          <img src={imageUrl} alt={label} className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="size-6 text-foreground-subtle" />
        )}
      </div>
    </div>
  );
}
```

Save as `frontend/components/orgs/branding-panel.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/orgs/branding-panel.tsx
git commit -m "feat(frontend): BrandingPanel (logo/banner upload+remove)"
```

---

### Task 8: ColorFields + OrgColorForm

**Files:**
- Create: `frontend/components/orgs/org-color-form.tsx`

**Interfaces:**
- Consumes: `orgColorSchema`, `OrgColorFormValues` (Task 3); `useUpdateOrgSettings` (Task 4).
- Produces: `<OrgColorForm orgId={org.id} org={org} canManage={canManageOrgColors(membership.role)} />`.

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { orgColorSchema, type OrgColorFormValues } from '@/features/orgs/color-schema';
import { useUpdateOrgSettings } from '@/features/orgs/use-orgs';
import { ApiError } from '@/lib/api';
import type { Organization } from '@/types/api';

export function OrgColorForm({
  orgId,
  org,
  canManage,
}: {
  orgId: string;
  org: Organization;
  canManage: boolean;
}) {
  const update = useUpdateOrgSettings(orgId);
  const form = useForm<OrgColorFormValues>({
    resolver: zodResolver(orgColorSchema),
    defaultValues: {
      primaryColor: org.primaryColor ?? '#2563eb',
      secondaryColor: org.secondaryColor ?? '#1e293b',
    },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => update.mutate(values));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {update.error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {update.error instanceof ApiError ? update.error.message : 'Something went wrong'}
        </p>
      )}
      {update.isSuccess && (
        <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">Saved.</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-primary-color">Primary color</Label>
        <Input id="org-primary-color" disabled={!canManage} {...form.register('primaryColor')} />
        {errors.primaryColor && <p className="text-sm text-danger">{errors.primaryColor.message}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="org-secondary-color">Secondary color</Label>
        <Input id="org-secondary-color" disabled={!canManage} {...form.register('secondaryColor')} />
        {errors.secondaryColor && <p className="text-sm text-danger">{errors.secondaryColor.message}</p>}
      </div>
      {!canManage && (
        <p className="text-xs text-foreground-subtle">Only the President can change organization colors.</p>
      )}

      {canManage && (
        <Button type="submit" disabled={update.isPending} className="w-fit">
          {update.isPending && <Loader2 className="size-4 animate-spin" />}
          Save colors
        </Button>
      )}
    </form>
  );
}
```

Save as `frontend/components/orgs/org-color-form.tsx`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/orgs/org-color-form.tsx
git commit -m "feat(frontend): OrgColorForm with President-only gating"
```

---

### Task 9: PDPA data layer

**Files:**
- Create: `frontend/features/pdpa/use-pdpa.ts`
- Create: `frontend/features/pdpa/confirm-text.ts`
- Test: `frontend/features/pdpa/__tests__/confirm-text.test.ts`

**Interfaces:**
- Consumes: `api` from `frontend/lib/api.ts`; `ConsentRecordItem` from `frontend/types/api.ts` (already defined).
- Produces: `useConsents()`, `useExportData()`, `useDeleteAccount()`; `DELETE_CONFIRM_TEXT: string`, `isDeleteConfirmed(value: string): boolean`.

- [ ] **Step 1: Write the failing confirm-text test**

```typescript
import { expect, it } from 'vitest';
import { DELETE_CONFIRM_TEXT, isDeleteConfirmed } from '@/features/pdpa/confirm-text';

it('is false for an empty string', () => {
  expect(isDeleteConfirmed('')).toBe(false);
});

it('is false for a near-miss', () => {
  expect(isDeleteConfirmed('delete my account')).toBe(false);
  expect(isDeleteConfirmed('DELETE MY ACCOUNT ')).toBe(false);
});

it('is true only for an exact, case-sensitive match', () => {
  expect(isDeleteConfirmed(DELETE_CONFIRM_TEXT)).toBe(true);
});
```

Save as `frontend/features/pdpa/__tests__/confirm-text.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run features/pdpa/__tests__/confirm-text.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `confirm-text.ts`**

```typescript
export const DELETE_CONFIRM_TEXT = 'DELETE MY ACCOUNT';

export function isDeleteConfirmed(value: string): boolean {
  return value === DELETE_CONFIRM_TEXT;
}
```

Save as `frontend/features/pdpa/confirm-text.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run features/pdpa/__tests__/confirm-text.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `use-pdpa.ts`**

```typescript
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConsentRecordItem } from '@/types/api';

export function useConsents() {
  return useQuery({
    queryKey: ['me', 'consents'],
    queryFn: () => api<ConsentRecordItem[]>('/me/consents'),
  });
}

// The export is a synchronous, non-persisted JSON blob (no signed URL, no
// storage row) — modeled as a mutation (triggered on click, not cached)
// rather than a query.
export function useExportData() {
  return useMutation({
    mutationFn: () => api<Record<string, unknown>>('/me/export'),
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api<void>('/me', { method: 'DELETE' }),
  });
}
```

Save as `frontend/features/pdpa/use-pdpa.ts`.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/features/pdpa/use-pdpa.ts frontend/features/pdpa/confirm-text.ts frontend/features/pdpa/__tests__/confirm-text.test.ts
git commit -m "feat(frontend): PDPA data layer (consents, export, delete account)"
```

---

### Task 10: My Account components

**Files:**
- Create: `frontend/components/account/consent-history.tsx`
- Create: `frontend/components/account/export-data-button.tsx`
- Create: `frontend/components/account/delete-account-dialog.tsx`

**Interfaces:**
- Consumes: `useConsents`, `useExportData`, `useDeleteAccount` (Task 9); `DELETE_CONFIRM_TEXT`, `isDeleteConfirmed` (Task 9); `useAuthStore` from `frontend/features/auth/auth-store.ts`.
- Produces: `<ConsentHistory />`, `<ExportDataButton />`, `<DeleteAccountDialog open={boolean} onOpenChange={(open: boolean) => void} />`.

- [ ] **Step 1: Implement `ConsentHistory`**

```tsx
'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useConsents } from '@/features/pdpa/use-pdpa';

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ConsentHistory() {
  const consents = useConsents();

  if (consents.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (consents.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load consent history.</p>;
  }
  if (consents.data.length === 0) {
    return <p className="text-sm text-foreground-muted">No consent records yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {consents.data.map((c) => (
        <li
          key={c.id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <span className="capitalize">{c.purpose}</span>
          <span className="text-foreground-muted">
            Policy {c.policyVersion} · {dateFmt.format(new Date(c.grantedAt))}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

Save as `frontend/components/account/consent-history.tsx`.

- [ ] **Step 2: Implement `ExportDataButton`**

```tsx
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExportData } from '@/features/pdpa/use-pdpa';
import { ApiError } from '@/lib/api';

export function ExportDataButton() {
  const exportData = useExportData();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    exportData.mutate(undefined, {
      onSuccess: (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `my-data-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={handleClick} disabled={exportData.isPending} className="w-fit">
        {exportData.isPending && <Loader2 className="size-4 animate-spin" />}
        Export my data
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
```

Save as `frontend/components/account/export-data-button.tsx`.

- [ ] **Step 3: Implement `DeleteAccountDialog`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteAccount } from '@/features/pdpa/use-pdpa';
import { DELETE_CONFIRM_TEXT, isDeleteConfirmed } from '@/features/pdpa/confirm-text';
import { useAuthStore } from '@/features/auth/auth-store';
import { ApiError } from '@/lib/api';

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  const deleteAccount = useDeleteAccount();
  const [confirmText, setConfirmText] = useState('');

  const close = (next: boolean) => {
    if (!next) setConfirmText('');
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This permanently anonymizes your account and signs you out of every organization.
            It can&apos;t be undone. Type <strong>{DELETE_CONFIRM_TEXT}</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          aria-label="Confirmation text"
        />
        {deleteAccount.error && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {deleteAccount.error instanceof ApiError ? deleteAccount.error.message : 'Something went wrong'}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!isDeleteConfirmed(confirmText) || deleteAccount.isPending}
            onClick={() => {
              deleteAccount.mutate(undefined, {
                onSuccess: () => {
                  clearSession();
                  router.replace('/login');
                },
              });
            }}
          >
            {deleteAccount.isPending && <Loader2 className="size-4 animate-spin" />}
            Delete account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Save as `frontend/components/account/delete-account-dialog.tsx`.

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/account/consent-history.tsx frontend/components/account/export-data-button.tsx frontend/components/account/delete-account-dialog.tsx
git commit -m "feat(frontend): My Account components (consent history, export, delete)"
```

---

### Task 11: Settings page wiring

**Files:**
- Create: `frontend/components/orgs/organization-tab.tsx`
- Create: `frontend/components/account/my-account-tab.tsx`
- Modify: `frontend/app/(app)/[orgSlug]/settings/page.tsx` (currently the `PlaceholderPage` stub)
- Modify: `frontend/components/shell/nav-items.ts:37`

**Interfaces:**
- Consumes: everything from Tasks 1-10; `useOrg` from `frontend/features/orgs/org-provider.tsx`; `useOrgDetail` from `frontend/features/orgs/use-orgs.ts` (already existed before this plan).
- Produces: the real `/settings` page, replacing the `PlaceholderPage` stub.

- [ ] **Step 1: Change the nav item's tier**

In `frontend/components/shell/nav-items.ts:37`, change:

```typescript
  { label: 'Settings', segment: 'settings', icon: Settings, minTier: 'committee' },
```

to:

```typescript
  { label: 'Settings', segment: 'settings', icon: Settings, minTier: 'member' },
```

- [ ] **Step 2: Implement `OrganizationTab`**

```tsx
'use client';

import { OrganizationProfileForm } from '@/components/orgs/organization-profile-form';
import { BrandingPanel } from '@/components/orgs/branding-panel';
import { OrgColorForm } from '@/components/orgs/org-color-form';
import { useOrgDetail } from '@/features/orgs/use-orgs';
import { canManageOrgColors, canManageOrgProfile } from '@/features/orgs/roles';
import type { MembershipRole } from '@/types/api';

export function OrganizationTab({ orgId, role }: { orgId: string; role: MembershipRole }) {
  const org = useOrgDetail(orgId);

  if (org.isPending) return null;
  if (org.isError || !org.data) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load organization details.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Profile</h2>
        <OrganizationProfileForm orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Branding</h2>
        <BrandingPanel orgId={orgId} org={org.data} canManage={canManageOrgProfile(role)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Colors</h2>
        <OrgColorForm orgId={orgId} org={org.data} canManage={canManageOrgColors(role)} />
      </section>
    </div>
  );
}
```

Save as `frontend/components/orgs/organization-tab.tsx`.

- [ ] **Step 3: Implement `MyAccountTab`**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConsentHistory } from '@/components/account/consent-history';
import { ExportDataButton } from '@/components/account/export-data-button';
import { DeleteAccountDialog } from '@/components/account/delete-account-dialog';

export function MyAccountTab() {
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Consent history</h2>
        <ConsentHistory />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Export your data</h2>
        <p className="text-sm text-foreground-muted">
          Download a copy of everything associated with your account, across every organization.
        </p>
        <ExportDataButton />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Delete account</h2>
        <p className="text-sm text-foreground-muted">
          Permanently anonymize your account. This can&apos;t be undone.
        </p>
        <Button type="button" variant="destructive" className="w-fit" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </section>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
```

Save as `frontend/components/account/my-account-tab.tsx`.

- [ ] **Step 4: Wire the page**

Replace the entire contents of `frontend/app/(app)/[orgSlug]/settings/page.tsx` (currently just the `PlaceholderPage` stub) with:

```tsx
'use client';

import { useState } from 'react';
import { OrganizationTab } from '@/components/orgs/organization-tab';
import { MyAccountTab } from '@/components/account/my-account-tab';
import { useOrg } from '@/features/orgs/org-provider';
import { isCommittee } from '@/features/orgs/roles';
import { cn } from '@/lib/utils';

type Tab = 'organization' | 'account';

export default function SettingsPage() {
  const { org, membership } = useOrg();
  const committee = isCommittee(membership.role);
  const [tab, setTab] = useState<Tab>(committee ? 'organization' : 'account');

  const tabs: { id: Tab; label: string }[] = committee
    ? [
        { id: 'organization', label: 'Organization' },
        { id: 'account', label: 'My Account' },
      ]
    : [{ id: 'account', label: 'My Account' }];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {tabs.length > 1 && (
        <div className="flex w-fit flex-wrap rounded-md border border-border p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-sm px-3 py-1.5 text-sm font-medium',
                tab === t.id && 'bg-primary/10 text-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'organization' && committee && (
        <OrganizationTab orgId={org.id} role={membership.role} />
      )}
      {tab === 'account' && <MyAccountTab />}
    </main>
  );
}
```

Note: this removes the `PlaceholderPage`/`Settings` icon import that was here before — that's expected, this route is no longer a placeholder.

- [ ] **Step 5: Typecheck and run the full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run`
Expected: no type errors; 126 + 2 (Task 1) + 4 (Task 2) + 10 (Task 3) + 3 (Task 9) = 145/145 passing.

- [ ] **Step 6: Run the production build**

Run: `cd frontend && npm run build`
Expected: clean build, including the `/[orgSlug]/settings` route.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/orgs/organization-tab.tsx frontend/components/account/my-account-tab.tsx frontend/app/\(app\)/\[orgSlug\]/settings/page.tsx frontend/components/shell/nav-items.ts
git commit -m "feat(frontend): Settings page wiring (Organization + My Account tabs)"
```

---

### Task 12: Live verification (PAUSE before starting)

**Do not start this task until the user explicitly says to continue.**

Start the dev stack (`docker compose up -d` in the repo root if the containers aren't already running, then `npm run dev` in `frontend/` and the backend's own dev command if not already running) and drive the real flow with Playwright against a real committee (PRESIDENT) account and a real non-committee (PARTICIPANT) account.

Checklist:
- [ ] As PRESIDENT: open `/settings`, confirm both tabs render, Organization is the default.
- [ ] Edit name + description, add two social links, add one advisor, remove one social link, Save — reload the page, confirm every change persisted.
- [ ] Upload a logo (real PNG), confirm the preview updates; upload a banner (real JPEG); remove the logo, confirm it reverts to the placeholder icon.
- [ ] Attempt uploading a non-image file (e.g. a `.txt` renamed or a real unsupported type) — confirm the client-side validation error shows and no network request fires (check via browser devtools network tab, matching Slice 9's "confirm zero network calls" precedent).
- [ ] Edit both colors as PRESIDENT, Save, reload, confirm persisted; confirm the sidebar/org theme picks up the new primary color (org-provider's brand-contrast logic).
- [ ] Log in as a VICE_PRESIDENT test account (create one via Members if none exists): confirm profile/branding are editable, but the color fields are visibly disabled with the "President only" hint, and submitting is impossible.
- [ ] Switch to My Account as PRESIDENT: confirm consent history shows at least one real row, click "Export my data," confirm a real `.json` file downloads and contains the expected top-level keys (`profile`, `memberships`, `registrations`, `attendance`, `consents`, `certificates`, `exportedAt`).
- [ ] Open the delete-account dialog, confirm the button stays disabled until the exact text is typed, type it, confirm — expect the **409 sole-president block** (since this test account is likely the sole PRESIDENT of at least one org) and confirm the backend's message renders verbatim and the dialog stays open.
- [ ] Log in as a genuinely non-committee PARTICIPANT test account: confirm `/settings` shows only the My Account tab (no Organization tab, no tab switcher at all if it's the only tab), confirm export/consent history/delete-account all still work for them.
- [ ] Screenshot both light and dark themes of the Settings page (Organization tab as PRESIDENT, My Account tab as PARTICIPANT) — confirm no domain-hue leakage, no broken layout, disabled color fields legible in both themes.

Fix anything found (one root-cause fix at a time, per systematic-debugging), commit each fix separately, then report the final test counts before proceeding to docs sync.

---

## After Task 12 (pause before each, per standing preference)

**Docs sync:** append a "Frontend Slice 12 — Settings" section to `docs/current-context.md` (scope, task list with commit hashes, bugs found, test baseline, "what's real" summary, update "Placeholder routes remaining" to none), and a "Slice 12" section to `docs/uiux.md` describing the tab structure, RBAC tiers, and the type-to-confirm delete pattern as a new precedent for any future irreversible/cross-org action.

**Finish branch:** verify tests, merge to `main` locally, delete `feature/frontend-slice12-settings`, per standing preference (never push, never ask).
