import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  @Post()
  upload(
    @OrgId() orgId: string,
    @Body() dto: UploadFileDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: { userId: string },
  ) {
    return this.files.upload(orgId, dto.title, dto.category, file, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string, @Query('category') category?: string) {
    return this.files.list(orgId, category);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':fileId/download')
  download(@OrgId() orgId: string, @Param('fileId') fileId: string) {
    return this.files.getDownloadUrl(orgId, fileId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':fileId')
  remove(
    @OrgId() orgId: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.files.remove(orgId, fileId, user.userId);
  }
}
