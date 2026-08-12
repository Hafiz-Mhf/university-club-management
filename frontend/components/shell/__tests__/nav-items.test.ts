import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, navLabel } from '@/components/shell/nav-items';

const dashboard = NAV_ITEMS.find((i) => i.segment === '')!;
const events = NAV_ITEMS.find((i) => i.segment === 'events')!;

describe('navLabel', () => {
  it('calls the org root a Dashboard for committee', () => {
    expect(navLabel(dashboard, true)).toBe('Dashboard');
  });

  it('calls the org root "My events" for participants, matching what that route renders', () => {
    expect(navLabel(dashboard, false)).toBe('My events');
  });

  it('falls back to the shared label when no participant wording is defined', () => {
    expect(navLabel(events, false)).toBe('Events');
    expect(navLabel(events, true)).toBe('Events');
  });
});

describe('NAV_ITEMS', () => {
  it('keeps the participant-facing domains visible to members', () => {
    const memberSegments = NAV_ITEMS.filter((i) => i.minTier === 'member').map((i) => i.segment);
    expect(memberSegments).toEqual(
      expect.arrayContaining(['attendance', 'certificates', 'feedback']),
    );
  });
});
