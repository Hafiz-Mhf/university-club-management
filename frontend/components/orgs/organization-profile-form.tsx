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
