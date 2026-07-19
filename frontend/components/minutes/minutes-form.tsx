'use client';

import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { minutesFormSchema, type MinutesFormValues } from '@/features/minutes/schema';
import type { MinutesInput } from '@/features/minutes/use-minutes';
import { useMembers } from '@/features/members/use-members';
import { ApiError } from '@/lib/api';

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

interface MinutesFormProps {
  orgId: string;
  mode: 'create' | 'edit';
  defaultValues?: Partial<MinutesFormValues>;
  onSubmit: (values: MinutesInput) => void;
  isPending: boolean;
  error: unknown;
}

// Only rendered on the new/edit pages, which both redirect non-committee
// viewers before mounting it — so useMembers here carries no authorization
// risk (unlike the detail page, which is visible to any member).
export function MinutesForm({ orgId, mode, defaultValues, onSubmit, isPending, error }: MinutesFormProps) {
  const members = useMembers(orgId, { status: 'ACTIVE' });
  const form = useForm<MinutesFormValues>({
    resolver: zodResolver(minutesFormSchema),
    defaultValues: {
      title: '',
      meetingDate: '',
      attendeeMembershipIds: [],
      agendaItems: [],
      actionItems: [],
      ...defaultValues,
    },
  });
  const errors = form.formState.errors;
  const agenda = useFieldArray({ control: form.control, name: 'agendaItems' });
  const actions = useFieldArray({ control: form.control, name: 'actionItems' });

  const submit = form.handleSubmit((values) => {
    onSubmit({
      ...values,
      actionItems: values.actionItems.map((a) => ({ task: a.task, owner: a.owner || undefined })),
    });
  });

  const topError = error instanceof ApiError ? error.message : error ? 'Something went wrong' : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}

      <Field label="Title" htmlFor="minutes-title" error={errors.title?.message}>
        <Input id="minutes-title" {...form.register('title')} />
      </Field>

      <Field label="Meeting date" htmlFor="minutes-date" error={errors.meetingDate?.message}>
        <Input id="minutes-date" type="date" {...form.register('meetingDate')} />
      </Field>

      <div className="flex flex-col gap-1.5">
        <Label>Attendees</Label>
        <Controller
          control={form.control}
          name="attendeeMembershipIds"
          render={({ field }) => (
            <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border border-border p-2">
              {(members.data ?? []).length === 0 && (
                <p className="text-sm text-foreground-muted">No active members yet.</p>
              )}
              {(members.data ?? []).map((m) => {
                const checked = field.value.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        field.onChange(
                          e.target.checked
                            ? [...field.value, m.id]
                            : field.value.filter((id) => id !== m.id),
                        );
                      }}
                    />
                    {m.user.fullName}
                  </label>
                );
              })}
            </div>
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Agenda items</Label>
        {agenda.fields.map((f, index) => (
          <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Topic"
                className="flex-1"
                {...form.register(`agendaItems.${index}.topic`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => agenda.remove(index)}
                aria-label="Remove agenda item"
              >
                <X className="size-4" />
              </Button>
            </div>
            <Textarea placeholder="Notes" {...form.register(`agendaItems.${index}.notes`)} />
            {errors.agendaItems?.[index] && (
              <p className="text-sm text-danger">
                {errors.agendaItems[index]?.topic?.message ?? errors.agendaItems[index]?.notes?.message}
              </p>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => agenda.append({ topic: '', notes: '' })}>
          <Plus className="size-4" />
          Add agenda item
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Action items</Label>
        {actions.fields.map((f, index) => (
          <div key={f.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Task"
                className="flex-1"
                {...form.register(`actionItems.${index}.task`)}
              />
              <Input
                placeholder="Owner (optional)"
                className="flex-1"
                {...form.register(`actionItems.${index}.owner`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => actions.remove(index)}
                aria-label="Remove action item"
              >
                <X className="size-4" />
              </Button>
            </div>
            {errors.actionItems?.[index]?.task && (
              <p className="text-sm text-danger">{errors.actionItems[index]?.task?.message}</p>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => actions.append({ task: '', owner: '' })}>
          <Plus className="size-4" />
          Add action item
        </Button>
      </div>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending && <Loader2 className="size-4 animate-spin" />}
        {mode === 'create' ? 'Create minutes' : 'Save'}
      </Button>
    </form>
  );
}
