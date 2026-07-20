import { expect, it } from 'vitest';
import { orgProfileSchema } from '@/features/orgs/profile-schema';

const base = {
  name: 'Chess Club',
  description: 'We play chess.',
  socialLinks: [{ key: 'instagram', value: 'https://instagram.com/chessclub' }],
  advisors: [{ name: 'Dr. Tan' }],
};

it('accepts a valid submission', () => {
  expect(orgProfileSchema.safeParse(base).success).toBe(true);
});

it('accepts empty socialLinks and advisors arrays', () => {
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [], advisors: [] }).success).toBe(true);
});

it('rejects a name under 2 characters', () => {
  expect(orgProfileSchema.safeParse({ ...base, name: 'A' }).success).toBe(false);
});

it('rejects a description over 2000 characters', () => {
  expect(orgProfileSchema.safeParse({ ...base, description: 'x'.repeat(2001) }).success).toBe(false);
});

it('rejects a socialLinks row with an empty key or value', () => {
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [{ key: '', value: 'x' }] }).success).toBe(false);
  expect(orgProfileSchema.safeParse({ ...base, socialLinks: [{ key: 'x', value: '' }] }).success).toBe(false);
});

it('rejects an advisors row with an empty name', () => {
  expect(orgProfileSchema.safeParse({ ...base, advisors: [{ name: '' }] }).success).toBe(false);
});
