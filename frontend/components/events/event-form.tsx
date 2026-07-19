'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  eventFormSchema,
  type EventFormInput,
  type EventFormValues,
} from '@/features/events/schemas';
import { ApiError } from '@/lib/api';

interface EventFormProps {
  mode: 'create' | 'edit';
  defaultValues?: Partial<EventFormValues>;
  onSubmit: (values: EventFormInput) => void;
  isPending: boolean;
  error: unknown;
}

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

export function EventForm({ mode, defaultValues, onSubmit, isPending, error }: EventFormProps) {
  const form = useForm<EventFormValues, unknown, EventFormInput>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: {
      title: '',
      description: '',
      venue: '',
      startAt: '',
      endAt: '',
      capacity: '',
      requireFeedbackForCertificate: false,
      ...defaultValues,
    },
  });
  const errors = form.formState.errors;

  // Backend 400 messages ("endAt must be after startAt") are already
  // user-legible — surface them verbatim.
  const topError =
    error instanceof ApiError
      ? error.message
      : error
        ? 'Something went wrong — please try again'
        : null;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex w-full max-w-xl flex-col gap-4"
      noValidate
    >
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}
      <Field label="Title" htmlFor="title" error={errors.title?.message}>
        <Input id="title" placeholder="Annual General Meeting" {...form.register('title')} />
      </Field>
      <Field label="Description" htmlFor="description" error={errors.description?.message}>
        <Textarea
          id="description"
          rows={4}
          placeholder="What's this event about? (optional)"
          {...form.register('description')}
        />
      </Field>
      <Field label="Venue" htmlFor="venue" error={errors.venue?.message}>
        <Input id="venue" placeholder="Student Union Hall (optional)" {...form.register('venue')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor="startAt" error={errors.startAt?.message}>
          <Input id="startAt" type="datetime-local" {...form.register('startAt')} />
        </Field>
        <Field label="Ends" htmlFor="endAt" error={errors.endAt?.message}>
          <Input id="endAt" type="datetime-local" {...form.register('endAt')} />
        </Field>
      </div>
      <Field label="Capacity" htmlFor="capacity" error={errors.capacity?.message}>
        <Input
          id="capacity"
          type="number"
          min={1}
          placeholder="Unlimited"
          className="max-w-40"
          {...form.register('capacity')}
        />
      </Field>
      <div className="flex items-center gap-2">
        <input
          id="requireFeedbackForCertificate"
          type="checkbox"
          {...form.register('requireFeedbackForCertificate')}
        />
        <Label htmlFor="requireFeedbackForCertificate" className="font-normal">
          Require feedback before releasing certificates
        </Label>
      </div>
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          {mode === 'create' ? 'Create event' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
