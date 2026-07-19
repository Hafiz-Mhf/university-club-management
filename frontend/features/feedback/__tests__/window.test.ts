import { expect, it } from 'vitest';
import { isFeedbackWindowOpen, FEEDBACK_WINDOW_MS } from '@/features/feedback/window';
import type { Event } from '@/types/api';

const event = {
  endAt: '2026-01-01T00:00:00.000Z',
} as Event;

it('is open right after the event ends', () => {
  expect(isFeedbackWindowOpen(event, new Date('2026-01-01T00:00:01.000Z'))).toBe(true);
});

it('is open exactly at the 14-day boundary', () => {
  const boundary = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS);
  expect(isFeedbackWindowOpen(event, boundary)).toBe(true);
});

it('is closed one second past the boundary', () => {
  const pastBoundary = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS + 1000);
  expect(isFeedbackWindowOpen(event, pastBoundary)).toBe(false);
});
