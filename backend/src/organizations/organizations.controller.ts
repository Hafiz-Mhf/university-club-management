import { Body, Controller, Delete, Get, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { OrgId } from '../tenancy/org-id.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';

// Multer's cap sits above the service's 2MB check so an oversized file gets
// the service's 400 (not multer's 413) — same layering as CertificatesController.
const BRANDING_UPLOAD_LIMITS = { limits: { fileSize: 4 * 1024 * 1024 } };

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

  @UseGuards(JwtAuthGuard)
  @Get()
  listMine(@CurrentUser() user: { userId: string }) {
    return this.orgs.listForUser(user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':orgId')
  findOne(@OrgId() orgId: string) {
    return this.orgs.findOne(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT', 'VICE_PRESIDENT')
  @Patch(':orgId')
  updateProfile(
    @OrgId() orgId: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.orgs.updateProfile(orgId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT')
  @Patch(':orgId/settings')
  updateSettings(
    @OrgId() orgId: string,
    @Body() body: UpdateOrganizationSettingsDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.orgs.updateSettings(orgId, body, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT', 'VICE_PRESIDENT')
  @UseInterceptors(FileInterceptor('file', BRANDING_UPLOAD_LIMITS))
  @Post(':orgId/logo')
  uploadLogo(
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.orgs.uploadLogo(orgId, file, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT', 'VICE_PRESIDENT')
  @Delete(':orgId/logo')
  deleteLogo(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    return this.orgs.deleteLogo(orgId, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT', 'VICE_PRESIDENT')
  @UseInterceptors(FileInterceptor('file', BRANDING_UPLOAD_LIMITS))
  @Post(':orgId/banner')
  uploadBanner(
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.orgs.uploadBanner(orgId, file, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT', 'VICE_PRESIDENT')
  @Delete(':orgId/banner')
  deleteBanner(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    return this.orgs.deleteBanner(orgId, user.userId);
  }
}
