import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { parseDaysParam } from './date-window.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('overview')
  getOverview(@OrgId() orgId: string) {
    return this.analytics.getOverview(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('certificates')
  getCertificates(@OrgId() orgId: string) {
    return this.analytics.getCertificates(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('trends')
  getTrends(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getTrends(orgId, parseDaysParam(daysRaw));
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('demographics')
  getDemographics(@OrgId() orgId: string) {
    return this.analytics.getDemographics(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('committee-activity')
  getCommitteeActivity(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getCommitteeActivity(orgId, parseDaysParam(daysRaw));
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('feedback')
  getFeedback(@OrgId() orgId: string) {
    return this.analytics.getFeedback(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('feedback-trends')
  getFeedbackTrends(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getFeedbackTrends(orgId, parseDaysParam(daysRaw));
  }
}
