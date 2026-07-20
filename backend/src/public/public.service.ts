import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EventsService } from '../events/events.service';
import { GalleryService } from '../gallery/gallery.service';
import { AchievementsService } from '../achievements/achievements.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
    private readonly gallery: GalleryService,
    private readonly achievements: AchievementsService,
  ) {}

  // No TenantGuard on public routes — this explicit existence check is the
  // only thing standing between a bad slug and an empty-but-200 response.
  private async requireOrganizationBySlug(slug: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true, name: true, description: true, logoKey: true, bannerKey: true, primaryColor: true, socialLinks: true, advisors: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async getProfile(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    const logoUrl = organization.logoKey
      ? await this.storage.getSignedDownloadUrl(organization.logoKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const bannerUrl = organization.bannerKey
      ? await this.storage.getSignedDownloadUrl(organization.bannerKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const upcomingEvents = await this.events.listPublicUpcoming(organization.id);
    return {
      name: organization.name,
      description: organization.description,
      logoUrl,
      bannerUrl,
      primaryColor: organization.primaryColor,
      socialLinks: organization.socialLinks,
      advisors: organization.advisors,
      upcomingEvents,
    };
  }

  async getGallery(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    return this.gallery.list(organization.id);
  }

  async getAchievements(orgSlug: string) {
    const organization = await this.requireOrganizationBySlug(orgSlug);
    return this.achievements.list(organization.id);
  }
}
