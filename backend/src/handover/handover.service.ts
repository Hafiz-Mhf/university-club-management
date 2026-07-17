import { Injectable, NotFoundException } from '@nestjs/common';
import { FileCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HandoverPdfService } from './handover-pdf.service';

const RECENT_MINUTES_LIMIT = 10;

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: HandoverPdfService,
  ) {}

  async generate(organizationId: string, actorUserId: string | undefined): Promise<Buffer> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const [memberships, minutes, assets, files, upcomingEvents] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        include: { user: { select: { fullName: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.meetingMinutes.findMany({
        where: { organizationId },
        orderBy: { meetingDate: 'desc' },
        take: RECENT_MINUTES_LIMIT,
        select: { title: true, meetingDate: true },
      }),
      this.prisma.asset.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { name: true, quantity: true, condition: true, location: true },
      }),
      this.prisma.orgFile.findMany({
        where: { organizationId, category: { in: [FileCategory.SOP, FileCategory.REPORT] } },
        orderBy: { createdAt: 'desc' },
        select: { title: true, category: true, originalFilename: true },
      }),
      this.prisma.event.findMany({
        where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        select: { title: true, startAt: true, venue: true },
      }),
    ]);

    const buffer = await this.pdf.render({
      organizationName: organization.name,
      generatedAt: new Date(),
      roster: memberships.map((m) => ({
        fullName: m.user.fullName,
        role: m.role,
        history: Array.isArray(m.committeeHistory) ? (m.committeeHistory as { role: string; until: string }[]) : [],
      })),
      minutes,
      assets,
      files,
      upcomingEvents,
    });

    // Deliberate exception to "reads are never audited": a full-org data
    // export is a meaningfully different event from a normal list read.
    await this.audit.record({
      organizationId, actorUserId, action: 'handover.generate',
      targetType: 'Organization', targetId: organizationId,
      metadata: {},
    });

    return buffer;
  }
}
