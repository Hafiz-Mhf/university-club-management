import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MinutesService } from './minutes.service';
import { CreateMinutesDto } from './dto/create-minutes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/minutes')
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateMinutesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.minutes.create(orgId, dto, user.userId);
  }
}
