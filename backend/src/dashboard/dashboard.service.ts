import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const UPCOMING_EVENTS_LIMIT = 5;
const PENDING_APPROVALS_LIMIT = 10;
const RECENT_REGISTRATIONS_LIMIT = 10;
const ACTIVITY_FEED_LIMIT = 15;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(organizationId: string) {
    const [
      activeMembers,
      totalEvents,
      activeRegistrations,
      certificatesIssued,
      upcomingEventsRaw,
      pendingApprovalsRaw,
      recentRegistrationsRaw,
      activityFeed,
    ] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.event.count({ where: { organizationId, status: { in: ['PUBLISHED', 'COMPLETED'] } } }),
      this.prisma.registration.count({ where: { organizationId, status: { in: ['APPROVED', 'WAITLISTED'] } } }),
      this.prisma.certificate.count({ where: { organizationId } }),
      this.prisma.event.findMany({
        where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
        select: {
          id: true,
          title: true,
          startAt: true,
          venue: true,
          _count: { select: { registrations: true } },
        },
        orderBy: { startAt: 'asc' },
        take: UPCOMING_EVENTS_LIMIT,
      }),
      this.prisma.registration.findMany({
        where: { organizationId, status: 'WAITLISTED' },
        select: {
          id: true,
          eventId: true,
          userId: true,
          createdAt: true,
          event: { select: { title: true } },
          user: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: PENDING_APPROVALS_LIMIT,
      }),
      this.prisma.registration.findMany({
        where: { organizationId },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
          createdAt: true,
          event: { select: { title: true } },
          user: { select: { fullName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_REGISTRATIONS_LIMIT,
      }),
      this.prisma.auditLog.findMany({
        // notification.email rows are actorless system events written
        // asynchronously by the notifications worker — they'd crowd actor
        // activity out of the capped feed. Full history stays queryable at
        // /organizations/:orgId/audit-logs.
        where: { organizationId, action: { not: 'notification.email' } },
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          actorUserId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_FEED_LIMIT,
      }),
    ]);

    // "Someone did something" is not an activity feed. Resolve the actors in one
    // query — the feed is capped at 15 rows, so this is a single small IN.
    const actorIds = [...new Set(activityFeed.map((a) => a.actorUserId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const actorNames = new Map(actors.map((a) => [a.id, a.fullName]));

    return {
      kpis: { activeMembers, totalEvents, activeRegistrations, certificatesIssued },
      upcomingEvents: upcomingEventsRaw.map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        venue: e.venue,
        registrationCount: e._count.registrations,
      })),
      pendingApprovals: pendingApprovalsRaw.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventTitle: r.event.title,
        userId: r.userId,
        userName: r.user.fullName,
        createdAt: r.createdAt,
      })),
      recentRegistrations: recentRegistrationsRaw.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventTitle: r.event.title,
        userId: r.userId,
        userName: r.user.fullName,
        status: r.status,
        createdAt: r.createdAt,
      })),
      activityFeed: activityFeed.map((entry) => ({
        ...entry,
        actorName: entry.actorUserId ? (actorNames.get(entry.actorUserId) ?? null) : null,
      })),
    };
  }
}
