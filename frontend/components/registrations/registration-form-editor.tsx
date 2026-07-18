'use client';

import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, ChevronUp, Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  registrationFormSchema,
  type RegistrationFormEditorInput,
} from '@/features/registrations/schemas';
import {
  useRegistrationForm,
  useUpsertRegistrationForm,
} from '@/features/registrations/use-registration-form';
import { canEdit } from '@/features/events/status';
import { ApiError } from '@/lib/api';
import type { Event, FormFieldType } from '@/types/api';

const FIELD_TYPES: FormFieldType[] = ['TEXT', 'TEXTAREA', 'SELECT', 'CHECKBOX'];

export function RegistrationFormEditor({ orgId, event }: { orgId: string; event: Event }) {
  const formQuery = useRegistrationForm(orgId, event.id);
  const upsert = useUpsertRegistrationForm(orgId, event.id);
  const editable = canEdit(event.status);

  const editor = useForm<RegistrationFormEditorInput>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: { fields: [] },
  });
  const { fields, append, remove, move } = useFieldArray({ control: editor.control, name: 'fields' });

  useEffect(() => {
    if (formQuery.data) {
      editor.reset({
        fields: formQuery.data.fields.map((f) => ({ ...f, options: f.options ?? [] })),
      });
    }
  }, [formQuery.data, editor]);

  if (formQuery.isPending) return null;

  const topError =
    upsert.error instanceof ApiError
      ? upsert.error.message
      : upsert.error
        ? 'Something went wrong — please try again'
        : null;

  const submit = editor.handleSubmit((values) => {
    upsert.mutate(values.fields.map((f, i) => ({ ...f, order: i })));
  });

  if (!editable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-foreground-muted">
          Completed or cancelled events can&apos;t have their form edited.
        </p>
        {fields.length === 0 ? (
          <p className="text-sm text-foreground-muted">No custom form was set for this event.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {fields.map((f) => (
              <li key={f.id}>
                {f.label} — {f.type}
                {f.required && ' (required)'}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {topError && (
        <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {topError}
        </p>
      )}

      {fields.length === 0 && (
        <p className="text-sm text-foreground-muted">
          No custom form — participants can register with one click.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {fields.map((field, index) => {
          const rowType = editor.watch(`fields.${index}.type`);
          return (
            <div key={field.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input placeholder="Label" className="flex-1" {...editor.register(`fields.${index}.label`)} />
                <select
                  {...editor.register(`fields.${index}.type`)}
                  className="h-8 rounded-lg border border-input bg-surface px-2 text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Label className="flex shrink-0 items-center gap-1.5 text-sm">
                  <input type="checkbox" {...editor.register(`fields.${index}.required`)} />
                  Required
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  aria-label="Move up"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                  aria-label="Move down"
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label="Remove field"
                >
                  <X className="size-4" />
                </Button>
              </div>
              {rowType === 'SELECT' && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`options-${field.id}`} className="text-xs text-foreground-muted">
                    Options (comma-separated)
                  </Label>
                  <Input
                    id={`options-${field.id}`}
                    defaultValue={(field.options ?? []).join(', ')}
                    onBlur={(e) =>
                      editor.setValue(
                        `fields.${index}.options`,
                        e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                      )
                    }
                  />
                </div>
              )}
              {editor.formState.errors.fields?.[index] && (
                <p className="text-sm text-danger">
                  {editor.formState.errors.fields[index]?.label?.message ??
                    editor.formState.errors.fields[index]?.options?.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            append({ label: '', type: 'TEXT', required: false, options: [], order: fields.length })
          }
        >
          <Plus className="size-4" />
          Add field
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
