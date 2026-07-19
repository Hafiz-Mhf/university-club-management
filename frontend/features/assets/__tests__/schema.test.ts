import { expect, it } from 'vitest';
import { assetFormSchema } from '@/features/assets/schema';

const base = { name: 'Projector', quantity: '2', condition: 'GOOD', location: '', notes: '' };

it('accepts a valid submission', () => {
  expect(assetFormSchema.safeParse(base).success).toBe(true);
});

it('rejects an empty name', () => {
  expect(assetFormSchema.safeParse({ ...base, name: '' }).success).toBe(false);
});

it('rejects a non-integer quantity', () => {
  expect(assetFormSchema.safeParse({ ...base, quantity: '1.5' }).success).toBe(false);
});

it('rejects a zero or negative quantity', () => {
  expect(assetFormSchema.safeParse({ ...base, quantity: '0' }).success).toBe(false);
  expect(assetFormSchema.safeParse({ ...base, quantity: '-1' }).success).toBe(false);
});

it('rejects a condition value outside the enum', () => {
  expect(assetFormSchema.safeParse({ ...base, condition: 'BROKEN' }).success).toBe(false);
});

it('accepts missing location and notes', () => {
  expect(assetFormSchema.safeParse({ name: 'Speaker', quantity: '1', condition: 'GOOD' }).success)
    .toBe(true);
});
