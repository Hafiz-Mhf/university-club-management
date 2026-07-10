import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { MembershipsService } from './memberships.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VIEW_MEMBERS } from '../rbac/role-groups';

@Controller('organizations/:orgId/members')
export class MembershipsController {
  constructor(private readonly members: MembershipsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...VIEW_MEMBERS)
  @Get()
  list(
    @OrgId() orgId: string,
    @Query('status') status?: MemberStatus,
    @Query('role') role?: Role,
  ) {
    return this.members.list(orgId, { status, role });
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    return this.members.findMine(orgId, user.userId);
  }
}
