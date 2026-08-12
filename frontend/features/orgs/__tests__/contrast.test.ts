import { describe, expect, it } from 'vitest';
import { brandContrastReport, contrastRatio, meetsBrandContrast } from '@/features/orgs/contrast';

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

describe('brandContrastReport', () => {
  it('names no failing theme for a color that works in both', () => {
    const report = brandContrastReport('#6E56CF');
    expect(report.meetsLight).toBe(true);
    expect(report.meetsDark).toBe(true);
    expect(report.failingThemes).toEqual([]);
  });

  it('names the theme that will silently drop the color', () => {
    // Yellow reads fine on the dark canvas, disappears on the light one.
    expect(brandContrastReport('#FFFF00').failingThemes).toEqual(['light']);
    // Near-black is the mirror case.
    expect(brandContrastReport('#0A0A0A').failingThemes).toEqual(['dark']);
  });

  // The two canvases sit at opposite ends of the lightness scale, so any
  // mid-tone that fails one necessarily clears the other. A valid color can
  // never be rejected in both themes — the warning copy relies on this.
  it('always leaves a valid color usable in at least one theme', () => {
    for (const color of ['#8A8A8A', '#FF0000', '#00FF00', '#123456', '#ABCDEF']) {
      expect(brandContrastReport(color).failingThemes.length).toBeLessThan(2);
    }
  });

  it('treats a malformed color as failing everywhere instead of throwing', () => {
    expect(brandContrastReport('nope').failingThemes).toEqual(['light', 'dark']);
  });
});
