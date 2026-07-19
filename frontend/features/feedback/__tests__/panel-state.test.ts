import { expect, it } from 'vitest';
import { resolveFeedbackPanelState } from '@/features/feedback/panel-state';
import type { Event, FeedbackResponse } from '@/types/api';

const event = { endAt: '2026-01-01T00:00:00.000Z' } as Event;
const submitted = { id: 'f1' } as FeedbackResponse;
const withinWindow = new Date('2026-01-05T00:00:00.000Z');
const afterWindow = new Date('2026-02-01T00:00:00.000Z');

it('is hidden for a non-attendee', () => {
  expect(resolveFeedbackPanelState(undefined, undefined, event, withinWindow)).toBe('hidden');
});

it('is hidden for someone marked ABSENT', () => {
  expect(resolveFeedbackPanelState('ABSENT', undefined, event, withinWindow)).toBe('hidden');
});

it('is hidden for someone only REGISTERED, never checked in', () => {
  expect(resolveFeedbackPanelState('REGISTERED', undefined, event, withinWindow)).toBe('hidden');
});

it('shows the recap once a PRESENT attendee has submitted, even after the window closes', () => {
  expect(resolveFeedbackPanelState('PRESENT', submitted, event, afterWindow)).toBe('recap');
});

it('shows the form for a PRESENT attendee within the window who has not submitted', () => {
  expect(resolveFeedbackPanelState('PRESENT', undefined, event, withinWindow)).toBe('form');
});

it('shows window-closed for a PRESENT attendee who never submitted and the window has closed', () => {
  expect(resolveFeedbackPanelState('PRESENT', undefined, event, afterWindow)).toBe('window-closed');
});
