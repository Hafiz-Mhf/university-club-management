import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AuditService } from '../audit/audit.service';

const SIGNED_URL_TTL_SECONDS = 300;

const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };
type BrandingKind = 'logo' | 'banner';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    try {
      return await this.prisma.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          memberships: {
            create: { userId, role: 'PRESIDENT' },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Organization slug already taken');
      }
      throw error;
    }
  }

  async findOne(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return null;
    const { logoKey, bannerKey, ...rest } = org;
    const logoUrl = logoKey ? await this.storage.getSignedDownloadUrl(logoKey, SIGNED_URL_TTL_SECONDS) : null;
    const bannerUrl = bannerKey ? await this.storage.getSignedDownloadUrl(bannerKey, SIGNED_URL_TTL_SECONDS) : null;
    return { ...rest, logoUrl, bannerUrl };
  }

  private async uploadBrandingImage(
    organizationId: string,
    kind: BrandingKind,
    file: UploadedFile | undefined,
    actorUserId: string,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    const ext = ALLOWED_IMAGE_MIME[file.mimetype];
    if (!ext) throw new BadRequestException('Only PNG, JPEG, or WebP images are accepted');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('File exceeds the 2MB limit');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const field = kind === 'logo' ? 'logoKey' : 'bannerKey';
    const oldKey = kind === 'logo' ? organization.logoKey : organization.bannerKey;
    const newKey = `branding/${organizationId}/${kind}.${ext}`;

    await this.storage.putObject(newKey, file.buffer, file.mimetype);

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data: { [field]: newKey } });
      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: `organization.${kind}.upload`,
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { key: newKey },
        },
        tx,
      );
    });

    if (oldKey && oldKey !== newKey) {
      await this.storage.deleteObject(oldKey);
    }

    return this.findOne(organizationId);
  }

  uploadLogo(organizationId: string, file: UploadedFile | undefined, actorUserId: string) {
    return this.uploadBrandingImage(organizationId, 'logo', file, actorUserId);
  }

  uploadBanner(organizationId: string, file: UploadedFile | undefined, actorUserId: string) {
    return this.uploadBrandingImage(organizationId, 'banner', file, actorUserId);
  }

  private async deleteBrandingImage(organizationId: string, kind: BrandingKind, actorUserId: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const field = kind === 'logo' ? 'logoKey' : 'bannerKey';
    const key = kind === 'logo' ? organization.logoKey : organization.bannerKey;
    if (!key) return this.findOne(organizationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data: { [field]: null } });
      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: `organization.${kind}.delete`,
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { key },
        },
        tx,
      );
    });

    await this.storage.deleteObject(key);
    return this.findOne(organizationId);
  }

  deleteLogo(organizationId: string, actorUserId: string) {
    return this.deleteBrandingImage(organizationId, 'logo', actorUserId);
  }

  deleteBanner(organizationId: string, actorUserId: string) {
    return this.deleteBrandingImage(organizationId, 'banner', actorUserId);
  }

  listForUser(userId: string) {
    return this.prisma.organization.findMany({
      where: { memberships: { some: { userId } } },
      orderBy: { name: 'asc' },
    });
  }

  async updateProfile(
    organizationId: string,
    dto: UpdateOrganizationDto,
    actorUserId?: string,
  ) {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.socialLinks !== undefined) data.socialLinks = dto.socialLinks as Prisma.InputJsonValue;
    if (dto.advisors !== undefined) data.advisors = dto.advisors as Prisma.InputJsonValue;

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({ where: { id: organizationId }, data });
      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: 'organization.profile.update',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: { fields: Object.keys(data) },
        },
        tx,
      );
      return org;
    });
  }

  async updateSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
    actorUserId?: string,
  ) {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.primaryColor !== undefined) {
      data.primaryColor = dto.primaryColor;
    }
    if (dto.secondaryColor !== undefined) {
      data.secondaryColor = dto.secondaryColor;
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({ where: { id: organizationId }, data });
      await this.audit.record(
        {
          organizationId,
          actorUserId,
          action: 'organization.settings.update',
          targetType: 'Organization',
          targetId: organizationId,
          metadata: data as Record<string, unknown>,
        },
        tx,
      );
      return org;
    });
  }
}
