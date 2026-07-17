import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';
import {
  CertificateJobPayload,
  CommitteeNewRegistrationJobPayload,
  EventReminderJobPayload,
  NOTIFICATION_QUEUE,
  NotificationJobName,
  RegistrationJobPayload,
} from './notifications.types';
import {
  certificateReadyEmail,
  committeeNewRegistrationEmail,
  eventReminderEmail,
  registrationApprovedEmail,
  registrationPromotedEmail,
  registrationRejectedEmail,
  registrationWaitlistedEmail,
} from './templates';

type OutcomeTemplateFn = (data: { fullName: string; eventTitle: string }) => { subject: string; text: string };

const OUTCOME_TEMPLATES: Partial<Record<NotificationJobName, OutcomeTemplateFn>> = {
  [NotificationJobName.RegistrationApproved]: registrationApprovedEmail,
  [NotificationJobName.RegistrationWaitlisted]: registrationWaitlistedEmail,
  [NotificationJobName.RegistrationRejected]: registrationRejectedEmail,
  [NotificationJobName.RegistrationPromoted]: registrationPromotedEmail,
};

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const templateFn = OUTCOME_TEMPLATES[job.name as NotificationJobName];
    if (templateFn) return this.sendRegistrationOutcomeEmail(job, templateFn);
    if (job.name === NotificationJobName.RegistrationNew) return this.sendCommitteeNewRegistrationEmail(job);
    if (job.name === NotificationJobName.EventReminder) return this.sendEventReminders(job);
    if (job.name === NotificationJobName.CertificateReady) return this.sendCertificateReadyEmail(job);
  }

  private async sendRegistrationOutcomeEmail(job: Job, templateFn: OutcomeTemplateFn): Promise<void> {
    const { organizationId, registrationId } = job.data as RegistrationJobPayload;
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { user: { select: { email: true, fullName: true } }, event: { select: { title: true } } },
    });
    if (!registration) return;

    const { subject, text } = templateFn({ fullName: registration.user.fullName, eventTitle: registration.event.title });
    await this.mailer.sendMail({ to: registration.user.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Registration', targetId: registrationId,
      metadata: { kind: job.name },
    });
  }

  private async sendCommitteeNewRegistrationEmail(job: Job): Promise<void> {
    const { organizationId, registrationId, committeeUserId } = job.data as CommitteeNewRegistrationJobPayload;
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { user: { select: { fullName: true } }, event: { select: { title: true } } },
    });
    if (!registration) return;
    const committeeUser = await this.prisma.user.findUnique({ where: { id: committeeUserId }, select: { email: true } });
    if (!committeeUser) return;

    const { subject, text } = committeeNewRegistrationEmail({
      eventTitle: registration.event.title,
      registrantFullName: registration.user.fullName,
      status: registration.status,
    });
    await this.mailer.sendMail({ to: committeeUser.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Registration', targetId: registrationId,
      metadata: { kind: job.name },
    });
  }

  private async sendEventReminders(job: Job): Promise<void> {
    const { organizationId, eventId } = job.data as EventReminderJobPayload;
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PUBLISHED') return;

    const registrations = await this.prisma.registration.findMany({
      where: { eventId, organizationId, status: 'APPROVED' },
      include: { user: { select: { email: true, fullName: true } } },
    });
    for (const registration of registrations) {
      const { subject, text } = eventReminderEmail({
        fullName: registration.user.fullName, eventTitle: event.title, venue: event.venue, startAt: event.startAt,
      });
      await this.mailer.sendMail({ to: registration.user.email, subject, text });
      await this.audit.record({
        organizationId, action: 'notification.email',
        targetType: 'Registration', targetId: registration.id,
        metadata: { kind: job.name },
      });
    }
  }

  private async sendCertificateReadyEmail(job: Job): Promise<void> {
    const { organizationId, certificateId } = job.data as CertificateJobPayload;
    const certificate = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { user: { select: { email: true, fullName: true } }, event: { select: { title: true } } },
    });
    if (!certificate) return;

    const { subject, text } = certificateReadyEmail({ fullName: certificate.user.fullName, eventTitle: certificate.event.title });
    await this.mailer.sendMail({ to: certificate.user.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Certificate', targetId: certificateId,
      metadata: { kind: job.name },
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Notification job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
