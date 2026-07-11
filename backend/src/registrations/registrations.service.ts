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
    const answers = this.projectAnswers(form, dto.answers);

    // Find-or-create: a returning participant registering for a second event
    // in this org must not error, and must not have their existing role/status
    // overwritten (empty update = no-op if already a member).
    //
    // This runs OUTSIDE the registration transaction on purpose: Postgres
    // aborts an interactive transaction on any error, so a swallowed P2002
    // from a concurrent first-time upsert would poison the whole tx. The
    // trade-off — a registration that subsequently fails (e.g. duplicate
    // → 409) may leave the PARTICIPANT membership behind — is intentional:
    // registering expresses intent to join the org.
    try {
      await this.prisma.membership.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        create: { userId, organizationId, role: 'PARTICIPANT', status: 'ACTIVE' },
        update: {},
      });
    } catch (error) {
      const isConcurrentMembershipCreate =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        this.p2002Targets(error).includes('organizationId');
      // A concurrent request already created the membership — goal satisfied.
      if (!isConcurrentMembershipCreate) throw error;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize registrations per event: without this row lock the
        // count-then-create below is racy at READ COMMITTED and concurrent
        // registrants can overshoot capacity. (Template-literal $queryRaw is
        // parameterized — safe.)
        await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;

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
            answers: (answers ?? undefined) as Prisma.InputJsonValue | undefined,
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
      // Target-checked so a future unique constraint in this transaction
      // cannot be mislabeled as a duplicate registration: only
      // Registration.[eventId, userId] maps to this 409.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        this.p2002Targets(error).includes('eventId')
      ) {
        throw new ConflictException('You are already registered for this event');
      }
      throw error;
    }
  }

  private p2002Targets(error: Prisma.PrismaClientKnownRequestError): string[] {
    const target = error.meta?.target;
    if (Array.isArray(target)) return target.map(String);
    if (typeof target === 'string') return [target];
    return [];
  }

  // Allowlist projection: only keys matching the form's field ids are
  // persisted — unknown keys are dropped, never stored. With no form,
  // validateAnswers has already rejected any non-empty answers.
  private projectAnswers(
    form: { fields: FormFieldForValidation[] } | null,
    answers: Record<string, string | string[]> | undefined,
  ): Record<string, string | string[]> | undefined {
    if (!form || !answers) return answers;
    const allowed = new Set(form.fields.map((f) => f.id));
    return Object.fromEntries(Object.entries(answers).filter(([key]) => allowed.has(key)));
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
      // 'true' (string) is the canonical checked value for CHECKBOX answers —
      // a required checkbox submitted as 'false' (or anything else) is not
      // accepted, otherwise "required" could be bypassed with an unchecked box.
      if (field.type === 'CHECKBOX' && field.required && value !== 'true') {
        throw new BadRequestException(`Required checkbox not accepted: ${field.label}`);
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
