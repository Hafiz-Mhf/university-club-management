import { Controller, Get, UseGuards } from '@nestjs/common';
import { ParticipationService } from './participation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';

// No RolesGuard: this returns only the caller's own rows, so every active
// member of the org — PARTICIPANT included — is entitled to read it.
@Controller('organizations/:orgId/me/participation')
export class ParticipationController {
  constructor(private readonly participation: ParticipationService) {}

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  mine(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    return this.participation.findMine(orgId, user.userId);
  }
}
