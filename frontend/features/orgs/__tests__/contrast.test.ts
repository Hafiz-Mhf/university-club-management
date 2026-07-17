import { describe, expect, it } from 'vitest';
import { contrastRatio, meetsBrandContrast } from '@/features/orgs/contrast';

describe('contrast', () => {
  it('computes known ratios', () => {
    // Black on white is the canonical 21:1.
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    // Same color is 1:1.
    expect(contrastRatio('#6e56cf', '#6e56cf')).toBe(1);
  });

  it('platform violet passes 3:1 against the light canvas', () => {
    expect(contrastRatio('#6E56CF', '#FAFAF8')).toBeGreaterThanOrEqual(3);
    expect(meetsBrandContrast('#6E56CF', 'light')).toBe(true);
  });

  it('yellow fails against the light canvas but passes against dark', () => {
    expect(meetsBrandContrast('#FFFF00', 'light')).toBe(false);
    expect(meetsBrandContrast('#FFFF00', 'dark')).toBe(true);
  });

  it('rejects malformed colors instead of throwing', () => {
    expect(meetsBrandContrast('not-a-color', 'light')).toBe(false);
    expect(meetsBrandContrast('', 'dark')).toBe(false);
  });
});
