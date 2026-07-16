import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateAchievementDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.achievements.create(orgId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string) {
    return this.achievements.list(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':achievementId')
  findOne(@OrgId() orgId: string, @Param('achievementId') achievementId: string) {
    return this.achievements.findOne(orgId, achievementId);
  }
}
