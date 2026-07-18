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

  const form = useForm<AddMemberFormInput>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: {
      email: '', role: 'PARTICIPANT', studentId: '', faculty: '', programme: '', intake: '', phone: '',
    },
  });

  // The backend would 403 the POST anyway — just don't show a dead-end form.
  useEffect(() => {
    if (!canAdd) router.replace(`/${org.slug}/members`);
  }, [canAdd, router, org.slug]);
  if (!canAdd) return null;

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
