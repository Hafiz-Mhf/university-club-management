import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FileCategory } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

type UploadedFile = { mimetype: string; size: number; buffer: Buffer; originalname: string };

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    organizationId: string,
    title: string,
    category: FileCategory,
    file: UploadedFile | undefined,
    actorUserId: string,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Unsupported file type');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('File exceeds the 20MB limit');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const [certUsage, fileUsage] = await Promise.all([
      this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.orgFile.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
    ]);
    const usedBytes = (certUsage._sum.fileSizeBytes ?? 0) + (fileUsage._sum.fileSizeBytes ?? 0);
    const quotaBytes = organization!.storageQuotaMb * 1024 * 1024;
    if (usedBytes + file.size > quotaBytes) {
      throw new BadRequestException('Organization storage quota exceeded');
    }

    const ext = EXT_BY_MIME[file.mimetype];
    const storageKey = `org-files/${organizationId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(storageKey, file.buffer, file.mimetype);

    return this.prisma.$transaction(async (tx) => {
      const orgFile = await tx.orgFile.create({
        data: {
          organizationId, title, category, storageKey,
          originalFilename: file.originalname, mimeType: file.mimetype,
          fileSizeBytes: file.size, uploadedByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'file.upload',
        targetType: 'OrgFile', targetId: orgFile.id,
        metadata: { fileId: orgFile.id, title, category },
      }, tx);
      return orgFile;
    });
  }

  list(organizationId: string, category?: string) {
    const validCategory = category && Object.values(FileCategory).includes(category as FileCategory)
      ? (category as FileCategory)
      : undefined;
    return this.prisma.orgFile.findMany({
      where: { organizationId, ...(validCategory && { category: validCategory }) },
      select: {
        id: true, title: true, category: true, originalFilename: true,
        mimeType: true, fileSizeBytes: true, uploadedByUserId: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(organizationId: string, fileId: string) {
    const orgFile = await this.prisma.orgFile.findFirst({ where: { id: fileId, organizationId } });
    if (!orgFile) throw new NotFoundException('File not found in this organization');
    const downloadUrl = await this.storage.getSignedDownloadUrl(orgFile.storageKey, SIGNED_URL_TTL_SECONDS);
    return { downloadUrl };
  }

  async remove(organizationId: string, fileId: string, actorUserId: string) {
    const orgFile = await this.prisma.orgFile.findFirst({ where: { id: fileId, organizationId } });
    if (!orgFile) throw new NotFoundException('File not found in this organization');

    // DB-first ordering: a failed storage delete after commit leaves only an
    // orphaned MinIO object nothing references — harmless. Reverse order
    // could leave a DB row pointing at a deleted object.
    await this.prisma.$transaction(async (tx) => {
      await tx.orgFile.delete({ where: { id: fileId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'file.delete',
        targetType: 'OrgFile', targetId: fileId,
        metadata: { fileId, title: orgFile.title, category: orgFile.category },
      }, tx);
    });

    await this.storage.deleteObject(orgFile.storageKey);
    return { removed: true as const };
  }
}
