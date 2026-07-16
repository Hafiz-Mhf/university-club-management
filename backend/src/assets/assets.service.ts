import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateAssetDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId,
          name: dto.name,
          quantity: dto.quantity,
          condition: dto.condition,
          location: dto.location,
          notes: dto.notes,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.create',
        targetType: 'Asset', targetId: asset.id,
        metadata: { assetId: asset.id, name: asset.name, quantity: asset.quantity },
      }, tx);
      return asset;
    });
  }

  list(organizationId: string) {
    return this.prisma.asset.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(organizationId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException('Asset not found in this organization');
    return asset;
  }

  async update(organizationId: string, assetId: string, dto: UpdateAssetDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.asset.findFirst({ where: { id: assetId, organizationId } });
      if (!current) throw new NotFoundException('Asset not found in this organization');

      const data: Prisma.AssetUpdateInput = {
        name: dto.name,
        quantity: dto.quantity,
        condition: dto.condition,
        location: dto.location,
        notes: dto.notes,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.asset.update({ where: { id: assetId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.update',
        targetType: 'Asset', targetId: assetId, metadata: { assetId, fields },
      }, tx);
      return updated;
    });
  }

  async remove(organizationId: string, assetId: string, actorUserId: string): Promise<{ removed: true }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.asset.findFirst({ where: { id: assetId, organizationId } });
      if (!current) throw new NotFoundException('Asset not found in this organization');
      await tx.asset.delete({ where: { id: assetId, organizationId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.delete',
        targetType: 'Asset', targetId: assetId,
        metadata: { assetId, name: current.name },
      }, tx);
      return { removed: true as const };
    });
  }
}
