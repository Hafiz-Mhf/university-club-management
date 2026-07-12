import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { ScanAttendanceDto } from './dto/scan-attendance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_ATTENDANCE } from '../rbac/role-groups';

@Controller('organizations/:orgId/events/:eventId/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_ATTENDANCE)
  @Get()
  list(@OrgId() orgId: string, @Param('eventId') eventId: string) {
    return this.attendance.list(orgId, eventId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.attendance.findMine(orgId, eventId, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_ATTENDANCE)
  @Post('scan')
  @HttpCode(200)
  scan(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: ScanAttendanceDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.attendance.scan(orgId, eventId, dto.token, user.userId);
  }
}
