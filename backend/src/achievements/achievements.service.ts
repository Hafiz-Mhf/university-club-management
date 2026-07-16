import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';

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
}
