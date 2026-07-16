import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { UpdateAchievementDto } from './dto/update-achievement.dto';

@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateAchievementDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const achievement = await tx.achievement.create({
        data: {
          organizationId, title: dto.title, description: dto.description, year: dto.year,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.create',
        targetType: 'Achievement', targetId: achievement.id,
        metadata: { achievementId: achievement.id, title: achievement.title, year: achievement.year },
      }, tx);
      return achievement;
    });
  }

  list(organizationId: string) {
    return this.prisma.achievement.findMany({
      where: { organizationId },
      orderBy: { year: 'desc' },
    });
  }

  async findOne(organizationId: string, achievementId: string) {
    const achievement = await this.prisma.achievement.findFirst({ where: { id: achievementId, organizationId } });
    if (!achievement) throw new NotFoundException('Achievement not found in this organization');
    return achievement;
  }

  async update(organizationId: string, achievementId: string, dto: UpdateAchievementDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.achievement.findFirst({ where: { id: achievementId, organizationId } });
      if (!current) throw new NotFoundException('Achievement not found in this organization');

      const data: Prisma.AchievementUpdateInput = {
        title: dto.title,
        description: dto.description,
        year: dto.year,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.achievement.update({ where: { id: achievementId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.update',
        targetType: 'Achievement', targetId: achievementId, metadata: { achievementId, fields },
      }, tx);
      return updated;
    });
  }

  async remove(organizationId: string, achievementId: string, actorUserId: string): Promise<{ removed: true }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.achievement.findFirst({ where: { id: achievementId, organizationId } });
      if (!current) throw new NotFoundException('Achievement not found in this organization');
      await tx.achievement.delete({ where: { id: achievementId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.delete',
        targetType: 'Achievement', targetId: achievementId,
        metadata: { achievementId, title: current.title },
      }, tx);
      return { removed: true as const };
    });
  }
}
