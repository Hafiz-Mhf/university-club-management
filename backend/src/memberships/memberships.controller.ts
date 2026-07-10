import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { MembershipsService } from './memberships.service';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MembershipRole } from '../tenancy/membership-role.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VIEW_MEMBERS, MANAGE_MEMBERS } from '../rbac/role-groups';

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

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_MEMBERS)
  @Post()
  add(
    @OrgId() orgId: string,
    @Body() dto: AddMemberDto,
    @MembershipRole() actorRole: Role,
    @CurrentUser() user: { userId: string },
  ) {
    return this.members.add(orgId, dto, actorRole, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_MEMBERS)
  @Patch(':membershipId')
  update(
    @OrgId() orgId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.members.updateMember(orgId, membershipId, dto, user.userId);
  }
}
