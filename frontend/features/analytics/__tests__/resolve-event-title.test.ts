import { expect, it } from 'vitest';
import { resolveEventTitle } from '@/features/analytics/resolve-event-title';
import type { Event } from '@/types/api';

const event = { id: 'e1', title: 'Orientation Day' } as Event;

it('resolves a known event id to its title', () => {
  expect(resolveEventTitle('e1', [event])).toBe('Orientation Day');
});

it('falls back to the raw id when the event is not in the list', () => {
  expect(resolveEventTitle('missing', [event])).toBe('missing');
});
