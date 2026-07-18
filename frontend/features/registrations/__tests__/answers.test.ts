import { describe, expect, it } from 'vitest';
import { formatAnswers } from '@/features/registrations/answers';
import type { FormField } from '@/types/api';

const fields: FormField[] = [
  { label: 'Dietary needs', type: 'TEXT', required: false, order: 0 },
  { label: 'Size', type: 'SELECT', required: true, options: ['S', 'M'], order: 1 },
];

describe('formatAnswers', () => {
  it('returns an empty array for null answers', () => {
    expect(formatAnswers(null, fields)).toEqual([]);
  });

  it('maps answer keys to field labels in field order', () => {
    const result = formatAnswers({ Size: 'M', 'Dietary needs': 'Vegan' }, fields);
    expect(result).toEqual([
      { label: 'Dietary needs', value: 'Vegan' },
      { label: 'Size', value: 'M' },
    ]);
  });

  it('joins array answers with a comma', () => {
    const result = formatAnswers({ Size: ['S', 'M'] as unknown as string }, fields);
    expect(result).toEqual([{ label: 'Size', value: 'S, M' }]);
  });

  it('falls back to the raw key when the form is missing (deleted since submission)', () => {
    const result = formatAnswers({ Unknown: 'x' }, undefined);
    expect(result).toEqual([{ label: 'Unknown', value: 'x' }]);
  });

  it('skips answer keys that no longer match any field', () => {
    const result = formatAnswers({ Size: 'M', Stale: 'y' }, fields);
    expect(result).toEqual([{ label: 'Size', value: 'M' }, { label: 'Stale', value: 'y' }]);
  });
});
