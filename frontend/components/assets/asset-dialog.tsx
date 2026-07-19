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
import { useCreateAsset, useUpdateAsset } from '@/features/assets/use-assets';
import { assetFormSchema, type AssetFormValues } from '@/features/assets/schema';
import { ApiError } from '@/lib/api';
import type { Asset, AssetCondition } from '@/types/api';

const CONDITIONS: AssetCondition[] = ['GOOD', 'DAMAGED', 'LOST'];

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
// prop) — a fresh mount always starts from its own defaultValues, which
// sidesteps the stale-state bug class Slice 9's UploadFileDialog hit with
// manual reset logic.
export function AssetDialog({
  orgId,
  asset,
  onClose,
}: {
  orgId: string;
  asset?: Asset;
  onClose: () => void;
}) {
  const isEdit = Boolean(asset);
  const create = useCreateAsset(orgId);
  const update = useUpdateAsset(orgId);
  const isPending = create.isPending || update.isPending;

  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: asset
      ? {
          name: asset.name,
          quantity: String(asset.quantity),
          condition: asset.condition,
          location: asset.location ?? '',
          notes: asset.notes ?? '',
        }
      : { name: '', quantity: '1', condition: 'GOOD', location: '', notes: '' },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) => {
    const input = {
      name: values.name,
      quantity: Number(values.quantity),
      condition: values.condition,
      location: values.location || undefined,
      notes: values.notes || undefined,
    };
    if (asset) {
      update.mutate({ assetId: asset.id, input }, { onSuccess: onClose });
    } else {
      create.mutate(input, { onSuccess: onClose });
    }
  });

  const mutationError = create.error ?? update.error;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit asset' : 'Add asset'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Field label="Name" htmlFor="asset-name" error={errors.name?.message}>
            <Input id="asset-name" {...form.register('name')} />
          </Field>
          <Field label="Quantity" htmlFor="asset-quantity" error={errors.quantity?.message}>
            <Input id="asset-quantity" inputMode="numeric" {...form.register('quantity')} />
          </Field>
          <Field label="Condition" htmlFor="asset-condition">
            <select
              id="asset-condition"
              {...form.register('condition')}
              className="h-9 rounded-md border border-input bg-surface px-2.5 text-sm"
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location (optional)" htmlFor="asset-location">
            <Input id="asset-location" {...form.register('location')} />
          </Field>
          <Field label="Notes (optional)" htmlFor="asset-notes">
            <Textarea id="asset-notes" {...form.register('notes')} />
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
