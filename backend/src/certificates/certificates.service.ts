import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = 'application/pdf';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    organizationId: string,
    eventId: string,
    targetUserId: string,
    file: UploadedFile | undefined,
    actorUserId: string,
  ) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    if (!file) throw new BadRequestException('A file is required');
    if (file.mimetype !== ALLOWED_MIME) throw new BadRequestException('Only PDF files are accepted');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('File exceeds the 5MB limit');

    const attendance = await this.prisma.attendance.findFirst({
      where: { eventId, organizationId, status: 'PRESENT', registration: { userId: targetUserId } },
    });
    if (!attendance) throw new BadRequestException('Target user was not marked present for this event');

    // Pre-check before any storage write: the storage key is deterministic
    // and shared across every upload attempt for this event+user, so a
    // duplicate write here would silently overwrite the first (already
    // successful) certificate's bytes. See the design spec's upload
    // validation order for the full reasoning.
    const existing = await this.prisma.certificate.findFirst({ where: { eventId, organizationId, userId: targetUserId } });
    if (existing) throw new ConflictException('A certificate already exists for this person and event');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const usage = await this.prisma.certificate.aggregate({
      where: { organizationId },
      _sum: { fileSizeBytes: true },
    });
    const usedBytes = usage._sum.fileSizeBytes ?? 0;
    const quotaBytes = organization!.storageQuotaMb * 1024 * 1024;
    if (usedBytes + file.size > quotaBytes) {
      throw new BadRequestException('Organization storage quota exceeded');
    }

    const storageKey = `certificates/${organizationId}/${eventId}/${targetUserId}.pdf`;
    await this.storage.putObject(storageKey, file.buffer, ALLOWED_MIME);

    try {
      // Create + audit are atomic, matching every other mutating service.
      // If the audit insert fails and rolls back the create, the storage
      // object is left at the deterministic key with no DB row — that is
      // self-healing: a retry passes the pre-check and overwrites it.
      return await this.prisma.$transaction(async (tx) => {
        const certificate = await tx.certificate.create({
          data: {
            eventId, organizationId, userId: targetUserId,
            storageKey, fileSizeBytes: file.size, uploadedByUserId: actorUserId,
          },
        });
        await this.audit.record({
          organizationId, actorUserId, action: 'certificate.upload',
          targetType: 'Certificate', targetId: certificate.id,
          metadata: { certificateId: certificate.id, eventId, userId: targetUserId },
        }, tx);
        return certificate;
      });
    } catch (error) {
      // Narrow residual race the pre-check above doesn't fully close (two
      // uploads for the same event+user landing within the same instant).
      // Do NOT delete the storage object here — the key is shared, and a
      // losing request can't tell its own bytes apart from the winner's.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A certificate already exists for this person and event');
      }
      throw error;
    }
  }

  list(organizationId: string, eventId: string) {
    return this.prisma.certificate.findMany({
      where: { eventId, organizationId },
      select: { id: true, userId: true, fileSizeBytes: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMine(organizationId: string, eventId: string, userId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { eventId, organizationId, userId } });
    if (!certificate) throw new NotFoundException('No certificate found');
    const downloadUrl = await this.storage.getSignedDownloadUrl(certificate.storageKey, SIGNED_URL_TTL_SECONDS);
    await this.trackDownload(certificate.id, userId);
    return { ...certificate, downloadUrl };
  }

  async download(organizationId: string, eventId: string, certificateId: string, actorUserId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { id: certificateId, organizationId, eventId } });
    if (!certificate) throw new NotFoundException('Certificate not found in this event');
    const downloadUrl = await this.storage.getSignedDownloadUrl(certificate.storageKey, SIGNED_URL_TTL_SECONDS);
    await this.trackDownload(certificate.id, actorUserId);
    return { ...certificate, downloadUrl };
  }

  // Best-effort: a signed URL has already been minted and handed to the
  // caller by the time this runs. A tracking-write hiccup must never turn
  // a successful download into a 500.
  private async trackDownload(certificateId: string, userId: string) {
    try {
      await this.prisma.certificateDownload.create({ data: { certificateId, userId } });
    } catch (error) {
      this.logger.warn(`Failed to record certificate download (certificateId=${certificateId}): ${error}`);
    }
  }

  async remove(organizationId: string, eventId: string, certificateId: string, actorUserId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { id: certificateId, organizationId, eventId } });
    if (!certificate) throw new NotFoundException('Certificate not found in this event');

    // DB-first ordering: if the storage delete below fails, we only leave an
    // orphaned object at the deterministic key, which self-heals on re-upload
    // (upload overwrites the same key). The reverse order (storage first)
    // could leave a dangling DB row that blocks re-upload with no self-heal.
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.certificate.delete({ where: { id: certificateId, organizationId } });
        await this.audit.record({
          organizationId, actorUserId, action: 'certificate.delete',
          targetType: 'Certificate', targetId: certificateId,
          metadata: { certificateId, eventId, userId: certificate.userId },
        }, tx);
      });
    } catch (error) {
      // A lost concurrent double-delete (P2025) rolls back its own audit
      // write with the transaction — no audit row for a delete that didn't happen.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Certificate not found in this event');
      }
      throw error;
    }

    await this.storage.deleteObject(certificate.storageKey);
    return { removed: true as const };
  }
}
