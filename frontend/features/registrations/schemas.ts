import { z } from 'zod';
import type { FormField } from '@/types/api';

// Mirrors backend RegistrationsService.validateAnswers exactly — built at
// runtime from the event's actual form so validation matches what the
// backend will accept.
export function buildAnswerSchema(fields: FormField[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const key = field.label;
    if (field.type === 'CHECKBOX') {
      // Native checkbox inputs bound via RHF register() yield a boolean —
      // validate the boolean directly. Converted to a 'true'/'false'
      // string only at submit time, to match the backend's answers shape.
      const checkbox = z.boolean();
      shape[key] = field.required
        ? checkbox.refine((v) => v === true, { message: `${field.label} is required` })
        : checkbox.optional();
      continue;
    }
    if (field.type === 'SELECT') {
      const options = field.options ?? [];
      const select = z.enum(options as [string, ...string[]]);
      shape[key] = field.required ? select : select.optional();
      continue;
    }
    // TEXT / TEXTAREA
    shape[key] = field.required
      ? z.string().min(1, `${field.label} is required`)
      : z.string().optional();
  }
  return z.object(shape);
}

// The committee-facing form-builder editor's own validation.
export const registrationFormSchema = z.object({
  fields: z
    .array(
      z
        .object({
          label: z.string().min(1, 'Label is required'),
          type: z.enum(['TEXT', 'TEXTAREA', 'SELECT', 'CHECKBOX']),
          required: z.boolean(),
          options: z.array(z.string()),
          order: z.number(),
        })
        .refine((f) => f.type !== 'SELECT' || f.options.length > 0, {
          message: 'SELECT fields need at least one option',
          path: ['options'],
        }),
    ),
});

export type RegistrationFormEditorInput = z.infer<typeof registrationFormSchema>;
