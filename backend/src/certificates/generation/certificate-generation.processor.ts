import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE, CertificateGenerateJobPayload } from './certificate-generation.types';

@Processor(CERTIFICATE_QUEUE)
export class CertificateGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificateGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: CertificatePdfService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== CERTIFICATE_GENERATE_JOB) return;
    const { organizationId, eventId, userId, actorUserId } = job.data as CertificateGenerateJobPayload;

    // Race guard: a manual upload (or a duplicate job) could have created
    // the certificate between enqueue and now.
    const alreadyExists = await this.prisma.certificate.findFirst({ where: { eventId, organizationId, userId } });
    if (alreadyExists) return;

    const [event, organization, user] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: eventId } }),
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!event || !organization || !user) return;

    let orgLogoBytes: Buffer | null = null;
    if (organization.logoKey) {
      try {
        orgLogoBytes = await this.storage.getObject(organization.logoKey);
      } catch (error) {
        this.logger.warn(`Failed to fetch org logo (key=${organization.logoKey}): ${error}`);
      }
    }

    const buffer = await this.pdf.render({
      participantFullName: user.fullName,
      eventTitle: event.title,
      eventDate: event.startAt,
      orgName: organization.name,
      orgPrimaryColor: organization.primaryColor,
      orgLogoBytes,
    });

    // Same quota check as CertificatesService.upload() — sums only
    // Certificate.fileSizeBytes for this org, matching upload()'s existing
    // (not cross-model) quota query exactly.
    const usage = await this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } });
    const usedBytes = usage._sum.fileSizeBytes ?? 0;
    const quotaBytes = organization.storageQuotaMb * 1024 * 1024;
    if (usedBytes + buffer.length > quotaBytes) {
      this.logger.warn(`Skipping certificate generation for user=${userId} event=${eventId}: storage quota exceeded`);
      return;
    }

    const storageKey = `certificates/${organizationId}/${eventId}/${userId}.pdf`;
    await this.storage.putObject(storageKey, buffer, 'application/pdf');

    const certificate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.certificate.create({
        data: {
          eventId, organizationId, userId, storageKey,
          fileSizeBytes: buffer.length, uploadedByUserId: actorUserId ?? userId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'certificate.generate',
        targetType: 'Certificate', targetId: created.id,
        metadata: { certificateId: created.id, eventId, userId },
      }, tx);
      return created;
    });

    await this.notifications.enqueueCertificateReady(organizationId, certificate.id);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Certificate generation job ${job.id} failed: ${error.message}`);
  }
}
