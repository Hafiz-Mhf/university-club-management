import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  updateSettings(organizationId: string, data: { primaryColor?: string }) {
    return this.prisma.organization.update({ where: { id: organizationId }, data });
  }
}
