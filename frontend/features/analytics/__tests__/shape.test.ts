import { expect, it } from 'vitest';
import { toBarData, committeeActivityToBarData } from '@/features/analytics/shape';

it('maps a null group value to "Unspecified"', () => {
  const result = toBarData([{ value: null, count: 3 }]);
  expect(result).toEqual([{ label: 'Unspecified', value: 3 }]);
});

it('sorts groups descending by count', () => {
  const result = toBarData([
    { value: 'Engineering', count: 2 },
    { value: 'Science', count: 9 },
  ]);
  expect(result.map((r) => r.label)).toEqual(['Science', 'Engineering']);
});

it('maps committee activity rows to bar data, preserving backend order', () => {
  const result = committeeActivityToBarData([
    { fullName: 'Jane Doe', actionCount: 12 },
    { fullName: 'John Smith', actionCount: 5 },
  ]);
  expect(result).toEqual([
    { label: 'Jane Doe', value: 12 },
    { label: 'John Smith', value: 5 },
  ]);
});
