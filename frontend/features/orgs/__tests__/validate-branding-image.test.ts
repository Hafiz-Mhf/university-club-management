import { expect, it } from 'vitest';
import { validateBrandingImage } from '@/features/orgs/validate-branding-image';

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test', { type });
}

it('accepts a valid PNG under the size limit', () => {
  expect(validateBrandingImage(makeFile('image/png', 1024))).toBeNull();
});

it('accepts JPEG and WebP', () => {
  expect(validateBrandingImage(makeFile('image/jpeg', 1024))).toBeNull();
  expect(validateBrandingImage(makeFile('image/webp', 1024))).toBeNull();
});

it('rejects an unsupported MIME type', () => {
  expect(validateBrandingImage(makeFile('image/gif', 1024))).toBe('Only PNG, JPEG, or WebP images are accepted');
});

it('rejects a file over 2MB', () => {
  expect(validateBrandingImage(makeFile('image/png', 2 * 1024 * 1024 + 1))).toBe('File exceeds the 2MB limit');
});
