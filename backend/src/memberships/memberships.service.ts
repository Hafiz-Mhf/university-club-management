import { Injectable } from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const USER_SELECT = { id: true, fullName: true, email: true };

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, filter: { status?: MemberStatus; role?: Role }) {
    return this.prisma.membership.findMany({
      where: { organizationId, status: filter.status, role: filter.role },
      include: { user: { select: USER_SELECT } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  findMine(organizationId: string, userId: string) {
    return this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: { select: USER_SELECT } },
    });
  }
}
