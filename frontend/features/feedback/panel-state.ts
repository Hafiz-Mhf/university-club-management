import type { AttendanceStatus, Event, FeedbackResponse } from '@/types/api';
import { isFeedbackWindowOpen } from './window';

export type FeedbackPanelState = 'hidden' | 'recap' | 'form' | 'window-closed';

export function resolveFeedbackPanelState(
  attendanceStatus: AttendanceStatus | undefined,
  feedback: FeedbackResponse | undefined,
  event: Event,
  now: Date,
): FeedbackPanelState {
  if (attendanceStatus !== 'PRESENT') return 'hidden';
  if (feedback) return 'recap';
  return isFeedbackWindowOpen(event, now) ? 'form' : 'window-closed';
}
