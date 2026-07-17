import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CertificateGenerationService } from '../certificates/generation/certificate-generation.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { FEEDBACK_WINDOW_MS } from './feedback.constants';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly certificateGeneration: CertificateGenerationService,
  ) {}

  async submit(organizationId: string, eventId: string, userId: string, dto: SubmitFeedbackDto) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const attendance = await this.prisma.attendance.findFirst({
      where: { eventId, organizationId, registration: { userId }, status: 'PRESENT' },
    });
    if (!attendance) throw new ForbiddenException('Only attendees marked present can submit feedback');

    const windowCloses = new Date(event.endAt.getTime() + FEEDBACK_WINDOW_MS);
    if (new Date() > windowCloses) throw new ForbiddenException('Feedback window has closed for this event');

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.feedbackResponse.create({
          data: {
            organizationId, eventId, userId,
            npsScore: dto.npsScore,
            contentRating: dto.contentRating,
            organizationRating: dto.organizationRating,
            venueRating: dto.venueRating,
            comment: dto.comment,
          },
        });
        await this.audit.record({
          organizationId, actorUserId: userId, action: 'feedback.submit',
          targetType: 'FeedbackResponse', targetId: row.id,
          metadata: { eventId, feedbackId: row.id },
        }, tx);
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Feedback already submitted for this event');
      }
      throw error;
    }

    // Immediate-unlock: if this event already completed with the gate on,
    // don't make this person wait for the 14-day fallback job — re-run the
    // gated batch enqueue right away. Idempotent (skips existing certs), so
    // cheap to call on every submission at this event scale.
    if (event.status === 'COMPLETED' && event.requireFeedbackForCertificate) {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, undefined, { onlyWithFeedback: true });
    }

    return created;
  }

  // 404 when absent, mirroring certificates/me and attendance/me — Nest
  // serializes a null return as an empty body, so "null" isn't expressible.
  async findMine(organizationId: string, eventId: string, userId: string) {
    const response = await this.prisma.feedbackResponse.findFirst({ where: { eventId, organizationId, userId } });
    if (!response) throw new NotFoundException('No feedback submitted for this event');
    return response;
  }

  async summary(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const responses = await this.prisma.feedbackResponse.findMany({
      where: { organizationId, eventId },
      select: { npsScore: true, contentRating: true, organizationRating: true, venueRating: true, comment: true },
    });

    const count = responses.length;
    const average = (values: number[]) => (count === 0 ? null : values.reduce((sum, v) => sum + v, 0) / count);

    return {
      responseCount: count,
      avgNpsScore: average(responses.map((r) => r.npsScore)),
      avgContentRating: average(responses.map((r) => r.contentRating)),
      avgOrganizationRating: average(responses.map((r) => r.organizationRating)),
      avgVenueRating: average(responses.map((r) => r.venueRating)),
      comments: responses.map((r) => r.comment).filter((c): c is string => c !== null),
    };
  }
}
