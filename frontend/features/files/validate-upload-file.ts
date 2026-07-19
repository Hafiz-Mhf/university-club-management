const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// Mirrors backend/src/files/files.service.ts's own ALLOWED_MIME/MAX_FILE_BYTES
// as a fast-fail UX check; the backend re-validates both regardless.
export function validateUploadFile(file: File): string | null {
  if (!ALLOWED_MIME.has(file.type)) return 'Unsupported file type';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 20MB limit';
  return null;
}
