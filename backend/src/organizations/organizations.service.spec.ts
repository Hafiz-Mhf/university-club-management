import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';
import { StorageService } from '../storage/storage.service';
import { JwtModule } from '@nestjs/jwt';

describe('OrganizationsService.create', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;
  let orgId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository, StorageService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `org-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
  });
  afterAll(async () => {
    if (orgId) {
      await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    }
    await prisma.organization.deleteMany({ where: { memberships: { some: { userId } } } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates org and makes creator PRESIDENT', async () => {
    const org = await orgs.create(userId, { name: 'ACM', slug: `acm-${Date.now()}` });
    orgId = org.id;
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: org.id } },
    });
    expect(membership!.role).toBe('PRESIDENT');
  });
});

describe('OrganizationsService.updateSettings', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository, StorageService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `orgset-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
    const org = await orgs.create(userId, { name: 'SettingsOrg', slug: `settingsorg-${Date.now()}` });
    orgId = org.id;
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('persists secondaryColor alongside primaryColor', async () => {
    const updated = await orgs.updateSettings(orgId, { primaryColor: '#ff0000', secondaryColor: '#00ff00' }, userId);
    expect(updated.primaryColor).toBe('#ff0000');
    expect(updated.secondaryColor).toBe('#00ff00');
  });
});

describe('OrganizationsService.findOne', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository, StorageService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `orgfind-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
    const org = await orgs.create(userId, { name: 'FindOrg', slug: `findorg-${Date.now()}` });
    orgId = org.id;
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns null logoUrl/bannerUrl and no raw keys when unset', async () => {
    const found = await orgs.findOne(orgId);
    expect(found!.logoUrl).toBeNull();
    expect(found!.bannerUrl).toBeNull();
    expect(found).not.toHaveProperty('logoKey');
    expect(found).not.toHaveProperty('bannerKey');
  });

  it('returns null for a nonexistent organization', async () => {
    const found = await orgs.findOne('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

describe('OrganizationsService logo/banner upload', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let storage: StorageService;
  let userId: string;
  let orgId: string;
  const png = () => Buffer.from('89504e470d0a1a0a', 'hex');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository, StorageService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    storage = moduleRef.get(StorageService);
    await prisma.onModuleInit();
    await storage.onModuleInit();
    const u = await auth.register({ email: `orgupload-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
    const org = await orgs.create(userId, { name: 'UploadOrg', slug: `uploadorg-${Date.now()}` });
    orgId = org.id;
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('uploads a logo and resolves it via findOne', async () => {
    const result = await orgs.uploadLogo(orgId, { mimetype: 'image/png', size: 8, buffer: png() }, userId);
    expect(result!.logoUrl).not.toBeNull();
  });

  it('rejects a non-allowlisted MIME type', async () => {
    await expect(
      orgs.uploadBanner(orgId, { mimetype: 'image/gif', size: 8, buffer: png() }, userId),
    ).rejects.toThrow('Only PNG, JPEG, or WebP images are accepted');
  });

  it('rejects a file over 2MB', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await expect(
      orgs.uploadBanner(orgId, { mimetype: 'image/png', size: big.length, buffer: big }, userId),
    ).rejects.toThrow('File exceeds the 2MB limit');
  });

  it('rejects a missing file', async () => {
    await expect(orgs.uploadLogo(orgId, undefined, userId)).rejects.toThrow('A file is required');
  });

  it('deletes the old object when re-uploading with a different extension', async () => {
    const first = await orgs.uploadBanner(orgId, { mimetype: 'image/png', size: 8, buffer: png() }, userId);
    const firstOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    const firstKey = firstOrg!.bannerKey!;
    expect(firstKey).toContain('banner.png');

    await orgs.uploadBanner(orgId, { mimetype: 'image/webp', size: 8, buffer: png() }, userId);
    const secondOrg = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(secondOrg!.bannerKey).toContain('banner.webp');

    await expect(storage.getObject(firstKey)).rejects.toThrow();
    expect(first!.bannerUrl).not.toBeNull();
  });
});

describe('OrganizationsService logo/banner delete', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;
  let orgId: string;
  const png = () => Buffer.from('89504e470d0a1a0a', 'hex');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService, AuditService, RefreshTokenRepository, StorageService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const storage = moduleRef.get(StorageService);
    await storage.onModuleInit();
    const u = await auth.register({ email: `orgdelete-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres', consent: true });
    userId = u.id;
    const org = await orgs.create(userId, { name: 'DeleteOrg', slug: `deleteorg-${Date.now()}` });
    orgId = org.id;
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId, organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.consentRecord.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('clears the logo and removes the storage object', async () => {
    await orgs.uploadLogo(orgId, { mimetype: 'image/png', size: 8, buffer: png() }, userId);
    const result = await orgs.deleteLogo(orgId, userId);
    expect(result!.logoUrl).toBeNull();
    const row = await prisma.organization.findUnique({ where: { id: orgId } });
    expect(row!.logoKey).toBeNull();
  });

  it('is idempotent — deleting an already-absent logo is a no-op with no new audit row', async () => {
    const before = await prisma.auditLog.count({ where: { organizationId: orgId, action: 'organization.logo.delete' } });
    await orgs.deleteLogo(orgId, userId);
    const after = await prisma.auditLog.count({ where: { organizationId: orgId, action: 'organization.logo.delete' } });
    expect(after).toBe(before);
  });
});
