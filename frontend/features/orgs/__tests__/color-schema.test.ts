import { expect, it } from 'vitest';
import { orgColorSchema } from '@/features/orgs/color-schema';

it('accepts valid 6-digit hex colors', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '#2563eb', secondaryColor: '#1e293b' }).success).toBe(true);
});

it('rejects a color missing the #', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '2563eb', secondaryColor: '#1e293b' }).success).toBe(false);
});

it('rejects a 3-digit shorthand hex', () => {
  expect(orgColorSchema.safeParse({ primaryColor: '#fff', secondaryColor: '#1e293b' }).success).toBe(false);
});

it('rejects a non-hex string', () => {
  expect(orgColorSchema.safeParse({ primaryColor: 'blue', secondaryColor: '#1e293b' }).success).toBe(false);
});
