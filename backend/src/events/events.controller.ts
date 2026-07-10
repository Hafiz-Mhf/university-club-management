import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MembershipRole } from '../tenancy/membership-role.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateEventDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.events.create(orgId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string, @MembershipRole() role: Role) {
    return this.events.list(orgId, role);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':eventId')
  findOne(@OrgId() orgId: string, @Param('eventId') eventId: string, @MembershipRole() role: Role) {
    return this.events.findOne(orgId, eventId, role);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':eventId')
  update(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.events.update(orgId, eventId, dto, user.userId);
  }
}
