import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateMinutesDto } from './dto/create-minutes.dto';

@Injectable()
export class MinutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async validateAttendees(organizationId: string, attendeeMembershipIds: string[]) {
    if (attendeeMembershipIds.length === 0) return;
    const found = await this.prisma.membership.findMany({
      where: { id: { in: attendeeMembershipIds }, organizationId },
      select: { id: true },
    });
    if (found.length !== attendeeMembershipIds.length) {
      throw new BadRequestException('One or more attendeeMembershipIds do not belong to this organization');
    }
  }

  async create(organizationId: string, dto: CreateMinutesDto, actorUserId: string) {
    await this.validateAttendees(organizationId, dto.attendeeMembershipIds);
    const meetingDate = new Date(dto.meetingDate);

    return this.prisma.$transaction(async (tx) => {
      const minutes = await tx.meetingMinutes.create({
        data: {
          organizationId,
          title: dto.title,
          meetingDate,
          attendeeMembershipIds: dto.attendeeMembershipIds as any,
          agendaItems: dto.agendaItems as any,
          actionItems: dto.actionItems as any,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'minutes.create',
        targetType: 'MeetingMinutes', targetId: minutes.id,
        metadata: { minutesId: minutes.id, title: minutes.title, meetingDate: minutes.meetingDate },
      }, tx);
      return minutes;
    });
  }

  async list(organizationId: string, page?: string, pageSize?: string) {
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));

    const [data, total] = await Promise.all([
      this.prisma.meetingMinutes.findMany({
        where: { organizationId },
        orderBy: { meetingDate: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
      this.prisma.meetingMinutes.count({ where: { organizationId } }),
    ]);
    return { data, total, page: pageNum, pageSize: size };
  }

  async findOne(organizationId: string, minutesId: string) {
    const minutes = await this.prisma.meetingMinutes.findFirst({ where: { id: minutesId, organizationId } });
    if (!minutes) throw new NotFoundException('Minutes not found in this organization');
    return minutes;
  }
}
