import type { Event } from '@/types/api';

// Mirrors backend/src/feedback/feedback.constants.ts FEEDBACK_WINDOW_MS —
// no shared package between frontend/backend anywhere in this codebase.
export const FEEDBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isFeedbackWindowOpen(event: Event, now: Date): boolean {
  const closesAt = new Date(new Date(event.endAt).getTime() + FEEDBACK_WINDOW_MS);
  return now <= closesAt;
}
