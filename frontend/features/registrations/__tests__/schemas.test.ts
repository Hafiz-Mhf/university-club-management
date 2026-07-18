import { describe, expect, it } from 'vitest';
import { buildAnswerSchema, registrationFormSchema } from '@/features/registrations/schemas';
import type { FormField } from '@/types/api';

describe('buildAnswerSchema', () => {
  it('accepts an empty object when there are no fields', () => {
    expect(buildAnswerSchema([]).safeParse({}).success).toBe(true);
  });

  it('requires a required TEXT field to be non-empty', () => {
    const fields: FormField[] = [{ label: 'Name', type: 'TEXT', required: true, order: 0 }];
    const schema = buildAnswerSchema(fields);
    expect(schema.safeParse({ Name: '' }).success).toBe(false);
    expect(schema.safeParse({ Name: 'Ada' }).success).toBe(true);
  });

  it('allows an optional field to be omitted', () => {
    const fields: FormField[] = [{ label: 'Notes', type: 'TEXTAREA', required: false, order: 0 }];
    expect(buildAnswerSchema(fields).safeParse({}).success).toBe(true);
  });

  it('requires a required CHECKBOX to be true', () => {
    const fields: FormField[] = [{ label: 'Agree', type: 'CHECKBOX', required: true, order: 0 }];
    const schema = buildAnswerSchema(fields);
    // Native checkbox inputs bound via RHF register() yield a boolean, not
    // a string — the schema validates the boolean directly; conversion to
    // the 'true'/'false' string the backend expects happens at submit time.
    expect(schema.safeParse({ Agree: false }).success).toBe(false);
    expect(schema.safeParse({ Agree: true }).success).toBe(true);
  });

  it('rejects a SELECT value outside its options', () => {
    const fields: FormField[] = [
      { label: 'Size', type: 'SELECT', required: true, options: ['S', 'M', 'L'], order: 0 },
    ];
    const schema = buildAnswerSchema(fields);
    expect(schema.safeParse({ Size: 'XL' }).success).toBe(false);
    expect(schema.safeParse({ Size: 'M' }).success).toBe(true);
  });
});

describe('registrationFormSchema', () => {
  const base = { fields: [{ label: 'Name', type: 'TEXT' as const, required: true, options: [], order: 0 }] };

  it('accepts a valid field list', () => {
    expect(registrationFormSchema.safeParse(base).success).toBe(true);
  });

  it('rejects a field with a blank label', () => {
    const r = registrationFormSchema.safeParse({ fields: [{ ...base.fields[0], label: '' }] });
    expect(r.success).toBe(false);
  });

  it('rejects a SELECT field with no options', () => {
    const r = registrationFormSchema.safeParse({
      fields: [{ label: 'Size', type: 'SELECT', required: true, options: [], order: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts an empty field list (form with zero fields)', () => {
    expect(registrationFormSchema.safeParse({ fields: [] }).success).toBe(true);
  });
});
