import { Body, Controller, Delete, Get, Param, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RegistrationFormService } from './registration-form.service';
import { UpsertRegistrationFormDto } from './dto/upsert-registration-form.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/events/:eventId/registration-form')
export class RegistrationFormController {
  constructor(private readonly forms: RegistrationFormService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Put()
  upsert(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpsertRegistrationFormDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.forms.upsert(orgId, eventId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  async findOne(@OrgId() orgId: string, @Param('eventId') eventId: string, @Res() res: Response) {
    // Nest's default reply path treats a `null` return value as "no body"
    // (isNil short-circuits to response.send()), which would serialize as an
    // empty body instead of JSON `null`. Use @Res() here so "no form yet" is
    // still a proper `200 null` JSON response the client can distinguish
    // from a network/parse error.
    const form = await this.forms.findByEvent(orgId, eventId);
    res.status(200).json(form);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete()
  remove(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.forms.remove(orgId, eventId, user.userId);
  }
}
