import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

// Intentionally unguarded: these routes are the platform's public surface.
// orgSlug comes straight from the route param (no TenantGuard to populate
// req.organizationId); PublicService validates it exists.
@Controller('public/organizations/:orgSlug')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('profile')
  getProfile(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getProfile(orgSlug);
  }

  @Get('gallery')
  getGallery(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getGallery(orgSlug);
  }

  @Get('achievements')
  getAchievements(@Param('orgSlug') orgSlug: string) {
    return this.publicService.getAchievements(orgSlug);
  }
}
