import { PDFDocument } from 'pdf-lib';
import { HandoverPdfService, HandoverPdfData } from './handover-pdf.service';

describe('HandoverPdfService', () => {
  const service = new HandoverPdfService();

  const emptyData: HandoverPdfData = {
    organizationName: 'Coding Club',
    generatedAt: new Date('2026-07-17T00:00:00.000Z'),
    roster: [],
    minutes: [],
    assets: [],
    files: [],
    upcomingEvents: [],
  };

  it('renders a valid PDF with at least one page when every section is empty', async () => {
    const buffer = await service.render(emptyData);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a valid PDF with populated sections', async () => {
    const buffer = await service.render({
      ...emptyData,
      roster: [
        { fullName: 'Alex Tan', role: 'PRESIDENT', history: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }] },
        { fullName: 'Sam Lee', role: 'SECRETARY', history: [] },
      ],
      minutes: [{ title: 'Weekly Sync', meetingDate: new Date('2026-07-01T00:00:00.000Z') }],
      assets: [{ name: 'Projector', quantity: 2, condition: 'GOOD', location: 'Storage Room' }],
      files: [{ title: 'Onboarding SOP', category: 'SOP', originalFilename: 'onboarding.pdf' }],
      upcomingEvents: [{ title: 'Tech Talk', startAt: new Date('2026-08-01T00:00:00.000Z'), venue: 'Hall A' }],
    });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('breaks onto additional pages when a section has many entries', async () => {
    const roster = Array.from({ length: 120 }, (_, i) => ({
      fullName: `Member ${i}`,
      role: 'COMMITTEE',
      history: [],
    }));
    const buffer = await service.render({ ...emptyData, roster });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('does not throw when an asset has a null location', async () => {
    const buffer = await service.render({
      ...emptyData,
      assets: [{ name: 'Ladder', quantity: 1, condition: 'DAMAGED', location: null }],
    });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
