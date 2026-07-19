import { expect, it } from 'vitest';
import { eventFormSchema } from '@/features/events/schemas';

const base = {
  title: 'Design Crit', description: '', venue: '',
  startAt: '2026-08-01T10:00', endAt: '2026-08-01T12:00', capacity: '',
};

it('accepts a valid range', () => {
  expect(eventFormSchema.safeParse(base).success).toBe(true);
});

it('rejects endAt equal to startAt', () => {
  const r = eventFormSchema.safeParse({ ...base, endAt: base.startAt });
  expect(r.success).toBe(false);
});

it('rejects endAt before startAt', () => {
  const r = eventFormSchema.safeParse({ ...base, endAt: '2026-08-01T09:00' });
  expect(r.success).toBe(false);
});

it('rejects a title under 2 characters', () => {
  const r = eventFormSchema.safeParse({ ...base, title: 'A' });
  expect(r.success).toBe(false);
});

it('treats blank capacity as unlimited, accepts a positive integer, rejects zero', () => {
  expect(eventFormSchema.safeParse(base).success).toBe(true);
  expect(eventFormSchema.safeParse({ ...base, capacity: '50' }).success).toBe(true);
  expect(eventFormSchema.safeParse({ ...base, capacity: '0' }).success).toBe(false);
});

it('defaults requireFeedbackForCertificate to false when omitted', () => {
  const r = eventFormSchema.safeParse(base);
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.requireFeedbackForCertificate).toBe(false);
});

it('accepts an explicit true', () => {
  const r = eventFormSchema.safeParse({ ...base, requireFeedbackForCertificate: true });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.requireFeedbackForCertificate).toBe(true);
});
