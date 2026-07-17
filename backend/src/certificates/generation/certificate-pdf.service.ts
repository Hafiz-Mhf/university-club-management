import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

export interface CertificateRenderData {
  participantFullName: string;
  eventTitle: string;
  eventDate: Date;
  orgName: string;
  orgPrimaryColor: string;
  orgLogoBytes: Buffer | null;
}

const PAGE_WIDTH = 842; // A4 landscape, points
const PAGE_HEIGHT = 595;

@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);

  async render(data: CertificateRenderData): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const heading = await doc.embedFont(StandardFonts.HelveticaBold);
    const body = await doc.embedFont(StandardFonts.Helvetica);
    const accent = hexToRgb(data.orgPrimaryColor);
    const centerX = (text: string, font: PDFFont, size: number) =>
      PAGE_WIDTH / 2 - font.widthOfTextAtSize(text, size) / 2;

    page.drawRectangle({
      x: 20, y: 20, width: PAGE_WIDTH - 40, height: PAGE_HEIGHT - 40,
      borderColor: accent, borderWidth: 4,
    });

    if (data.orgLogoBytes) {
      const image = await this.embedLogo(doc, data.orgLogoBytes);
      if (image) {
        const logoWidth = 80;
        const logoHeight = (image.height / image.width) * logoWidth;
        page.drawImage(image, {
          x: PAGE_WIDTH / 2 - logoWidth / 2, y: PAGE_HEIGHT - 110,
          width: logoWidth, height: logoHeight,
        });
      }
    }

    const title = 'Certificate of Participation';
    page.drawText(title, { x: centerX(title, heading, 28), y: PAGE_HEIGHT - 180, size: 28, font: heading, color: accent });

    page.drawText(data.orgName, { x: centerX(data.orgName, body, 14), y: PAGE_HEIGHT - 210, size: 14, font: body });

    const intro = 'This certifies that';
    page.drawText(intro, { x: centerX(intro, body, 12), y: PAGE_HEIGHT - 260, size: 12, font: body });

    page.drawText(data.participantFullName, {
      x: centerX(data.participantFullName, heading, 22), y: PAGE_HEIGHT - 300, size: 22, font: heading,
    });

    const participation = `participated in "${data.eventTitle}"`;
    page.drawText(participation, { x: centerX(participation, body, 14), y: PAGE_HEIGHT - 335, size: 14, font: body });

    const dateLine = `on ${data.eventDate.toISOString().slice(0, 10)}`;
    page.drawText(dateLine, { x: centerX(dateLine, body, 12), y: PAGE_HEIGHT - 360, size: 12, font: body });

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  // Tries PNG then JPEG; on failure of both, logs and returns null so the
  // certificate still renders without an image rather than failing the job.
  private async embedLogo(doc: PDFDocument, bytes: Buffer) {
    try {
      return await doc.embedPng(bytes);
    } catch {
      try {
        return await doc.embedJpg(bytes);
      } catch (error) {
        this.logger.warn(`Failed to embed org logo in certificate: ${error}`);
        return null;
      }
    }
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16) / 255;
  const g = parseInt(normalized.substring(2, 4), 16) / 255;
  const b = parseInt(normalized.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}
