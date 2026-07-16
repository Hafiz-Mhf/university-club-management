import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GalleryService } from './gallery.service';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  @Post()
  upload(
    @OrgId() orgId: string,
    @Body() dto: UploadPhotoDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.gallery.upload(orgId, dto.caption, file, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string) {
    return this.gallery.list(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':photoId')
  remove(@OrgId() orgId: string, @Param('photoId') photoId: string, @CurrentUser() user: { userId: string }) {
    return this.gallery.remove(orgId, photoId, user.userId);
  }
}
