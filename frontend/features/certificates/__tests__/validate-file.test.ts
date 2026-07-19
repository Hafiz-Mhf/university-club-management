import { describe, expect, it } from 'vitest';
import { validateCertificateFile } from '@/features/certificates/validate-file';

function makeFile(sizeBytes: number, type: string): File {
  return new File([new Uint8Array(sizeBytes)], 'cert.pdf', { type });
}

describe('validateCertificateFile', () => {
  it('accepts a PDF under 5MB', () => {
    expect(validateCertificateFile(makeFile(1024, 'application/pdf'))).toBeNull();
  });

  it('rejects a non-PDF mime type', () => {
    expect(validateCertificateFile(makeFile(1024, 'image/png')))
      .toBe('Only PDF files are accepted');
  });

  it('rejects a file over 5MB', () => {
    expect(validateCertificateFile(makeFile(5 * 1024 * 1024 + 1, 'application/pdf')))
      .toBe('File exceeds the 5MB limit');
  });
});
