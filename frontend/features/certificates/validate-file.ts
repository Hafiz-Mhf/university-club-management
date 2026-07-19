const ALLOWED_MIME = 'application/pdf';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Mirrors the backend's own limits in certificates.service.ts
// (ALLOWED_MIME/MAX_FILE_BYTES) as a fast-fail UX check; the backend
// re-validates both regardless, so this is never the real security boundary.
export function validateCertificateFile(file: File): string | null {
  if (file.type !== ALLOWED_MIME) return 'Only PDF files are accepted';
  if (file.size > MAX_FILE_BYTES) return 'File exceeds the 5MB limit';
  return null;
}
