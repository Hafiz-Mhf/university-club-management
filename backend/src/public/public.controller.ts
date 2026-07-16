import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

// Intentionally unguarded: these routes are the platform's public surface.
// orgId comes straight from the route param (no TenantGuard to populate
// req.organizationId); PublicService validates it exists.
@Controller('public/organizations/:orgId')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('profile')
  getProfile(@Param('orgId') orgId: string) {
    return this.publicService.getProfile(orgId);
  }

  @Get('gallery')
  getGallery(@Param('orgId') orgId: string) {
    return this.publicService.getGallery(orgId);
  }

  @Get('achievements')
  getAchievements(@Param('orgId') orgId: string) {
    return this.publicService.getAchievements(orgId);
  }
}
