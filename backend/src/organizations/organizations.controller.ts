import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { OrgId } from '../tenancy/org-id.decorator';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgs.create(user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':orgId')
  findOne(@OrgId() orgId: string) {
    return this.orgs.findOne(orgId);
  }
}
