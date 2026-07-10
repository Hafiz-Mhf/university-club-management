import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEventDto } from './dto/create-event.dto';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateEventDto, actorUserId?: string) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          organizationId,
          title: dto.title,
          description: dto.description,
          venue: dto.venue,
          startAt,
          endAt,
          capacity: dto.capacity,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.create',
        targetType: 'Event', targetId: event.id,
        metadata: { eventId: event.id, title: event.title },
      }, tx);
      return event;
    });
  }

  list(organizationId: string, actorRole: Role) {
    const canManage = MANAGE_EVENTS.includes(actorRole);
    return this.prisma.event.findMany({
      where: { organizationId, ...(canManage ? {} : { status: { not: 'DRAFT' } }) },
      orderBy: { startAt: 'desc' },
    });
  }

  async findOne(organizationId: string, eventId: string, actorRole: Role) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');
    if (event.status === 'DRAFT' && !MANAGE_EVENTS.includes(actorRole)) {
      throw new NotFoundException('Event not found in this organization');
    }
    return event;
  }
}
