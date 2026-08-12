'use client';

import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { brandContrastReport } from '@/features/orgs/contrast';
import { orgColorSchema, type OrgColorFormValues } from '@/features/orgs/color-schema';
import { useUpdateOrgSettings } from '@/features/orgs/use-orgs';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Organization } from '@/types/api';

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorField({
  id,
  label,
  hint,
  value,
  disabled,
  error,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  error?: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        {/* The swatch IS the picker — a 44px target that opens the OS colour
            dialog, so nobody has to know what a hex code is. */}
        <input
          type="color"
          aria-label={`${label} picker`}
          disabled={disabled}
          value={HEX.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-11 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          className="max-w-40 font-mono"
        />
      </div>
      <p className="text-xs text-foreground-subtle">{hint}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

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
      primaryColor: org.primaryColor ?? '#6E56CF',
      secondaryColor: org.secondaryColor ?? '#5B8DEF',
    },
  });
  const errors = form.formState.errors;

  const [primaryColor, secondaryColor] = useWatch({
    control: form.control,
    name: ['primaryColor', 'secondaryColor'],
  });

  // Success used to be a permanent green bar that sat above the form while you
  // kept editing. A toast says the same thing and then gets out of the way.
  useEffect(() => {
    if (update.isSuccess) toast.success('Colors saved');
  }, [update.isSuccess]);

  const onSubmit = form.handleSubmit((values) => update.mutate(values));

  const report = HEX.test(primaryColor) ? brandContrastReport(primaryColor) : null;
  const failing = report?.failingThemes ?? [];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {update.error && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {update.error instanceof ApiError ? update.error.message : 'Something went wrong'}
        </p>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:gap-8">
        <ColorField
          id="org-primary-color"
          label="Primary color"
          hint="Buttons, links and active navigation."
          value={primaryColor}
          disabled={!canManage}
          error={errors.primaryColor?.message}
          onChange={(next) => form.setValue('primaryColor', next, { shouldValidate: true })}
        />
        <ColorField
          id="org-secondary-color"
          label="Secondary color"
          hint="Stored for your public page. Not used in the app yet."
          value={secondaryColor}
          disabled={!canManage}
          error={errors.secondaryColor?.message}
          onChange={(next) => form.setValue('secondaryColor', next, { shouldValidate: true })}
        />
      </div>

      {/* Preview, because a hex code tells a committee member nothing about
          what their club is going to look like. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <p className="text-xs font-medium tracking-wide text-foreground-muted uppercase">Preview</p>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-white"
            style={{ backgroundColor: HEX.test(primaryColor) ? primaryColor : undefined }}
          >
            Primary button
          </span>
          <span
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-sm font-medium"
            style={{
              color: HEX.test(primaryColor) ? primaryColor : undefined,
              backgroundColor: HEX.test(primaryColor) ? `${primaryColor}1A` : undefined,
            }}
          >
            Active nav item
          </span>
          <span
            className="text-sm underline-offset-4 hover:underline"
            style={{ color: HEX.test(primaryColor) ? primaryColor : undefined }}
          >
            A link
          </span>
        </div>
      </div>

      {failing.length > 0 && (
        <p
          className={cn(
            'flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning',
          )}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Too low-contrast for {failing.join(' and ')} mode
            {report && ` (${report[failing[0]].toFixed(1)}:1, needs 3:1)`} — members using{' '}
            {failing.join(' or ')} mode will see the default violet instead. Pick a{' '}
            {failing[0] === 'light' ? 'darker' : 'lighter'} shade to have it applied everywhere.
          </span>
        </p>
      )}

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
