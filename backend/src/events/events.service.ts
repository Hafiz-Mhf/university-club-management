import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CertificateGenerationService } from '../certificates/generation/certificate-generation.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly certificateGeneration: CertificateGenerationService,
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

  listPublicUpcoming(organizationId: string) {
    return this.prisma.event.findMany({
      where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
      select: { id: true, title: true, startAt: true, endAt: true, venue: true },
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
    const result = await this.prisma.$transaction(async (tx) => {
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
        requireFeedbackForCertificate: dto.requireFeedbackForCertificate,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.event.update({ where: { id: eventId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.update',
        targetType: 'Event', targetId: eventId, metadata: { eventId, fields },
      }, tx);
      return updated;
    });

    // Reschedules even if the new startAt equals the old one — a harmless
    // no-op recompute, not worth a deep-equality check.
    if (dto.startAt && result.status === 'PUBLISHED') {
      await this.notifications.cancelEventReminder(eventId);
      await this.notifications.scheduleEventReminder(organizationId, eventId, result.startAt);
    }

    return result;
  }

  private async transition(
    organizationId: string,
    eventId: string,
    action: 'event.publish' | 'event.complete' | 'event.cancel',
    to: 'PUBLISHED' | 'COMPLETED' | 'CANCELLED',
    canTransition: (status: EventStatus) => boolean,
    actorUserId?: string,
    extraGuard?: (event: { endAt: Date }) => void,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
      if (!current) throw new NotFoundException('Event not found in this organization');
      if (!canTransition(current.status)) {
        const verb = action.split('.')[1];
        throw new ConflictException(`Cannot ${verb} an event in ${current.status}`);
      }
      if (extraGuard) extraGuard(current);

      // Compare-and-swap: only update if the status is still the one we validated,
      // so a concurrent transition loses with P2025 (and never writes an audit row)
      // instead of blindly overwriting the winner's state.
      let updated;
      try {
        updated = await tx.event.update({
          where: { id: eventId, organizationId, status: current.status },
          data: { status: to },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new ConflictException('Event was modified concurrently — please retry');
        }
        throw error;
      }
      await this.audit.record({
        organizationId, actorUserId, action,
        targetType: 'Event', targetId: eventId,
        metadata: { eventId, from: current.status, to },
      }, tx);
      return updated;
    });
  }

  async publish(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.publish', 'PUBLISHED',
      (s) => s === 'DRAFT', actorUserId,
      (e) => { if (e.endAt <= new Date()) throw new ConflictException('Cannot publish a past event'); },
    );
    await this.notifications.scheduleEventReminder(organizationId, eventId, updated.startAt);
    return updated;
  }

  async complete(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.complete', 'COMPLETED',
      (s) => s === 'PUBLISHED', actorUserId,
    );
    await this.notifications.cancelEventReminder(eventId);
    if (updated.requireFeedbackForCertificate) {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, actorUserId, { onlyWithFeedback: true });
      await this.certificateGeneration.scheduleFeedbackWindowClose(organizationId, eventId, updated.endAt);
    } else {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, actorUserId);
    }
    return updated;
  }

  async cancel(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.cancel', 'CANCELLED',
      (s) => s === 'DRAFT' || s === 'PUBLISHED', actorUserId,
    );
    await this.notifications.cancelEventReminder(eventId);
    return updated;
  }

  async remove(organizationId: string, eventId: string, actorUserId?: string): Promise<{ removed: true }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
        if (!current) throw new NotFoundException('Event not found in this organization');
        await tx.event.delete({ where: { id: eventId, organizationId } });
        await this.audit.record({
          organizationId, actorUserId, action: 'event.delete',
          targetType: 'Event', targetId: eventId,
          metadata: { eventId, title: current.title },
        }, tx);
        return { removed: true as const };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Event not found in this organization');
      }
      throw error;
    }
  }
}
