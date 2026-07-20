'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreateAchievement, useUpdateAchievement } from '@/features/achievements/use-achievements';
import { achievementFormSchema, type AchievementFormValues } from '@/features/achievements/schema';
import { ApiError } from '@/lib/api';
import type { Achievement } from '@/types/api';

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

// Conditionally mounted by the caller (rendered only while open, no `open`
// prop) — same reset-bug-avoidance shape as Slice 10's AssetDialog: a
// fresh mount always starts from its own defaultValues.
export function AchievementDialog({
  orgId,
  achievement,
  onClose,
}: {
  orgId: string;
  achievement?: Achievement;
  onClose: () => void;
}) {
  const isEdit = Boolean(achievement);
  const create = useCreateAchievement(orgId);
  const update = useUpdateAchievement(orgId);
  const isPending = create.isPending || update.isPending;

  const form = useForm<AchievementFormValues>({
    resolver: zodResolver(achievementFormSchema),
    defaultValues: achievement
      ? {
          title: achievement.title,
          description: achievement.description,
          year: String(achievement.year),
        }
      : { title: '', description: '', year: String(new Date().getFullYear()) },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      title: values.title,
      description: values.description,
      year: Number(values.year),
    };
    if (achievement) {
      update.mutate({ achievementId: achievement.id, input }, { onSuccess: onClose });
    } else {
      create.mutate(input, { onSuccess: onClose });
    }
  });

  const mutationError = create.error ?? update.error;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit achievement' : 'Add achievement'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Title" htmlFor="achievement-title" error={errors.title?.message}>
            <Input id="achievement-title" {...form.register('title')} />
          </Field>
          <Field label="Description" htmlFor="achievement-description" error={errors.description?.message}>
            <Textarea id="achievement-description" {...form.register('description')} />
          </Field>
          <Field label="Year" htmlFor="achievement-year" error={errors.year?.message}>
            <Input id="achievement-year" inputMode="numeric" {...form.register('year')} />
          </Field>
          {mutationError && (
            <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {mutationError instanceof ApiError ? mutationError.message : 'Something went wrong'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
