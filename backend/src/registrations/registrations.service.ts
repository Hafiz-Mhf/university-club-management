import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RegisterDto } from './dto/register.dto';

const CURRENT_POLICY_VERSION = 'v1';

type FormFieldForValidation = { id: string; label: string; required: boolean; type: string; options: unknown };

@Injectable()
export class RegistrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async register(
    organizationId: string,
    eventId: string,
    userId: string,
    dto: RegisterDto,
    ipAddress: string | undefined,
  ) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId, status: 'PUBLISHED' },
    });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const form = await this.prisma.registrationForm.findUnique({
      where: { eventId },
      include: { fields: true },
    });
    this.validateAnswers(form, dto.answers);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Find-or-create: a returning participant registering for a second
        // event in this org must not error, and must not have their existing
        // role/status overwritten (empty update = no-op if already a member).
        await tx.membership.upsert({
          where: { userId_organizationId: { userId, organizationId } },
          create: { userId, organizationId, role: 'PARTICIPANT', status: 'ACTIVE' },
          update: {},
        });

        const approvedCount = await tx.registration.count({
          where: { eventId, organizationId, status: 'APPROVED' },
        });
        const status = event.capacity !== null && approvedCount >= event.capacity
          ? 'WAITLISTED' : 'APPROVED';

        const consentRecord = await tx.consentRecord.create({
          data: { userId, purpose: 'event-registration', policyVersion: CURRENT_POLICY_VERSION, ipAddress },
        });

        const registration = await tx.registration.create({
          data: {
            eventId, organizationId, userId,
            answers: (dto.answers ?? undefined) as Prisma.InputJsonValue | undefined,
            status,
            consentRecordId: consentRecord.id,
          },
        });

        await this.audit.record({
          organizationId, actorUserId: userId, action: 'registration.create',
          targetType: 'Registration', targetId: registration.id,
          metadata: { registrationId: registration.id, eventId, status },
        }, tx);

        return registration;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('You are already registered for this event');
      }
      throw error;
    }
  }

  private validateAnswers(
    form: { fields: FormFieldForValidation[] } | null,
    answers: Record<string, string | string[]> | undefined,
  ) {
    if (!form) {
      if (answers && Object.keys(answers).length > 0) {
        throw new BadRequestException('This event has no registration form; answers are not accepted');
      }
      return;
    }
    for (const field of form.fields) {
      const value = answers?.[field.id];
      if (field.required && (value === undefined || value === null || value === '')) {
        throw new BadRequestException(`Missing required field: ${field.label}`);
      }
      if (field.type === 'SELECT' && value !== undefined) {
        const options = (field.options as string[] | null) ?? [];
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          if (!options.includes(v)) {
            throw new BadRequestException(`Invalid value for field: ${field.label}`);
          }
        }
      }
    }
  }
}
