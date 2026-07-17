// WCAG relative-luminance contrast, used as a best-effort guard so an org's
// custom brand color can't render illegible controls. Not a full a11y audit —
// just "don't let yellow-on-white happen".

const CANVAS = { light: '#FAFAF8', dark: '#18171B' } as const;
const MIN_RATIO = 3;

function parseHex(color: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 0;
  const la = luminance(ra);
  const lb = luminance(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsBrandContrast(color: string, theme: 'light' | 'dark'): boolean {
  return contrastRatio(color, CANVAS[theme]) >= MIN_RATIO;
}
