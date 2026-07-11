import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
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

  async update(organizationId: string, eventId: string, dto: UpdateEventDto, actorUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
      if (!current) throw new NotFoundException('Event not found in this organization');
      if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
        throw new ConflictException('Completed or cancelled events cannot be edited');
      }

      const startAt = dto.startAt ? new Date(dto.startAt) : current.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : current.endAt;
      if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');

      const data: Prisma.EventUpdateInput = {
        title: dto.title,
        description: dto.description,
        venue: dto.venue,
        capacity: dto.capacity,
        startAt: dto.startAt ? startAt : undefined,
        endAt: dto.endAt ? endAt : undefined,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.event.update({ where: { id: eventId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.update',
        targetType: 'Event', targetId: eventId, metadata: { eventId, fields },
      }, tx);
      return updated;
    });
  }

  private async transition(
    organizationId: string,
    eventId: string,
    action: 'event.publish' | 'event.complete' | 'event.cancel',
    to: 'PUBLISHED' | 'COMPLETED' | 'CANCELLED',
    canTransition: (status: string) => boolean,
    actorUserId?: string,
    extraGuard?: (event: { endAt: Date }) => void,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
      if (!current) throw new NotFoundException('Event not found in this organization');
      if (!canTransition(current.status)) {
        throw new ConflictException(`Cannot ${action} an event in ${current.status}`);
      }
      if (extraGuard) extraGuard(current);

      const updated = await tx.event.update({ where: { id: eventId, organizationId }, data: { status: to } });
      await this.audit.record({
        organizationId, actorUserId, action,
        targetType: 'Event', targetId: eventId,
        metadata: { eventId, from: current.status, to },
      }, tx);
      return updated;
    });
  }

  publish(organizationId: string, eventId: string, actorUserId?: string) {
    return this.transition(
      organizationId, eventId, 'event.publish', 'PUBLISHED',
      (s) => s === 'DRAFT', actorUserId,
      (e) => { if (e.endAt <= new Date()) throw new ConflictException('Cannot publish a past event'); },
    );
  }

  complete(organizationId: string, eventId: string, actorUserId?: string) {
    return this.transition(
      organizationId, eventId, 'event.complete', 'COMPLETED',
      (s) => s === 'PUBLISHED', actorUserId,
    );
  }

  cancel(organizationId: string, eventId: string, actorUserId?: string) {
    return this.transition(
      organizationId, eventId, 'event.cancel', 'CANCELLED',
      (s) => s === 'DRAFT' || s === 'PUBLISHED', actorUserId,
    );
  }
}
