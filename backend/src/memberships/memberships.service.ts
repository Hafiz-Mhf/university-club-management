import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AddMemberDto } from './dto/add-member.dto';
import { MANAGE_ROLES } from '../rbac/role-groups';

const USER_SELECT = { id: true, fullName: true, email: true };

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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

  async add(
    organizationId: string,
    dto: AddMemberDto,
    actorRole: Role,
    actorUserId?: string,
  ) {
    // Assigning a president/VP role is committee-role management — only a
    // MANAGE_ROLES holder may do it, even on member creation.
    if (MANAGE_ROLES.includes(dto.role) && !MANAGE_ROLES.includes(actorRole)) {
      throw new ForbiddenException('Only president/vice-president can assign that role');
    }
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('No account for that email');
    const existing = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
    if (existing) throw new ConflictException('User is already a member');
    const membership = await this.prisma.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role: dto.role,
        studentId: dto.studentId,
        faculty: dto.faculty,
        programme: dto.programme,
        intake: dto.intake,
        phone: dto.phone,
      },
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'member.add',
      targetType: 'Membership', targetId: membership.id,
      metadata: { userId: user.id, role: dto.role },
    });
    return membership;
  }
}
