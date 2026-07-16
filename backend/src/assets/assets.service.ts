import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAssetDto } from './dto/create-asset.dto';

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
}
