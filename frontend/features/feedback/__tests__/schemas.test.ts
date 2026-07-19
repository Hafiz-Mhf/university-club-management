import { expect, it } from 'vitest';
import { feedbackFormSchema } from '@/features/feedback/schemas';

const base = { npsScore: 9, contentRating: 5, organizationRating: 5, venueRating: 5 };

it('accepts a valid submission with no comment', () => {
  expect(feedbackFormSchema.safeParse(base).success).toBe(true);
});

it('accepts a valid submission with a comment', () => {
  expect(feedbackFormSchema.safeParse({ ...base, comment: 'Great event!' }).success).toBe(true);
});

it('rejects npsScore outside 0-10', () => {
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: 11 }).success).toBe(false);
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: -1 }).success).toBe(false);
});

it('rejects a non-integer npsScore', () => {
  expect(feedbackFormSchema.safeParse({ ...base, npsScore: 7.5 }).success).toBe(false);
});

it('rejects ratings outside 1-5', () => {
  expect(feedbackFormSchema.safeParse({ ...base, contentRating: 0 }).success).toBe(false);
  expect(feedbackFormSchema.safeParse({ ...base, venueRating: 6 }).success).toBe(false);
});

it('rejects a comment over 2000 characters', () => {
  expect(feedbackFormSchema.safeParse({ ...base, comment: 'x'.repeat(2001) }).success).toBe(false);
});
