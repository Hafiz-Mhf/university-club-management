import { expect, it } from 'vitest';
import { achievementFormSchema } from '@/features/achievements/schema';

const base = {
  title: 'Best Club Award',
  description: 'Recognized for outstanding engagement.',
  year: '2025',
};

it('accepts a valid submission', () => {
  expect(achievementFormSchema.safeParse(base).success).toBe(true);
});

it('rejects an empty title', () => {
  expect(achievementFormSchema.safeParse({ ...base, title: '' }).success).toBe(false);
});

it('rejects an empty description', () => {
  expect(achievementFormSchema.safeParse({ ...base, description: '' }).success).toBe(false);
});

it('rejects a non-integer year', () => {
  expect(achievementFormSchema.safeParse({ ...base, year: '2025.5' }).success).toBe(false);
});

it('rejects an empty year', () => {
  expect(achievementFormSchema.safeParse({ ...base, year: '' }).success).toBe(false);
});
