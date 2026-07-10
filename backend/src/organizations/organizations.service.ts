import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        memberships: {
          create: { userId, role: 'PRESIDENT' },
        },
      },
    });
  }

  findOne(organizationId: string) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  async updateSettings(organizationId: string, data: { primaryColor?: string }, actorUserId?: string) {
    const org = await this.prisma.organization.update({ where: { id: organizationId }, data });
    await this.audit.record({
      organizationId,
      actorUserId,
      action: 'organization.settings.update',
      targetType: 'Organization',
      targetId: organizationId,
      metadata: data,
    });
    return org;
  }
}
