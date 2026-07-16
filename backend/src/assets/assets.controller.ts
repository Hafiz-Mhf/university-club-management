import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assets.create(orgId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string) {
    return this.assets.list(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':assetId')
  findOne(@OrgId() orgId: string, @Param('assetId') assetId: string) {
    return this.assets.findOne(orgId, assetId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':assetId')
  update(
    @OrgId() orgId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assets.update(orgId, assetId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':assetId')
  remove(@OrgId() orgId: string, @Param('assetId') assetId: string, @CurrentUser() user: { userId: string }) {
    return this.assets.remove(orgId, assetId, user.userId);
  }
}
