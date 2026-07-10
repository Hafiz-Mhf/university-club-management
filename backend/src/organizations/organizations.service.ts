import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          memberships: {
            create: { userId, role: 'PRESIDENT' },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Organization slug already taken');
      }
      throw error;
    }
  }

  findOne(organizationId: string) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  async updateSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
    actorUserId?: string,
  ) {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.primaryColor !== undefined) {
      data.primaryColor = dto.primaryColor;
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({ where: { id: organizationId }, data });
      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: 'organization.settings.update',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: data as Record<string, unknown>,
        },
        tx,
      );
      return org;
    });
  }
}
