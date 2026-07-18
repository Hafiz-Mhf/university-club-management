# Frontend Slice 3 — Registrations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Build the Registrations feature against the live
`RegistrationsController`/`RegistrationFormController`: committee-defined
custom registration forms, self-registration (register/view status/cancel),
and committee registration management (list + reject). No manual "approve"
action exists — approval/waitlisting is automatic by capacity, promotion is
automatic on cancel/reject.

**Spec:** `docs/superpowers/specs/2026-07-18-frontend-slice3-registrations-design.md`
— authority on behavior; this plan sequences the work.

**Tech stack:** unchanged from Slices 1–2 (Next.js App Router, Tailwind v4,
shadcn/ui, TanStack Query, Zustand, React Hook Form + Zod, Vitest + RTL).

## Global constraints

- Baseline before starting: frontend 40/40 Vitest, clean `npm run build`;
  backend 101 unit / 326 e2e (unchanged since Slice 2 merge, `f87b9b7`).
  Backend is **not touched** this slice — no new endpoints needed, all
  behavior verified against the existing controllers/services during
  brainstorming.
- Branch: `feature/frontend-slice3-registrations`, cut from `main` at the
  start of Task 1.
- One commit per task. `npm test` + `npm run build` clean before each commit.
- No new shadcn components. The events list page already established the
  precedent of plain styled `<select>`/`<button>` over shadcn `Select`/
  `Tabs` primitives (`app/(app)/[orgSlug]/events/page.tsx`'s status filter
  and upcoming/past toggle) — this slice's tab UI, type-select, and
  checkbox all follow that same precedent rather than installing new
  dependencies.
- `GET .../registrations/me`'s empty-body-vs-JSON-null edge case (found
  during brainstorming) needs **no special handling** — `lib/api.ts`'s
  `parseBody()` already converts an empty response body to `null` before it
  reaches the caller (`lib/api.ts:36-44`). `useMyRegistration` just types its
  return as `Registration | null`.
- Design tokens: registration-status badges use semantic tokens
  (`--success`/`--warning`/`--danger`, plus neutral for CANCELLED) — never
  the `--domain-registrations` hue, which is reserved for icons/nav per
  `design.md`. Reuse `relativeTime()` from
  `features/dashboard/format.ts:55-64` for submitted-date display.
  Reuse the `Dialog` confirm pattern from
  `components/events/lifecycle-actions.tsx` for cancel/reject confirms.
- Live verification (Slices 1–2's pattern): after the full flow is wired,
  actually drive it against the running dev backend — build a form,
  register, fill it, cancel, hit capacity/waitlist, reject — rather than
  relying on unit tests alone for page-level correctness.
- Icons: Lucide only.

---

### Task 1: Data layer — types, registration hooks, form hooks

**Files:**
- Modify: `frontend/types/api.ts` (add `Registration`, `RegistrationStatus`,
  `RegistrationForm`, `FormField`)
- Create: `frontend/features/registrations/use-registrations.ts`
- Create: `frontend/features/registrations/use-registration-form.ts`

**Interfaces:**
- Produces: `Registration`, `RegistrationStatus`, `RegistrationForm`,
  `FormField` types; `useMyRegistration(orgId, eventId)`,
  `useRegistrations(orgId, eventId)`, `useRegisterForEvent(orgId, eventId)`,
  `useCancelRegistration(orgId, eventId)`,
  `useRejectRegistration(orgId, eventId)`, `useRegistrationForm(orgId,
  eventId)`, `useUpsertRegistrationForm(orgId, eventId)`,
  `useDeleteRegistrationForm(orgId, eventId)` — all consumed by later tasks'
  UI components.

**Steps:**

- [ ] **Step 1: Add the registration and form types.** In `types/api.ts`,
  append (field set per `prisma/schema.prisma:189-223` and
  `docs/database.md:85-126`, cross-checked against `registrations.service.ts`
  and `registration-form.controller.ts` during brainstorming):

```ts
export type RegistrationStatus = 'APPROVED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';

export interface Registration {
  id: string;
  eventId: string;
  organizationId: string;
  userId: string;
  answers: Record<string, string | string[]> | null;
  status: RegistrationStatus;
  consentRecordId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FormFieldType = 'TEXT' | 'TEXTAREA' | 'SELECT' | 'CHECKBOX';

export interface FormField {
  label: string;
  type: FormFieldType;
  required: boolean;
  options?: string[];
  order: number;
}

export interface RegistrationForm {
  id: string;
  eventId: string;
  organizationId: string;
  fields: FormField[];
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Implement `use-registrations.ts`** (no test file — thin
  TanStack Query wiring, same pattern as `features/events/use-events.ts`):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Registration } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/registrations`;
}

export function useMyRegistration(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registration', 'me'],
    queryFn: () => api<Registration | null>(`${base(orgId, eventId)}/me`),
  });
}

export function useRegistrations(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registrations'],
    queryFn: () => api<Registration[]>(base(orgId, eventId)),
  });
}

function useInvalidateRegistrations(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registrations'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration', 'me'] });
    qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId] });
  };
}

export function useRegisterForEvent(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (answers: Record<string, string | string[]> | undefined) =>
      api<Registration>(base(orgId, eventId), {
        method: 'POST',
        body: answers && Object.keys(answers).length > 0 ? { answers } : {},
      }),
    onSuccess: invalidate,
  });
}

export function useCancelRegistration(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (registrationId: string) =>
      api<Registration>(`${base(orgId, eventId)}/${registrationId}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useRejectRegistration(orgId: string, eventId: string) {
  const invalidate = useInvalidateRegistrations(orgId, eventId);
  return useMutation({
    mutationFn: (registrationId: string) =>
      api<Registration>(`${base(orgId, eventId)}/${registrationId}/reject`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 3: Implement `use-registration-form.ts`** (no test file, same
  reasoning):

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { FormField, RegistrationForm } from '@/types/api';

function base(orgId: string, eventId: string) {
  return `/organizations/${orgId}/events/${eventId}/registration-form`;
}

export function useRegistrationForm(orgId: string, eventId: string) {
  return useQuery({
    queryKey: ['org', orgId, 'event', eventId, 'registration-form'],
    queryFn: () => api<RegistrationForm | null>(base(orgId, eventId)),
  });
}

export function useUpsertRegistrationForm(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: FormField[]) =>
      api<RegistrationForm>(base(orgId, eventId), { method: 'PUT', body: { fields } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration-form'] }),
  });
}

export function useDeleteRegistrationForm(orgId: string, eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ removed: true }>(base(orgId, eventId), { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['org', orgId, 'event', eventId, 'registration-form'] }),
  });
}
```

- [ ] **Step 4: Verify + commit.** `npm test` + `npm run build`.

```bash
git checkout -b feature/frontend-slice3-registrations
git add frontend/types/api.ts frontend/features/registrations/use-registrations.ts frontend/features/registrations/use-registration-form.ts
git commit -m "feat(frontend): registrations data layer — types, query hooks"
```

---

### Task 2: Answer-schema builder + form-editor schema

**Files:**
- Create: `frontend/features/registrations/schemas.ts`
- Create: `frontend/features/registrations/__tests__/schemas.test.ts`

**Interfaces:**
- Consumes: `FormField`, `FormFieldType` from `types/api.ts` (Task 1).
- Produces: `buildAnswerSchema(fields: FormField[]): z.ZodType`,
  `registrationFormSchema: z.ZodType` (editor validation),
  `RegistrationFormEditorInput` type — consumed by Task 4 (`RegisterDialog`)
  and Task 6 (`RegistrationFormEditor`).

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create
  `features/registrations/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAnswerSchema, registrationFormSchema } from '@/features/registrations/schemas';
import type { FormField } from '@/types/api';

describe('buildAnswerSchema', () => {
  it('accepts an empty object when there are no fields', () => {
    expect(buildAnswerSchema([]).safeParse({}).success).toBe(true);
  });

  it('requires a required TEXT field to be non-empty', () => {
    const fields: FormField[] = [{ label: 'Name', type: 'TEXT', required: true, order: 0 }];
    const schema = buildAnswerSchema(fields);
    expect(schema.safeParse({ Name: '' }).success).toBe(false);
    expect(schema.safeParse({ Name: 'Ada' }).success).toBe(true);
  });

  it('allows an optional field to be omitted', () => {
    const fields: FormField[] = [{ label: 'Notes', type: 'TEXTAREA', required: false, order: 0 }];
    expect(buildAnswerSchema(fields).safeParse({}).success).toBe(true);
  });

  it('requires a required CHECKBOX to be true', () => {
    const fields: FormField[] = [{ label: 'Agree', type: 'CHECKBOX', required: true, order: 0 }];
    const schema = buildAnswerSchema(fields);
    // Native checkbox inputs bound via RHF register() yield a boolean, not
    // a string — the schema validates the boolean directly; conversion to
    // the 'true'/'false' string the backend expects happens at submit time.
    expect(schema.safeParse({ Agree: false }).success).toBe(false);
    expect(schema.safeParse({ Agree: true }).success).toBe(true);
  });

  it('rejects a SELECT value outside its options', () => {
    const fields: FormField[] = [
      { label: 'Size', type: 'SELECT', required: true, options: ['S', 'M', 'L'], order: 0 },
    ];
    const schema = buildAnswerSchema(fields);
    expect(schema.safeParse({ Size: 'XL' }).success).toBe(false);
    expect(schema.safeParse({ Size: 'M' }).success).toBe(true);
  });
});

describe('registrationFormSchema', () => {
  const base = { fields: [{ label: 'Name', type: 'TEXT' as const, required: true, options: [], order: 0 }] };

  it('accepts a valid field list', () => {
    expect(registrationFormSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a field with a blank label', () => {
    const r = registrationFormSchema.safeParse({ fields: [{ ...base.fields[0], label: '' }] });
    expect(r.success).toBe(false);
  });

  it('rejects a SELECT field with no options', () => {
    const r = registrationFormSchema.safeParse({
      fields: [{ label: 'Size', type: 'SELECT', required: true, options: [], order: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts an empty field list (form with zero fields)', () => {
    expect(registrationFormSchema.safeParse({ fields: [] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test` — fails, module doesn't
  exist yet.

- [ ] **Step 3: Implement `schemas.ts`:**

```ts
import { z } from 'zod';
import type { FormField } from '@/types/api';

// Mirrors backend RegistrationsService.validateAnswers exactly — built at
// runtime from the event's actual form so validation matches what the
// backend will accept.
export function buildAnswerSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const key = field.label;
    if (field.type === 'CHECKBOX') {
      // Native checkbox inputs bound via RHF register() yield a boolean —
      // validate the boolean directly. Converted to a 'true'/'false'
      // string only at submit time, to match the backend's answers shape.
      const checkbox = z.boolean();
      shape[key] = field.required
        ? checkbox.refine((v) => v === true, { message: `${field.label} is required` })
        : checkbox.optional();
      continue;
    }
    if (field.type === 'SELECT') {
      const options = field.options ?? [];
      const select = z.enum(options as [string, ...string[]]);
      shape[key] = field.required ? select : select.optional();
      continue;
    }
    // TEXT / TEXTAREA
    shape[key] = field.required
      ? z.string().min(1, `${field.label} is required`)
      : z.string().optional();
  }
  return z.object(shape);
}

// The committee-facing form-builder editor's own validation.
export const registrationFormSchema = z.object({
  fields: z
    .array(
      z
        .object({
          label: z.string().min(1, 'Label is required'),
          type: z.enum(['TEXT', 'TEXTAREA', 'SELECT', 'CHECKBOX']),
          required: z.boolean(),
          options: z.array(z.string()),
          order: z.number(),
        })
        .refine((f) => f.type !== 'SELECT' || f.options.length > 0, {
          message: 'SELECT fields need at least one option',
          path: ['options'],
        }),
    )
    .default([]),
});

export type RegistrationFormEditorInput = z.infer<typeof registrationFormSchema>;
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Verify + commit.** `npm run build`.

```bash
git add frontend/features/registrations/schemas.ts frontend/features/registrations/__tests__/schemas.test.ts
git commit -m "feat(frontend): registrations answer-schema builder + form-editor schema"
```

---

### Task 3: Answer-label formatting helper

**Files:**
- Create: `frontend/features/registrations/answers.ts`
- Create: `frontend/features/registrations/__tests__/answers.test.ts`

**Interfaces:**
- Consumes: `Registration['answers']`, `FormField[]` from `types/api.ts`.
- Produces: `formatAnswers(answers: Registration['answers'], fields:
  FormField[] | undefined): { label: string; value: string }[]` — consumed
  by Task 7 (`RegistrationsTable`).

**Steps:**

- [ ] **Step 1: Write the failing tests.** Create
  `features/registrations/__tests__/answers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatAnswers } from '@/features/registrations/answers';
import type { FormField } from '@/types/api';

const fields: FormField[] = [
  { label: 'Dietary needs', type: 'TEXT', required: false, order: 0 },
  { label: 'Size', type: 'SELECT', required: true, options: ['S', 'M'], order: 1 },
];

describe('formatAnswers', () => {
  it('returns an empty array for null answers', () => {
    expect(formatAnswers(null, fields)).toEqual([]);
  });

  it('maps answer keys to field labels in field order', () => {
    const result = formatAnswers({ Size: 'M', 'Dietary needs': 'Vegan' }, fields);
    expect(result).toEqual([
      { label: 'Dietary needs', value: 'Vegan' },
      { label: 'Size', value: 'M' },
    ]);
  });

  it('joins array answers with a comma', () => {
    const result = formatAnswers({ Size: ['S', 'M'] as unknown as string }, fields);
    expect(result).toEqual([{ label: 'Size', value: 'S, M' }]);
  });

  it('falls back to the raw key when the form is missing (deleted since submission)', () => {
    const result = formatAnswers({ Unknown: 'x' }, undefined);
    expect(result).toEqual([{ label: 'Unknown', value: 'x' }]);
  });

  it('skips answer keys that no longer match any field', () => {
    const result = formatAnswers({ Size: 'M', Stale: 'y' }, fields);
    expect(result).toEqual([{ label: 'Size', value: 'M' }, { label: 'Stale', value: 'y' }]);
  });
});
```

- [ ] **Step 2: Run tests — verify red.** `npm test`.

- [ ] **Step 3: Implement `answers.ts`:**

```ts
import type { FormField, Registration } from '@/types/api';

export function formatAnswers(
  answers: Registration['answers'],
  fields: FormField[] | undefined,
): { label: string; value: string }[] {
  if (!answers) return [];

  const orderByLabel = new Map((fields ?? []).map((f) => [f.label, f.order]));
  const keys = Object.keys(answers).sort((a, b) => {
    const orderA = orderByLabel.get(a) ?? Number.MAX_SAFE_INTEGER;
    const orderB = orderByLabel.get(b) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB;
  });

  return keys.map((key) => {
    const raw = answers[key];
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    return { label: key, value };
  });
}
```

- [ ] **Step 4: Run tests — verify green.** `npm test`.

- [ ] **Step 5: Verify + commit.** `npm run build`.

```bash
git add frontend/features/registrations/answers.ts frontend/features/registrations/__tests__/answers.test.ts
git commit -m "feat(frontend): registration answers-to-labels formatting helper"
```

---

### Task 4: RegistrationStatusBadge + RegisterDialog

**Files:**
- Create: `frontend/components/registrations/registration-status-badge.tsx`
- Create: `frontend/components/registrations/register-dialog.tsx`

**Interfaces:**
- Consumes: `RegistrationStatus` (Task 1), `buildAnswerSchema` (Task 2),
  `useRegisterForEvent` (Task 1), `useRegistrationForm` (Task 1),
  `FormField` (Task 1).
- Produces: `RegistrationStatusBadge({ status })`, `RegisterDialog({ orgId,
  eventId, eventTitle, open, onOpenChange })` — consumed by Task 5
  (`MyRegistrationPanel`).

**Steps:**

- [ ] **Step 1: `RegistrationStatusBadge`.** Same shape as
  `EventStatusBadge` (`components/events/event-status-badge.tsx`), semantic
  tokens only:

```tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RegistrationStatus } from '@/types/api';

const STATUS_STYLES: Record<RegistrationStatus, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'border-success/40 bg-success/10 text-success' },
  WAITLISTED: { label: 'Waitlisted', className: 'border-warning/40 bg-warning/10 text-warning' },
  REJECTED: { label: 'Rejected', className: 'border-danger/40 bg-danger/10 text-danger' },
  CANCELLED: { label: 'Cancelled', className: 'border-border bg-surface-secondary text-foreground-muted' },
};

export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn('shrink-0', className)}>
      {label}
    </Badge>
  );
}
```

- [ ] **Step 2: `RegisterDialog`.** Dynamic form inside a `Dialog`, RHF +
  `zodResolver(buildAnswerSchema(form?.fields ?? []))`. Field rendering per
  type: TEXT → `Input`, TEXTAREA → `Textarea`, SELECT → plain styled
  `<select>` (matches the events-list precedent, no shadcn `Select` added),
  CHECKBOX → plain `<input type="checkbox">` with a `Label`. No form loaded
  (`form.data === null`) → dialog body is just a confirm sentence, no
  fields. Submit calls `useRegisterForEvent`, converting checkbox `boolean`
  state to the `'true'|'false'` string the backend/schema expect. Surfaces
  `ApiError` messages inline (409 duplicate, 400 validation) the same way
  `EventForm` does.

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRegisterForEvent } from '@/features/registrations/use-registrations';
import { useRegistrationForm } from '@/features/registrations/use-registration-form';
import { buildAnswerSchema } from '@/features/registrations/schemas';
import { ApiError } from '@/lib/api';

interface RegisterDialogProps {
  orgId: string;
  eventId: string;
  eventTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterDialog({ orgId, eventId, eventTitle, open, onOpenChange }: RegisterDialogProps) {
  const formQuery = useRegistrationForm(orgId, eventId);
  const register = useRegisterForEvent(orgId, eventId);
  const fields = formQuery.data?.fields ?? [];

  const form = useForm<Record<string, string | boolean>>({
    resolver: zodResolver(buildAnswerSchema(fields)),
    defaultValues: {},
  });

  const topError =
    register.error instanceof ApiError
      ? register.error.message
      : register.error
        ? 'Something went wrong — please try again'
        : null;

  const submit = form.handleSubmit((values) => {
    // buildAnswerSchema validates CHECKBOX as boolean (native RHF
    // checkbox binding); the backend's answers shape is string-valued, so
    // convert here, after validation, before the request body is built.
    const answers: Record<string, string> = {};
    for (const field of fields) {
      const v = values[field.label];
      if (v === undefined || v === '') continue;
      answers[field.label] = typeof v === 'boolean' ? String(v) : v;
    }
    register.mutate(answers, { onSuccess: () => onOpenChange(false) });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register for {eventTitle}</DialogTitle>
          {fields.length === 0 && <DialogDescription>Confirm your registration.</DialogDescription>}
        </DialogHeader>

        {topError && (
          <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {topError}
          </p>
        )}

        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {fields.map((field) => {
            const error = form.formState.errors[field.label]?.message as string | undefined;
            return (
              <div key={field.label} className="flex flex-col gap-1.5">
                <Label htmlFor={field.label}>
                  {field.label}
                  {field.required && ' *'}
                </Label>
                {field.type === 'TEXT' && <Input id={field.label} {...form.register(field.label)} />}
                {field.type === 'TEXTAREA' && (
                  <Textarea id={field.label} rows={3} {...form.register(field.label)} />
                )}
                {field.type === 'SELECT' && (
                  <select
                    id={field.label}
                    {...form.register(field.label)}
                    className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
                  >
                    <option value="">Select…</option>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === 'CHECKBOX' && (
                  <input id={field.label} type="checkbox" {...form.register(field.label)} />
                )}
                {error && <p className="text-sm text-danger">{error}</p>}
              </div>
            );
          })}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={register.isPending}>
              {register.isPending && <Loader2 className="size-4 animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/registrations/registration-status-badge.tsx frontend/components/registrations/register-dialog.tsx
git commit -m "feat(frontend): registration status badge, self-registration dialog"
```

---

### Task 5: MyRegistrationPanel (self-registration entry point)

**Files:**
- Create: `frontend/components/registrations/my-registration-panel.tsx`

**Interfaces:**
- Consumes: `useMyRegistration`, `useCancelRegistration` (Task 1),
  `RegistrationStatusBadge`, `RegisterDialog` (Task 4), `Event` (existing
  type).
- Produces: `MyRegistrationPanel({ orgId, event })` — consumed by Task 8
  (event detail page wiring).

**Steps:**

- [ ] **Step 1: Implement the panel.** No registration + event `PUBLISHED`
  → "Register" button opening `RegisterDialog`. No registration + event not
  `PUBLISHED` → renders nothing. Has a registration → `RegistrationStatusBadge`
  +, when status is `APPROVED` or `WAITLISTED`, a "Cancel my registration"
  button behind a `Dialog` confirm (mirrors
  `components/events/lifecycle-actions.tsx`'s cancel-confirm pattern).

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
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import { RegisterDialog } from '@/components/registrations/register-dialog';
import { useCancelRegistration, useMyRegistration } from '@/features/registrations/use-registrations';
import { ApiError } from '@/lib/api';
import type { Event } from '@/types/api';

export function MyRegistrationPanel({ orgId, event }: { orgId: string; event: Event }) {
  const myRegistration = useMyRegistration(orgId, event.id);
  const cancel = useCancelRegistration(orgId, event.id);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (myRegistration.isPending) return null;

  const registration = myRegistration.data;

  if (!registration) {
    if (event.status !== 'PUBLISHED') return null;
    return (
      <div>
        <Button onClick={() => setRegisterOpen(true)}>Register</Button>
        <RegisterDialog
          orgId={orgId}
          eventId={event.id}
          eventTitle={event.title}
          open={registerOpen}
          onOpenChange={setRegisterOpen}
        />
      </div>
    );
  }

  const canCancelReg = registration.status === 'APPROVED' || registration.status === 'WAITLISTED';

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <RegistrationStatusBadge status={registration.status} />
        {canCancelReg && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmingCancel(true)}>
            Cancel my registration
          </Button>
        )}
      </div>

      <Dialog open={confirmingCancel} onOpenChange={setConfirmingCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel your registration?</DialogTitle>
            <DialogDescription>
              You can register again later if the event is still published.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
              Keep registration
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                setError(null);
                cancel.mutate(registration.id, {
                  onSuccess: () => setConfirmingCancel(false),
                  onError: (e) => {
                    setConfirmingCancel(false);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {cancel.isPending && <Loader2 className="size-4 animate-spin" />}
              Cancel registration
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
git add frontend/components/registrations/my-registration-panel.tsx
git commit -m "feat(frontend): self-registration panel — register, status, cancel"
```

---

### Task 6: RegistrationFormEditor (committee form builder)

**Files:**
- Create: `frontend/components/registrations/registration-form-editor.tsx`

**Interfaces:**
- Consumes: `useRegistrationForm`, `useUpsertRegistrationForm` (Task 1),
  `registrationFormSchema`, `RegistrationFormEditorInput` (Task 2),
  `canEdit` from `features/events/status.ts` (existing, Slice 2).
- Produces: `RegistrationFormEditor({ orgId, event })` — consumed by Task 8.

**Steps:**

- [ ] **Step 1: Implement the editor.** RHF `useFieldArray` over
  `registrationFormSchema`, seeded from `useRegistrationForm`'s current
  fields (or an empty array). Each row: label `Input`, type plain
  `<select>` (TEXT/TEXTAREA/SELECT/CHECKBOX), required `<input
  type="checkbox">`, and — only when that row's type is `SELECT` — a nested
  options list (comma-separated `Input`, split/trimmed on save). Row
  controls: remove (✕ button), move up/down (disabled at the respective
  array end). Toolbar: "Add field" (appends a blank TEXT row) and "Save"
  (`useUpsertRegistrationForm`, full field array, `order` reassigned from
  current array index on submit). Whole editor renders read-only (no
  add/remove/reorder/save controls, fields shown as plain text) when
  `!canEdit(event.status)`, with a one-line note explaining why. Empty
  state when there are zero fields and the event is editable: "No custom
  form — participants can register with one click" + a button that appends
  one blank field.

```tsx
'use client';

import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, ChevronUp, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  registrationFormSchema,
  type RegistrationFormEditorInput,
} from '@/features/registrations/schemas';
import {
  useRegistrationForm,
  useUpsertRegistrationForm,
} from '@/features/registrations/use-registration-form';
import { canEdit } from '@/features/events/status';
import { ApiError } from '@/lib/api';
import type { Event, FormFieldType } from '@/types/api';

const FIELD_TYPES: FormFieldType[] = ['TEXT', 'TEXTAREA', 'SELECT', 'CHECKBOX'];

export function RegistrationFormEditor({ orgId, event }: { orgId: string; event: Event }) {
  const formQuery = useRegistrationForm(orgId, event.id);
  const upsert = useUpsertRegistrationForm(orgId, event.id);
  const editable = canEdit(event.status);

  const editor = useForm<RegistrationFormEditorInput>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: { fields: [] },
  });
  const { fields, append, remove, move } = useFieldArray({ control: editor.control, name: 'fields' });

  useEffect(() => {
    if (formQuery.data) {
      editor.reset({
        fields: formQuery.data.fields.map((f) => ({ ...f, options: f.options ?? [] })),
      });
    }
  }, [formQuery.data, editor]);

  if (formQuery.isPending) return null;

  const topError =
    upsert.error instanceof ApiError
      ? upsert.error.message
      : upsert.error
        ? 'Something went wrong — please try again'
        : null;

  const submit = editor.handleSubmit((values) => {
    upsert.mutate(values.fields.map((f, i) => ({ ...f, order: i })));
  });

  if (!editable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground-muted">
          Completed or cancelled events can&apos;t have their form edited.
        </p>
        {fields.length === 0 ? (
          <p className="text-sm text-foreground-muted">No custom form was set for this event.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {fields.map((f) => (
              <li key={f.id}>
                {f.label} — {f.type}
                {f.required && ' (required)'}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}

      {fields.length === 0 && (
        <p className="text-sm text-foreground-muted">
          No custom form — participants can register with one click.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const rowType = editor.watch(`fields.${index}.type`);
          return (
            <div key={field.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Input placeholder="Label" {...editor.register(`fields.${index}.label`)} />
                <select
                  {...editor.register(`fields.${index}.type`)}
                  className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Label className="flex shrink-0 items-center gap-1.5 text-sm">
                  <input type="checkbox" {...editor.register(`fields.${index}.required`)} />
                  Required
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  aria-label="Move up"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                  aria-label="Move down"
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label="Remove field"
                >
                  <X className="size-4" />
                </Button>
              </div>
              {rowType === 'SELECT' && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`options-${field.id}`} className="text-xs text-foreground-muted">
                    Options (comma-separated)
                  </Label>
                  <Input
                    id={`options-${field.id}`}
                    defaultValue={(field.options ?? []).join(', ')}
                    onBlur={(e) =>
                      editor.setValue(
                        `fields.${index}.options`,
                        e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      )
                    }
                  />
                </div>
              )}
              {editor.formState.errors.fields?.[index] && (
                <p className="text-sm text-danger">
                  {editor.formState.errors.fields[index]?.label?.message ??
                    editor.formState.errors.fields[index]?.options?.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => append({ label: '', type: 'TEXT', required: false, options: [], order: fields.length })}
        >
          <Plus className="size-4" />
          Add field
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add frontend/components/registrations/registration-form-editor.tsx
git commit -m "feat(frontend): registration form builder — committee field editor"
```

---

### Task 7: RegistrationsTable (committee list + reject)

**Files:**
- Create: `frontend/components/registrations/registrations-table.tsx`

**Interfaces:**
- Consumes: `useRegistrations`, `useRejectRegistration` (Task 1),
  `useRegistrationForm` (Task 1, for answer labels), `formatAnswers`
  (Task 3), `RegistrationStatusBadge` (Task 4), `relativeTime` (existing,
  `features/dashboard/format.ts`).
- Produces: `RegistrationsTable({ orgId, event })` — consumed by Task 8.

**Steps:**

- [ ] **Step 1: Implement the table.** Local state: `statusFilter` (`'all'
  | RegistrationStatus`, default `'all'`), filtered client-side (same
  precedent as the events list). Status filter as a segmented `Button` row
  (5 options: All/Approved/Waitlisted/Rejected/Cancelled), matching the
  events list's Upcoming/Past toggle styling. Table columns: Participant
  (`userId`, `font-mono text-xs`), Status (`RegistrationStatusBadge`),
  Submitted (`relativeTime(r.createdAt)`), Answers (`formatAnswers` output
  joined as `label: value` lines), Actions (Reject button — hidden once
  `status` is `REJECTED`/`CANCELLED` — behind a `Dialog` confirm). Empty
  state: "No registrations yet" (no filter) / "No registrations match this
  filter."

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
import { RegistrationStatusBadge } from '@/components/registrations/registration-status-badge';
import { useRegistrations, useRejectRegistration } from '@/features/registrations/use-registrations';
import { useRegistrationForm } from '@/features/registrations/use-registration-form';
import { formatAnswers } from '@/features/registrations/answers';
import { relativeTime } from '@/features/dashboard/format';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Event, RegistrationStatus } from '@/types/api';

type StatusFilter = 'all' | RegistrationStatus;
const FILTERS: StatusFilter[] = ['all', 'APPROVED', 'WAITLISTED', 'REJECTED', 'CANCELLED'];
const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All', APPROVED: 'Approved', WAITLISTED: 'Waitlisted', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export function RegistrationsTable({ orgId, event }: { orgId: string; event: Event }) {
  const registrations = useRegistrations(orgId, event.id);
  const formQuery = useRegistrationForm(orgId, event.id);
  const reject = useRejectRegistration(orgId, event.id);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => (registrations.data ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [registrations.data, statusFilter],
  );

  if (registrations.isPending) return null;
  if (registrations.isError) {
    return <p className="text-sm text-foreground-muted">Couldn&apos;t load registrations.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex rounded-md border border-border p-0.5">
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
          {statusFilter === 'all' ? 'No registrations yet.' : 'No registrations match this filter.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((r) => {
            const answers = formatAnswers(r.answers, formQuery.data?.fields);
            const canReject = r.status !== 'REJECTED' && r.status !== 'CANCELLED';
            return (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground-muted">{r.userId}</span>
                  <div className="flex items-center gap-2">
                    <RegistrationStatusBadge status={r.status} />
                    <span className="text-xs text-foreground-subtle">{relativeTime(r.createdAt)}</span>
                    {canReject && (
                      <Button variant="destructive" size="sm" onClick={() => setRejecting(r.id)}>
                        Reject
                      </Button>
                    )}
                  </div>
                </div>
                {answers.length > 0 && (
                  <ul className="flex flex-col gap-0.5 text-foreground-muted">
                    {answers.map((a) => (
                      <li key={a.label}>
                        {a.label}: {a.value}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this registration?</DialogTitle>
            <DialogDescription>
              If this was the approved slot, the oldest waitlisted registrant is promoted automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Keep registration
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending}
              onClick={() => {
                if (!rejecting) return;
                setError(null);
                reject.mutate(rejecting, {
                  onSuccess: () => setRejecting(null),
                  onError: (e) => {
                    setRejecting(null);
                    setError(e instanceof ApiError ? e.message : 'Something went wrong');
                  },
                });
              }}
            >
              {reject.isPending && <Loader2 className="size-4 animate-spin" />}
              Reject
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
git add frontend/components/registrations/registrations-table.tsx
git commit -m "feat(frontend): committee registrations table — filter, reject"
```

---

### Task 8: Wire into event detail page

**Files:**
- Modify: `frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx`

**Interfaces:**
- Consumes: `MyRegistrationPanel` (Task 5), `RegistrationFormEditor` (Task
  6), `RegistrationsTable` (Task 7), `isCommittee` (existing).

**Steps:**

- [ ] **Step 1: Add local tab state and restructure the page.** No new
  shadcn dependency — a `'overview' | 'form' | 'registrations'` `useState`
  plus a small segmented-button row, matching the events list's
  Upcoming/Past toggle exactly. Non-committee users never see the tab row
  (only one implicit "tab": today's content). Insert `<MyRegistrationPanel
  orgId={org.id} event={e} />` directly below the existing description
  block, for all users. For committee, render the tab row above that same
  content area; selecting "Registration Form" swaps in
  `<RegistrationFormEditor orgId={org.id} event={e} />`, selecting
  "Registrations" swaps in `<RegistrationsTable orgId={org.id} event={e}
  />`.

```tsx
'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CalendarDays, MapPin, Pencil, Users } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EventNotFound } from '@/components/events/event-not-found';
import { EventStatusBadge } from '@/components/events/event-status-badge';
import { LifecycleActions } from '@/components/events/lifecycle-actions';
import { eventDateRange } from '@/components/events/event-card';
import { MyRegistrationPanel } from '@/components/registrations/my-registration-panel';
import { RegistrationFormEditor } from '@/components/registrations/registration-form-editor';
import { RegistrationsTable } from '@/components/registrations/registrations-table';
import { useEvent } from '@/features/events/use-events';
import { useOrg } from '@/features/orgs/org-provider';
import { canEdit } from '@/features/events/status';
import { isCommittee } from '@/features/orgs/roles';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'form' | 'registrations';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'form', label: 'Registration Form' },
  { id: 'registrations', label: 'Registrations' },
];

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const { org, membership } = useOrg();
  const event = useEvent(org.id, eventId);
  const [tab, setTab] = useState<Tab>('overview');
  const committee = isCommittee(membership.role);

  if (event.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 rounded-lg" />
      </main>
    );
  }

  if (event.isError) {
    if (event.error instanceof ApiError && event.error.status === 404) {
      return <EventNotFound />;
    }
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-foreground-muted">Couldn&apos;t load this event.</p>
        <Button variant="secondary" onClick={() => event.refetch()}>
          Try again
        </Button>
      </main>
    );
  }

  const e = event.data;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 lg:p-6">
      <Link
        href={`/${org.slug}/events`}
        className="flex w-fit items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        All events
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{e.title}</h1>
          <EventStatusBadge status={e.status} />
        </div>
        {committee && canEdit(e.status) && (
          <Link
            href={`/${org.slug}/events/${e.id}/edit`}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            <Pencil className="size-3.5" />
            Edit
          </Link>
        )}
      </div>

      {committee && (
        <div className="flex w-fit rounded-md border border-border p-0.5">
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
      )}

      {(tab === 'overview' || !committee) && (
        <>
          <div className="flex flex-col gap-2 text-sm text-foreground-muted">
            <span className="flex items-center gap-2">
              <CalendarDays className="size-4" />
              {eventDateRange(e)}
            </span>
            {e.venue && (
              <span className="flex items-center gap-2">
                <MapPin className="size-4" />
                {e.venue}
              </span>
            )}
            <span className="flex items-center gap-2">
              <Users className="size-4" />
              {e.capacity === null ? 'Unlimited capacity' : `Capacity: ${e.capacity}`}
            </span>
          </div>

          {e.description && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{e.description}</p>
          )}

          <MyRegistrationPanel orgId={org.id} event={e} />

          <LifecycleActions event={e} orgId={org.id} orgSlug={org.slug} role={membership.role} />
        </>
      )}

      {committee && tab === 'form' && <RegistrationFormEditor orgId={org.id} event={e} />}
      {committee && tab === 'registrations' && <RegistrationsTable orgId={org.id} event={e} />}
    </main>
  );
}
```

- [ ] **Step 2: Verify + commit.** `npm test` + `npm run build`.

```bash
git add "frontend/app/(app)/[orgSlug]/events/[eventId]/page.tsx"
git commit -m "feat(frontend): event detail — registration tabs wired in"
```

---

### Task 9: Live verification + polish

Not a code task on its own — a checkpoint, same as Slices 1–2's live-driven
tasks. No separate commit unless verification surfaces a real bug (then fix
+ commit as its own small commit, description reflecting the actual bug).

- [ ] **Step 1:** `docker compose up -d` if the stack has stopped. Start
  backend (`npm run start:dev`) and frontend (`npm run dev`) dev servers.
- [ ] **Step 2:** As a committee user, open an existing PUBLISHED event's
  "Registration Form" tab, add one field of each type (TEXT required,
  TEXTAREA optional, SELECT with 2 options required, CHECKBOX required),
  save, reload the tab, confirm the fields persisted in the same order.
- [ ] **Step 3:** As a second (participant) account, open the same event,
  click Register, confirm the dialog shows all four fields; submit with the
  required TEXT field blank → confirm the inline validation error; submit
  the required CHECKBOX unchecked → confirm the inline error; fill
  everything correctly → submit → confirm the status badge shows Approved
  and a "Cancel my registration" button appears. Reload the page, confirm
  the state persisted.
- [ ] **Step 4:** As the committee user, open the "Registrations" tab,
  confirm the new registration appears with the submitted answers rendered
  as label:value lines, filter by "Approved", confirm it's still visible;
  filter by "Rejected", confirm it disappears.
- [ ] **Step 5:** Set the event's capacity to 1 via Edit (or use an event
  already at capacity 1). Register a third account into it — confirm the
  status badge shows Waitlisted, not Approved. As the committee user, on
  the "Registrations" tab, reject the Approved registration — confirm the
  waitlisted one flips to Approved after a refetch (reload the participant
  account's event page to confirm the same). Reject the newly-approved one
  too — confirm it moves to Rejected in the table and the "Reject" button
  disappears for that row.
- [ ] **Step 6:** As the second account, cancel their own (already
  rejected/cancelled, or a fresh) registration where still possible —
  confirm the "Cancel my registration" button correctly disappears once a
  registration reaches a terminal state.
- [ ] **Step 7:** Mark the event Completed (or use a COMPLETED event),
  confirm the "Registration Form" tab renders read-only (no Add/Save
  controls) rather than erroring, and confirm `MyRegistrationPanel` no
  longer offers a Register button for a fresh account (event no longer
  `PUBLISHED`).
- [ ] **Step 8:** Screenshot the event detail page (Overview with an active
  registration, Registration Form tab, Registrations tab) in both light and
  dark themes (Playwright) — confirm status badges read correctly in both
  and the domain-registrations hue never appears on a status badge.
- [ ] **Step 9:** Full regression — `npm test` (frontend) and `npm test &&
  npm run test:e2e` (backend, confirming this slice touched zero backend
  files) — both must match the pre-slice baseline (frontend
  40+new/40+new all green; backend 101/326 unchanged).

---

## Post-tasks (after pause, per standing preference)

**Docs sync:** update `docs/uiux.md` with a "Slice 3 — Registrations
(shipped)" section (form-builder editor pattern, dynamic answer-schema
generation, self-registration panel states, no-manual-approve model, the
tab restructure on event detail). Update `docs/current-context.md`
(untracked) — mark Slice 3 shipped, note remaining candidate slices
(Members; Attendance/QR check-in, which was explicitly deferred out of this
slice's scope).

**Finish branch:** verify frontend `npm test`/`npm run build` and backend
`npm test`/`npm run test:e2e` all green → merge
`feature/frontend-slice3-registrations` to `main` locally, delete branch.
Never push.
