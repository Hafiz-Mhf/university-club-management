import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpsertRegistrationFormDto } from './dto/upsert-registration-form.dto';

@Injectable()
export class RegistrationFormService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // RegistrationForm/FormField carry no organizationId of their own — isolation
  // is enforced here, by requiring the event to belong to this org, before
  // touching either table. Event.organizationId never changes after creation,
  // so this check cannot go stale between here and the write below.
  private async findEditableEvent(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');
    if (event.status === 'COMPLETED' || event.status === 'CANCELLED') {
      throw new ConflictException('Completed or cancelled events cannot have their form edited');
    }
    return event;
  }

  async upsert(organizationId: string, eventId: string, dto: UpsertRegistrationFormDto, actorUserId?: string) {
    for (const field of dto.fields) {
      if (field.type === 'SELECT' && (!field.options || field.options.length === 0)) {
        throw new BadRequestException(`Field "${field.label}" of type SELECT requires a non-empty options list`);
      }
    }

    await this.findEditableEvent(organizationId, eventId);

    return this.prisma.$transaction(async (tx) => {
      // Clear existing fields first, then upsert re-creates them fresh —
      // simplest correct way to fully replace the field list atomically.
      await tx.formField.deleteMany({ where: { registrationForm: { eventId } } });
      const fieldsData = dto.fields.map((f) => ({
        label: f.label, type: f.type, required: f.required ?? false,
        options: (f.options ?? undefined) as Prisma.InputJsonValue | undefined,
        order: f.order,
      }));
      const form = await tx.registrationForm.upsert({
        where: { eventId },
        create: { eventId, fields: { create: fieldsData } },
        update: { fields: { create: fieldsData } },
        include: { fields: true },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'form.upsert',
        targetType: 'RegistrationForm', targetId: form.id,
        metadata: { eventId, fieldCount: dto.fields.length },
      }, tx);
      return form;
    });
  }

  async findByEvent(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');
    return this.prisma.registrationForm.findUnique({
      where: { eventId },
      include: { fields: { orderBy: { order: 'asc' } } },
    });
  }

  async remove(organizationId: string, eventId: string, actorUserId?: string): Promise<{ removed: true }> {
    await this.findEditableEvent(organizationId, eventId);
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.registrationForm.findUnique({ where: { eventId } });
      if (form) {
        await tx.formField.deleteMany({ where: { registrationFormId: form.id } });
        await tx.registrationForm.delete({ where: { eventId } });
      }
      await this.audit.record({
        organizationId, actorUserId, action: 'form.delete',
        targetType: 'RegistrationForm', targetId: eventId,
        metadata: { eventId },
      }, tx);
      return { removed: true as const };
    });
  }
}
