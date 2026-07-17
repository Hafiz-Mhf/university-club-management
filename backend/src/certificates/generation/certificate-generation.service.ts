import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { FEEDBACK_WINDOW_MS } from '../../feedback/feedback.constants';
import {
  CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB,
  CERTIFICATE_GENERATE_JOB,
  CERTIFICATE_QUEUE,
  feedbackWindowCloseJobId,
} from './certificate-generation.types';

export interface EnqueueBatchOpts {
  onlyWithFeedback?: boolean;
}

@Injectable()
export class CertificateGenerationService {
  constructor(
    @InjectQueue(CERTIFICATE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueBatchForEvent(
    organizationId: string,
    eventId: string,
    actorUserId: string | undefined,
    opts?: EnqueueBatchOpts,
  ): Promise<void> {
    const attendees = await this.prisma.attendance.findMany({
      where: { eventId, organizationId, status: 'PRESENT' },
      select: { registration: { select: { userId: true } } },
    });
    let userIds = attendees.map((a) => a.registration.userId);
    if (userIds.length === 0) return;

    if (opts?.onlyWithFeedback) {
      const withFeedback = await this.prisma.feedbackResponse.findMany({
        where: { organizationId, eventId, userId: { in: userIds } },
        select: { userId: true },
      });
      const feedbackUserIds = new Set(withFeedback.map((f) => f.userId));
      userIds = userIds.filter((id) => feedbackUserIds.has(id));
      if (userIds.length === 0) return;
    }

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

  // Delayed fallback for a gated event: whoever still has no certificate
  // once the feedback window closes gets one anyway, regardless of
  // feedback. Idempotent — enqueueBatchForEvent always skips existing
  // certificates, so this is safe even if some already went out earlier
  // (e.g. via the immediate-unlock path in FeedbackService.submit).
  scheduleFeedbackWindowClose(organizationId: string, eventId: string, endAt: Date) {
    const delay = Math.max(0, endAt.getTime() + FEEDBACK_WINDOW_MS - Date.now());
    return this.queue.add(
      CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB,
      { organizationId, eventId },
      { jobId: feedbackWindowCloseJobId(eventId), delay },
    );
  }
}
