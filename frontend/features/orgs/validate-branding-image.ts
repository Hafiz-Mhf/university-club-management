const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Mirrors backend/src/organizations/organizations.service.ts's own
// ALLOWED_IMAGE_MIME/MAX_IMAGE_BYTES as a fast-fail UX check; the backend
// re-validates both regardless.
export function validateBrandingImage(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Only PNG, JPEG, or WebP images are accepted';
  if (file.size > MAX_IMAGE_BYTES) return 'File exceeds the 2MB limit';
  return null;
}
