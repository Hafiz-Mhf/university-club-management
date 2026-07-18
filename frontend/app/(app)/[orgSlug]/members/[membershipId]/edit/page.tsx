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

  // No GET /members/:id exists — find the row in the org-scoped list.
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
