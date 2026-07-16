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
}
