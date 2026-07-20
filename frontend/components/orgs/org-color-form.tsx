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
