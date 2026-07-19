import { describe, expect, it } from 'vitest';
import { validateUploadFile } from '../validate-upload-file';

function makeFile(type: string, sizeBytes: number): File {
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], 'test-file', { type });
}

describe('validateUploadFile', () => {
  it('accepts an allowed MIME type under the size limit', () => {
    expect(validateUploadFile(makeFile('application/pdf', 1024))).toBeNull();
  });

  it('rejects an unsupported MIME type', () => {
    expect(validateUploadFile(makeFile('video/mp4', 1024))).toBe('Unsupported file type');
  });

  it('rejects a file over the 20MB limit', () => {
    expect(validateUploadFile(makeFile('application/pdf', 21 * 1024 * 1024)))
      .toBe('File exceeds the 20MB limit');
  });
});
