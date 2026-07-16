import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { dayRange, dateKey, windowStart } from './date-window.util';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string) {
    const [present, absent] = await Promise.all([
      this.prisma.attendance.count({ where: { organizationId, status: 'PRESENT' } }),
      this.prisma.attendance.count({ where: { organizationId, status: 'ABSENT' } }),
    ]);
    const resolved = present + absent;
    return { attendanceRate: resolved === 0 ? null : present / resolved };
  }

  async getCertificates(organizationId: string) {
    const [issued, downloaded] = await Promise.all([
      this.prisma.certificate.count({ where: { organizationId } }),
      this.prisma.certificateDownload.count({ where: { certificate: { organizationId } } }),
    ]);
    return { issued, downloaded };
  }

  async getTrends(organizationId: string, days: number) {
    const buckets = dayRange(days);
    const start = windowStart(days);

    const [registrations, memberships] = await Promise.all([
      this.prisma.registration.findMany({
        where: { organizationId, createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      this.prisma.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { joinedAt: true },
      }),
    ]);

    const regCounts = new Map(buckets.map((d) => [d, 0]));
    for (const r of registrations) {
      const key = dateKey(r.createdAt);
      if (regCounts.has(key)) regCounts.set(key, regCounts.get(key)! + 1);
    }
    const registrationTrend = buckets.map((date) => ({ date, count: regCounts.get(date)! }));

    // Two-pointer walk over every active member's join date: first
    // absorb everyone who joined strictly before the window (the org's
    // starting headcount), then advance through the window day by day.
    // Not filtered to the window at the query level — an org older than
    // `days` still has a nonzero count on day 1 of the window.
    const sortedJoinDates = memberships.map((m) => dateKey(m.joinedAt)).sort();
    let idx = 0;
    let cumulative = 0;
    while (idx < sortedJoinDates.length && sortedJoinDates[idx] < buckets[0]) {
      cumulative++;
      idx++;
    }
    const memberGrowth = buckets.map((date) => {
      while (idx < sortedJoinDates.length && sortedJoinDates[idx] <= date) {
        cumulative++;
        idx++;
      }
      return { date, cumulativeActive: cumulative };
    });

    return { registrationTrend, memberGrowth };
  }

  async getDemographics(organizationId: string) {
    const [facultyGroups, programmeGroups] = await Promise.all([
      this.prisma.membership.groupBy({
        by: ['faculty'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.membership.groupBy({
        by: ['programme'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    return {
      faculty: facultyGroups.map((g) => ({ value: g.faculty, count: g._count._all })),
      programme: programmeGroups.map((g) => ({ value: g.programme, count: g._count._all })),
    };
  }

  async getCommitteeActivity(organizationId: string, days: number) {
    const since = windowStart(days);
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['actorUserId'],
      where: { organizationId, createdAt: { gte: since }, actorUserId: { not: null } },
      _count: { _all: true },
    });

    const userIds = grouped
      .map((g) => g.actorUserId)
      .filter((id): id is string => id !== null);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { userId: true, role: true, user: { select: { fullName: true } } },
    });
    const byUserId = new Map(memberships.map((m) => [m.userId, m]));

    // A user with a current Membership in this org is included; an actor
    // who has since left (no Membership row) has nothing to attribute a
    // name/role to, and is dropped rather than shown with placeholder data.
    const data = grouped
      .filter((g) => g.actorUserId !== null && byUserId.has(g.actorUserId))
      .map((g) => {
        const m = byUserId.get(g.actorUserId!)!;
        return { userId: g.actorUserId!, fullName: m.user.fullName, role: m.role, actionCount: g._count._all };
      })
      .sort((a, b) => b.actionCount - a.actionCount);

    return { data };
  }
}
