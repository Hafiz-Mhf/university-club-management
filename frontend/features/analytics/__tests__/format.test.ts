import { expect, it } from 'vitest';
import { formatPercent } from '@/features/analytics/format';

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
