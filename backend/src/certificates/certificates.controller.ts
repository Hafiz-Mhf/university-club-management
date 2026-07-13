import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CertificatesService } from './certificates.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/events/:eventId/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @Post()
  upload(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UploadCertificateDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.certificates.upload(orgId, eventId, dto.userId, file, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get()
  list(@OrgId() orgId: string, @Param('eventId') eventId: string) {
    return this.certificates.list(orgId, eventId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.certificates.findMine(orgId, eventId, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get(':certificateId/download')
  download(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Param('certificateId') certificateId: string,
  ) {
    return this.certificates.download(orgId, eventId, certificateId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':certificateId')
  remove(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Param('certificateId') certificateId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.certificates.remove(orgId, eventId, certificateId, user.userId);
  }
}
