import { PDFDocument } from 'pdf-lib';
import { CertificatePdfService } from './certificate-pdf.service';

// A minimal valid 1x1 transparent PNG, widely used as a test fixture.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('CertificatePdfService', () => {
  const service = new CertificatePdfService();
  const baseData = {
    participantFullName: 'Alex Tan',
    eventTitle: 'Tech Talk',
    eventDate: new Date('2026-08-01T10:00:00.000Z'),
    orgName: 'Coding Club',
    orgPrimaryColor: '#2563eb',
  };

  it('renders a valid single-page PDF without a logo', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: null });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders a valid PDF with a logo embedded', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: TINY_PNG });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('falls back to no logo (does not throw) when logo bytes are not a valid image', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: Buffer.from('not an image') });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });
});
