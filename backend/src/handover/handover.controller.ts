import { Controller, Get, Header, StreamableFile, UseGuards } from '@nestjs/common';
import { HandoverService } from './handover.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/handover')
export class HandoverController {
  constructor(private readonly handover: HandoverService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="handover-pack.pdf"')
  @Get()
  async generate(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    const buffer = await this.handover.generate(orgId, user.userId);
    return new StreamableFile(buffer);
  }
}
