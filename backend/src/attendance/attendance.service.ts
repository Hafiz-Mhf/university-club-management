import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceTokenService } from './attendance-token.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AttendanceTokenService,
    private readonly audit: AuditService,
  ) {}

  // Called from RegistrationsService inside its own transaction whenever a
  // registration becomes APPROVED (direct approve, or waitlist promotion).
  async createForRegistration(
    tx: Prisma.TransactionClient,
    params: { registrationId: string; eventId: string; organizationId: string },
  ) {
    return tx.attendance.create({ data: params });
  }

  // Called from RegistrationsService inside its own transaction whenever a
  // registration resolves to CANCELLED or REJECTED. No-op (count: 0) if no
  // Attendance row exists yet (e.g. the registration was still WAITLISTED).
  async deleteForRegistration(tx: Prisma.TransactionClient, registrationId: string, organizationId: string) {
    await tx.attendance.deleteMany({ where: { registrationId, organizationId } });
  }

  async findMine(organizationId: string, eventId: string, userId: string) {
    const attendance = await this.prisma.attendance.findFirst({
      where: { eventId, organizationId, registration: { userId } },
    });
    if (!attendance) throw new NotFoundException('No attendance record found');
    return { ...attendance, token: this.tokens.sign(attendance.id) };
  }

  list(organizationId: string, eventId: string) {
    return this.prisma.attendance.findMany({
      where: { eventId, organizationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async scan(organizationId: string, eventId: string, token: string, actorUserId: string) {
    const attendanceId = this.tokens.verify(token);
    if (!attendanceId) throw new BadRequestException('Invalid attendance token');
    return this.resolve(organizationId, eventId, attendanceId, actorUserId, 'PRESENT', 'attendance.scan');
  }

  async markAbsent(organizationId: string, eventId: string, attendanceId: string, actorUserId: string) {
    return this.resolve(organizationId, eventId, attendanceId, actorUserId, 'ABSENT', 'attendance.absent');
  }

  // Single-row CAS, same idiom as RegistrationsService's private resolve():
  // no multi-candidate race exists here (unlike waitlist promotion), so a
  // plain update() + P2025 catch is correct.
  private async resolve(
    organizationId: string,
    eventId: string,
    attendanceId: string,
    actorUserId: string,
    newStatus: 'PRESENT' | 'ABSENT',
    action: 'attendance.scan' | 'attendance.absent',
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.attendance.findFirst({ where: { id: attendanceId, organizationId, eventId } });
        if (!current) throw new NotFoundException('Attendance record not found in this event');

        const updated = await tx.attendance.update({
          where: { id: attendanceId, organizationId, status: 'REGISTERED' },
          data: newStatus === 'PRESENT'
            ? { status: 'PRESENT', scannedAt: new Date(), scannedBy: actorUserId }
            : { status: 'ABSENT' },
        });

        await this.audit.record({
          organizationId, actorUserId, action,
          targetType: 'Attendance', targetId: attendanceId,
          metadata: { attendanceId, eventId },
        }, tx);

        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('Attendance already resolved (scanned or marked absent)');
      }
      throw error;
    }
  }
}
