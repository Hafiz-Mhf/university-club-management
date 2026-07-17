import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE } from './certificate-generation.types';

@Injectable()
export class CertificateGenerationService {
  constructor(
    @InjectQueue(CERTIFICATE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueBatchForEvent(organizationId: string, eventId: string, actorUserId: string | undefined): Promise<void> {
    const attendees = await this.prisma.attendance.findMany({
      where: { eventId, organizationId, status: 'PRESENT' },
      select: { registration: { select: { userId: true } } },
    });
    const userIds = attendees.map((a) => a.registration.userId);
    if (userIds.length === 0) return;

    const existing = await this.prisma.certificate.findMany({
      where: { eventId, organizationId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingUserIds = new Set(existing.map((c) => c.userId));
    const pending = userIds.filter((id) => !existingUserIds.has(id));

    await Promise.all(
      pending.map((userId) =>
        this.queue.add(CERTIFICATE_GENERATE_JOB, { organizationId, eventId, userId, actorUserId }),
      ),
    );
  }
}
