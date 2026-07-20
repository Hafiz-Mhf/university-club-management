const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Mirrors backend/src/gallery/gallery.service.ts's own
// ALLOWED_MIME/MAX_FILE_BYTES as a fast-fail UX check; the backend
// re-validates both regardless.
export function validateGalleryImage(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Only PNG or JPEG images are accepted';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 10MB limit';
  return null;
}
