import { expect, it } from 'vitest';
import { chartDate, formatPercent } from '@/features/analytics/format';

it('rounds a ratio to a whole-number percentage', () => {
  expect(formatPercent(0.78)).toBe('78%');
});

it('handles 0 and 1', () => {
  expect(formatPercent(0)).toBe('0%');
  expect(formatPercent(1)).toBe('100%');
});

it('rounds to the nearest whole percent', () => {
  expect(formatPercent(0.755)).toBe('76%');
  expect(formatPercent(0.754)).toBe('75%');
});

it('renders an ISO day as a short human date', () => {
  expect(chartDate('2026-07-17')).toBe('17 Jul');
  expect(chartDate('2026-12-01')).toBe('1 Dec');
});

it('does not shift the day across timezones', () => {
  // A date-only string parsed as local time lands on the previous day west of
  // UTC; this must always read as the day the API sent.
  expect(chartDate('2026-01-01')).toBe('1 Jan');
});

it('passes through anything that is not an ISO day', () => {
  expect(chartDate('n/a')).toBe('n/a');
});
