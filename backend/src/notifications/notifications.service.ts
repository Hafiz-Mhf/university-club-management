import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MANAGE_EVENTS } from '../rbac/role-groups';
import { NOTIFICATION_QUEUE, NotificationJobName, reminderJobId } from './notifications.types';

const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  enqueueRegistrationApproved(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationApproved, { organizationId, registrationId });
  }

  enqueueRegistrationWaitlisted(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationWaitlisted, { organizationId, registrationId });
  }

  enqueueRegistrationRejected(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationRejected, { organizationId, registrationId });
  }

  enqueueRegistrationPromoted(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationPromoted, { organizationId, registrationId });
  }

  async enqueueNewRegistrationForCommittee(organizationId: string, registrationId: string): Promise<void> {
    const committee = await this.prisma.membership.findMany({
      where: { organizationId, role: { in: MANAGE_EVENTS }, status: 'ACTIVE' },
      select: { userId: true },
    });
    await Promise.all(
      committee.map((member) =>
        this.queue.add(NotificationJobName.RegistrationNew, {
          organizationId, registrationId, committeeUserId: member.userId,
        }),
      ),
    );
  }

  // No-op (no job added) when the 24h-before-start point has already passed —
  // e.g. an event published less than 24h before it starts. No immediate
  // reminder substitute; see spec's "Out of scope".
  scheduleEventReminder(organizationId: string, eventId: string, startAt: Date) {
    const delay = startAt.getTime() - REMINDER_LEAD_TIME_MS - Date.now();
    if (delay <= 0) return Promise.resolve(undefined);
    return this.queue.add(
      NotificationJobName.EventReminder,
      { organizationId, eventId },
      { jobId: reminderJobId(eventId), delay },
    );
  }

  cancelEventReminder(eventId: string) {
    return this.queue.remove(reminderJobId(eventId));
  }

  enqueueCertificateReady(organizationId: string, certificateId: string) {
    return this.queue.add(NotificationJobName.CertificateReady, { organizationId, certificateId });
  }
}
