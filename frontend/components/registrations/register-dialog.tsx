'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
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
import { buildAnswerSchema, type SavedFormField } from '@/features/registrations/schemas';
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
  // Fields read back from GET always carry the backend-assigned id.
  const fields = (formQuery.data?.fields ?? []) as SavedFormField[];

  const form = useForm<Record<string, unknown>>({
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
    // buildAnswerSchema validates CHECKBOX as boolean (native RHF checkbox
    // binding); the backend's answers shape is string-valued, so convert
    // here, after validation, before the request body is built.
    // Backend reads answers keyed by field id, not label — see SavedFormField.
    const answers: Record<string, string> = {};
    for (const field of fields) {
      const v = values[field.id];
      if (v === undefined || v === null || v === '') continue;
      answers[field.id] = typeof v === 'boolean' ? String(v) : String(v);
    }
    register.mutate(answers, {
      onSuccess: (registration) => {
        onOpenChange(false);
        // The dialog closes on success, so without this the only signal that
        // anything happened is a badge appearing further down the page —
        // and a waitlisted result would look identical to an approved one.
        if (registration.status === 'WAITLISTED') {
          toast.warning(`${eventTitle} is full — you're on the waitlist`, {
            description: "We'll email you if a spot opens up.",
          });
        } else {
          toast.success(`You're registered for ${eventTitle}`);
        }
      },
    });
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
            const error = form.formState.errors[field.id]?.message as string | undefined;
            return (
              <div key={field.id} className="flex flex-col gap-1.5">
                <Label htmlFor={field.id}>
                  {field.label}
                  {field.required && ' *'}
                </Label>
                {field.type === 'TEXT' && <Input id={field.id} {...form.register(field.id)} />}
                {field.type === 'TEXTAREA' && (
                  <Textarea id={field.id} rows={3} {...form.register(field.id)} />
                )}
                {field.type === 'SELECT' && (
                  <select
                    id={field.id}
                    {...form.register(field.id)}
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
                  <input id={field.id} type="checkbox" {...form.register(field.id)} />
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
