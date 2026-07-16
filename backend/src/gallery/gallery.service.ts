import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(organizationId: string, caption: string | undefined, file: UploadedFile | undefined, actorUserId: string) {
    if (!file) throw new BadRequestException('A file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Unsupported file type');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('File exceeds the 10MB limit');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const [certUsage, fileUsage, photoUsage] = await Promise.all([
      this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.orgFile.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.galleryPhoto.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
    ]);
    const usedBytes = (certUsage._sum.fileSizeBytes ?? 0) + (fileUsage._sum.fileSizeBytes ?? 0) + (photoUsage._sum.fileSizeBytes ?? 0);
    const quotaBytes = organization!.storageQuotaMb * 1024 * 1024;
    if (usedBytes + file.size > quotaBytes) {
      throw new BadRequestException('Organization storage quota exceeded');
    }

    const ext = EXT_BY_MIME[file.mimetype];
    const storageKey = `gallery/${organizationId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(storageKey, file.buffer, file.mimetype);

    return this.prisma.$transaction(async (tx) => {
      const photo = await tx.galleryPhoto.create({
        data: {
          organizationId, storageKey, caption,
          fileSizeBytes: file.size, uploadedByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'gallery.upload',
        targetType: 'GalleryPhoto', targetId: photo.id,
        metadata: { photoId: photo.id, caption },
      }, tx);
      return photo;
    });
  }
}
