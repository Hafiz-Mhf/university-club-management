import { expect, it } from 'vitest';
import { validateGalleryImage } from '@/features/gallery/validate-gallery-image';

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test', { type });
}

it('accepts a valid PNG under the size limit', () => {
  expect(validateGalleryImage(makeFile('image/png', 1024))).toBeNull();
});

it('accepts a valid JPEG', () => {
  expect(validateGalleryImage(makeFile('image/jpeg', 1024))).toBeNull();
});

it('rejects an unsupported MIME type', () => {
  expect(validateGalleryImage(makeFile('image/webp', 1024))).toBe('Only PNG or JPEG images are accepted');
});

it('rejects a file over 10MB', () => {
  expect(validateGalleryImage(makeFile('image/png', 10 * 1024 * 1024 + 1))).toBe('File exceeds the 10MB limit');
});
