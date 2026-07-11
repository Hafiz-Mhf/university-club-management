import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { RegistrationsService } from './registrations.service';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/events/:eventId/registrations')
export class RegistrationsController {
  constructor(private readonly registrations: RegistrationsService) {}

  // No TenantGuard: registering is how a user becomes a member of this org
  // (auto-enrolled as PARTICIPANT inside the service). orgId therefore comes
  // straight from the route param, not @OrgId() (which reads req.organizationId,
  // only ever set by TenantGuard — never set on this route).
  @UseGuards(JwtAuthGuard)
  @Post()
  register(
    @Param('orgId') orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: RegisterDto,
    @CurrentUser() user: { userId: string },
    @Req() req: Request,
  ) {
    return this.registrations.register(orgId, eventId, user.userId, dto, req.ip);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get()
  list(@OrgId() orgId: string, @Param('eventId') eventId: string) {
    return this.registrations.list(orgId, eventId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.registrations.findMine(orgId, eventId, user.userId);
  }
}
