import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MinutesService } from './minutes.service';
import { CreateMinutesDto } from './dto/create-minutes.dto';
import { UpdateMinutesDto } from './dto/update-minutes.dto';
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

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.minutes.list(orgId, page, pageSize);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':minutesId')
  findOne(@OrgId() orgId: string, @Param('minutesId') minutesId: string) {
    return this.minutes.findOne(orgId, minutesId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':minutesId')
  update(
    @OrgId() orgId: string,
    @Param('minutesId') minutesId: string,
    @Body() dto: UpdateMinutesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.minutes.update(orgId, minutesId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':minutesId')
  remove(@OrgId() orgId: string, @Param('minutesId') minutesId: string, @CurrentUser() user: { userId: string }) {
    return this.minutes.remove(orgId, minutesId, user.userId);
  }
}
