import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AttendanceTokenService } from './attendance-token.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AttendanceTokenService,
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
}
