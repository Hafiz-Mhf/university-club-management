import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read model for "what am I involved in across this whole organization".
 *
 * Every other participant-facing read is scoped to a single event
 * (`/events/:eventId/registrations/me`, `.../attendance/me`, ...), which means
 * a participant had to open each event in turn to answer "am I approved, did I
 * attend, do I have a certificate". This is the one endpoint that answers it
 * for the org in a single request.
 *
 * Own-data only: every query filters on the caller's `userId` as well as
 * `organizationId`, so this never becomes a cross-member read even for
 * committee callers.
 */
@Injectable()
export class ParticipationService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(organizationId: string, userId: string) {
    // Certificates and feedback are keyed by [eventId, userId] rather than by
    // registrationId, so they can't be joined off Registration directly —
    // fetch each set once and index by eventId instead of issuing per-row
    // queries.
    const [registrations, certificates, feedback] = await Promise.all([
      this.prisma.registration.findMany({
        where: { organizationId, userId },
        select: {
          id: true,
          status: true,
          createdAt: true,
          event: {
            select: { id: true, title: true, startAt: true, endAt: true, venue: true, status: true },
          },
          attendance: { select: { status: true, scannedAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.certificate.findMany({
        where: { organizationId, userId },
        select: { eventId: true },
      }),
      this.prisma.feedbackResponse.findMany({
        where: { organizationId, userId },
        select: { eventId: true },
      }),
    ]);

    const certifiedEventIds = new Set(certificates.map((c) => c.eventId));
    const reviewedEventIds = new Set(feedback.map((f) => f.eventId));

    return registrations.map((registration) => ({
      registrationId: registration.id,
      status: registration.status,
      registeredAt: registration.createdAt,
      event: registration.event,
      // null while WAITLISTED — an Attendance row only exists once a
      // registration is APPROVED (see RegistrationsService).
      attendance: registration.attendance,
      // Presence only. The signed download URL stays behind the per-event
      // `certificates/me` endpoint so this list never bulk-mints file access.
      hasCertificate: certifiedEventIds.has(registration.event.id),
      feedbackSubmitted: reviewedEventIds.has(registration.event.id),
    }));
  }
}
