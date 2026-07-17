import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from 'pdf-lib';

export interface HandoverRosterEntry {
  fullName: string;
  role: string;
  history: { role: string; until: string }[];
}

export interface HandoverMinutesEntry {
  title: string;
  meetingDate: Date;
}

export interface HandoverAssetEntry {
  name: string;
  quantity: number;
  condition: string;
  location: string | null;
}

export interface HandoverFileEntry {
  title: string;
  category: string;
  originalFilename: string;
}

export interface HandoverEventEntry {
  title: string;
  startAt: Date;
  venue: string | null;
}

export interface HandoverPdfData {
  organizationName: string;
  generatedAt: Date;
  roster: HandoverRosterEntry[];
  minutes: HandoverMinutesEntry[];
  assets: HandoverAssetEntry[];
  files: HandoverFileEntry[];
  upcomingEvents: HandoverEventEntry[];
}

const PAGE_WIDTH = 595; // A4 portrait, points
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LINE_HEIGHT = 16;

@Injectable()
export class HandoverPdfService {
  async render(data: HandoverPdfData): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const heading = await doc.embedFont(StandardFonts.HelveticaBold);
    const body = await doc.embedFont(StandardFonts.Helvetica);

    const cursor: { page: PDFPage; y: number } = {
      page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      y: PAGE_HEIGHT - MARGIN,
    };

    const newPage = () => {
      cursor.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursor.y = PAGE_HEIGHT - MARGIN;
    };

    const drawLine = (text: string, font: PDFFont, size: number) => {
      if (cursor.y < MARGIN) newPage();
      cursor.page.drawText(text, { x: MARGIN, y: cursor.y, size, font });
      cursor.y -= LINE_HEIGHT;
    };

    const drawSection = (title: string, lines: string[]) => {
      cursor.y -= LINE_HEIGHT / 2;
      drawLine(title, heading, 14);
      const rows = lines.length > 0 ? lines : ['None'];
      for (const line of rows) drawLine(line, body, 10);
    };

    drawLine(`Committee Handover Pack — ${data.organizationName}`, heading, 18);
    drawLine(`Generated ${data.generatedAt.toISOString().slice(0, 10)}`, body, 10);

    drawSection(
      'Committee Roster',
      data.roster.map((m) => {
        const past = m.history.map((h) => h.role).join(', ');
        return past ? `${m.fullName} — ${m.role} (previously: ${past})` : `${m.fullName} — ${m.role}`;
      }),
    );

    drawSection(
      'Recent Meeting Minutes',
      data.minutes.map((m) => `${m.title} — ${m.meetingDate.toISOString().slice(0, 10)}`),
    );

    drawSection(
      'Asset Inventory',
      data.assets.map((a) => `${a.name} (x${a.quantity}, ${a.condition}${a.location ? `, ${a.location}` : ''})`),
    );

    drawSection(
      'Key Files (SOP / Reports)',
      data.files.map((f) => `${f.title} [${f.category}] — ${f.originalFilename}`),
    );

    drawSection(
      'Upcoming Events',
      data.upcomingEvents.map((e) => `${e.title} — ${e.startAt.toISOString().slice(0, 10)}${e.venue ? ` @ ${e.venue}` : ''}`),
    );

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }
}
