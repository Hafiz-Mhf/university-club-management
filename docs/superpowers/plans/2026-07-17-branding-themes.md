# Branding & Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw, unvalidated `logoKey`/`primaryColor` string fields on `Organization` with a real branding feature — validated logo/banner upload (multipart, MIME/size checked), a `secondaryColor` field, and consistent signed-URL resolution across the authenticated org view and the existing public club page.

**Architecture:** Extends `backend/src/organizations/` (no new module). Two multipart upload endpoints (`POST .../logo`, `.../banner`) and two delete endpoints, all synchronous — no BullMQ queue, this is single-file low-latency work. `OrganizationsService` gains a `StorageService` dependency it didn't previously need. No new Prisma model, two new columns on `Organization`.

**Tech Stack:** NestJS, Prisma, `@nestjs/platform-express` `FileInterceptor` (same pattern as `CertificatesController`), existing `StorageService` (MinIO/S3).

## Global Constraints

- Logo/banner: PNG/JPEG/WebP only, ≤2MB per upload.
- Logo/banner do NOT count against the shared org storage quota (flat cap only — no `logoSizeBytes`/`bannerSizeBytes` column, no change to the `Certificate`/`OrgFile`/`GalleryPhoto` quota aggregate in `files.service.ts`/`certificates.service.ts`/`gallery.service.ts`).
- Logo/banner upload+delete RBAC: `PRESIDENT`, `VICE_PRESIDENT` (matches `updateProfile()`'s existing roles).
- Settings (`primaryColor`/`secondaryColor`) RBAC: `PRESIDENT` only (unchanged).
- Every mutation is audited via `AuditService.record({ organizationId, actorUserId, action, targetType, targetId, metadata }, tx?)` inside the same `$transaction` as the DB write. No audit row for a no-op delete (key already absent).
- Storage object writes/deletes happen outside the `$transaction` (never roll back a Prisma transaction because an S3 call failed, and never leave a DB row referencing bytes that were never written) — write new object first, commit the transaction, delete the old object last.
- `docker compose` stack (postgres/minio/redis/mailpit) must be running (`docker compose up -d` from repo root) before any test run — this has stopped between session pauses before and is not a code bug.

---

## File Structure

```
backend/prisma/schema.prisma                              # +bannerKey, +secondaryColor on Organization
backend/src/organizations/
  organizations.service.ts                                 # +StorageService dep, +uploadLogo/uploadBanner/deleteLogo/deleteBanner,
                                                              # findOne() resolves signed URLs, updateSettings() +secondaryColor,
                                                              # updateProfile() drops logoKey handling
  organizations.controller.ts                                # +4 routes: POST/DELETE logo, POST/DELETE banner
  organizations.module.ts                                    # +StorageModule import
  organizations.service.spec.ts                              # +tests for all of the above (real Prisma + real StorageService, matching this file's existing style)
  dto/update-organization.dto.ts                             # -logoKey
  dto/update-organization-settings.dto.ts                    # +secondaryColor
backend/src/public/public.service.ts                        # requireOrganization() selects bannerKey, getProfile() returns bannerUrl
backend/test/organization-branding.e2e-spec.ts               # new e2e suite
backend/test/public-profile.e2e-spec.ts                      # +1 test: bannerUrl on public profile
```

---

### Task 1: Schema migration + settings/profile DTO changes

**Files:**
- Modify: `backend/prisma/schema.prisma:97-117` (Organization model)
- Modify: `backend/src/organizations/dto/update-organization-settings.dto.ts`
- Modify: `backend/src/organizations/dto/update-organization.dto.ts`
- Modify: `backend/src/organizations/organizations.service.ts:47-101` (`updateProfile`, `updateSettings`)
- Test: `backend/src/organizations/organizations.service.spec.ts`

**Interfaces:**
- Produces: `Organization.secondaryColor: string` (default `"#1e293b"`), `Organization.bannerKey: string | null`. `UpdateOrganizationSettingsDto.secondaryColor?: string`. `OrganizationsService.updateSettings(organizationId, dto, actorUserId)` now also accepts `secondaryColor`.

- [ ] **Step 1: Edit the Prisma schema**

In `backend/prisma/schema.prisma`, replace:

```prisma
model Organization {
  id             String       @id @default(uuid())
  name           String
  slug           String       @unique
  description    String?
  logoKey        String?
  advisors       Json?
  socialLinks    Json?
  storageQuotaMb Int          @default(1024)
  primaryColor   String       @default("#2563eb")
  settings       Json?
```

with:

```prisma
model Organization {
  id             String       @id @default(uuid())
  name           String
  slug           String       @unique
  description    String?
  logoKey        String?
  bannerKey      String?
  advisors       Json?
  socialLinks    Json?
  storageQuotaMb Int          @default(1024)
  primaryColor   String       @default("#2563eb")
  secondaryColor String       @default("#1e293b")
  settings       Json?
```

- [ ] **Step 2: Run the migration**

Run: `cd backend && npx prisma migrate dev --name add_org_branding_fields && npx prisma generate`
Expected: migration applies cleanly (additive columns, no data loss), Prisma Client regenerates without errors.

- [ ] **Step 3: Add `secondaryColor` to the settings DTO**

Replace the full contents of `backend/src/organizations/dto/update-organization-settings.dto.ts`:

```ts
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateOrganizationSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'primaryColor must be a hex color like #2563eb' })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#([0-9a-fA-F]{6})$/, { message: 'secondaryColor must be a hex color like #1e293b' })
  secondaryColor?: string;
}
```

- [ ] **Step 4: Remove `logoKey` from the profile DTO**

Replace the full contents of `backend/src/organizations/dto/update-organization.dto.ts`:

```ts
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  socialLinks?: Record<string, string>;

  @IsOptional()
  advisors?: string[];
}
```

- [ ] **Step 5: Update `updateProfile()` and `updateSettings()` in the service**

In `backend/src/organizations/organizations.service.ts`, in `updateProfile()`, remove the line:

```ts
    if (dto.logoKey !== undefined) data.logoKey = dto.logoKey;
```

In `updateSettings()`, replace:

```ts
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.primaryColor !== undefined) {
      data.primaryColor = dto.primaryColor;
    }
```

with:

```ts
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.primaryColor !== undefined) {
      data.primaryColor = dto.primaryColor;
    }
    if (dto.secondaryColor !== undefined) {
      data.secondaryColor = dto.secondaryColor;
    }
```

- [ ] **Step 6: Write the failing test**

Append to `backend/src/organizations/organizations.service.spec.ts` (new `describe` block after the existing one, same file — reuses the file's real-Prisma/real-AuthService pattern):

```ts
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
```

Note: `OrganizationsService`'s constructor will gain a `StorageService` dependency in Task 2 — this test's provider list already includes it so Task 1's test doesn't break once Task 2 lands. `StorageService` needs to be imported at the top of the spec file: add `import { StorageService } from '../storage/storage.service';`.

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -t "persists secondaryColor" -v`
Expected: FAIL — `OrganizationsService`'s constructor doesn't accept `StorageService` yet (Nest DI error), or `secondaryColor` doesn't exist on the update result, depending on how far Step 5/2 have landed. Since Step 2 (migration) already ran, the DB column exists; the failure here should be about DI (Task 2 hasn't added `StorageService` to the real constructor yet) — expected error: `Nest can't resolve dependencies of the OrganizationsService`. This confirms the test exercises real wiring, not a stub.

Since Task 2 hasn't run yet, temporarily skip strict pass/fail interpretation of this step — the goal is only to confirm no false-positive pass. Proceed to Step 8.

- [ ] **Step 8: Run the full DTO/service change in isolation, then re-run**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -v`
Expected: the pre-existing `create` test still passes; the new `updateSettings` test fails only because `StorageService` isn't wired into the constructor yet (that's Task 2). Confirm the failure message is a DI error, not an assertion error — this proves Steps 3-5 are correct and the only missing piece is Task 2's constructor change.

- [ ] **Step 9: Commit**

```bash
cd backend && git add prisma/schema.prisma prisma/migrations src/organizations/dto/update-organization.dto.ts src/organizations/dto/update-organization-settings.dto.ts src/organizations/organizations.service.ts src/organizations/organizations.service.spec.ts
git commit -m "feat: add secondaryColor/bannerKey to Organization, drop raw logoKey PATCH"
```

---

### Task 2: `findOne()` signed-URL resolution + StorageService wiring

**Files:**
- Modify: `backend/src/organizations/organizations.service.ts:1-46` (constructor, `findOne`)
- Modify: `backend/src/organizations/organizations.module.ts`
- Test: `backend/src/organizations/organizations.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService.getSignedDownloadUrl(key: string, expirySeconds: number): Promise<string>` (existing, `backend/src/storage/storage.service.ts:60-64`).
- Produces: `OrganizationsService.findOne(organizationId: string): Promise<{ id, name, slug, description, advisors, socialLinks, storageQuotaMb, primaryColor, secondaryColor, settings, createdAt, updatedAt, logoUrl: string | null, bannerUrl: string | null } | null>` — raw `logoKey`/`bannerKey` are no longer in the returned object.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/organizations/organizations.service.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -t "findOne" -v`
Expected: FAIL — `Nest can't resolve dependencies of the OrganizationsService (?, AuditService)` (no `StorageService` provider wired into the real constructor yet).

- [ ] **Step 3: Wire `StorageService` into the constructor and rewrite `findOne`**

In `backend/src/organizations/organizations.service.ts`, replace the imports and constructor:

```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AuditService } from '../audit/audit.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}
```

Replace the existing `findOne` method:

```ts
  findOne(organizationId: string) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }
```

with:

```ts
  async findOne(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) return null;
    const { logoKey, bannerKey, ...rest } = org;
    const logoUrl = logoKey ? await this.storage.getSignedDownloadUrl(logoKey, SIGNED_URL_TTL_SECONDS) : null;
    const bannerUrl = bannerKey ? await this.storage.getSignedDownloadUrl(bannerKey, SIGNED_URL_TTL_SECONDS) : null;
    return { ...rest, logoUrl, bannerUrl };
  }
```

- [ ] **Step 4: Wire `StorageModule` into `OrganizationsModule`**

Replace the full contents of `backend/src/organizations/organizations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { TenancyModule } from '../tenancy/tenancy.module';
import { RbacModule } from '../rbac/rbac.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TenancyModule, RbacModule, StorageModule],
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -v`
Expected: all tests pass, including Task 1's `updateSettings` test (now that `StorageService` resolves) and both new `findOne` tests.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/organizations/organizations.service.ts src/organizations/organizations.module.ts src/organizations/organizations.service.spec.ts
git commit -m "feat: OrganizationsService.findOne resolves signed logo/banner URLs"
```

---

### Task 3: Logo/banner upload

**Files:**
- Modify: `backend/src/organizations/organizations.service.ts`
- Test: `backend/src/organizations/organizations.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService.putObject(key: string, buffer: Buffer, contentType: string): Promise<void>`, `StorageService.deleteObject(key: string): Promise<void>` (existing).
- Produces: `OrganizationsService.uploadLogo(organizationId: string, file: UploadedFile | undefined, actorUserId: string): Promise<ResolvedOrganization>`, `OrganizationsService.uploadBanner(...)` — same signature. `UploadedFile = { mimetype: string; size: number; buffer: Buffer }` (matches `CertificatesService`'s existing type).

- [ ] **Step 1: Write the failing test**

Append to `backend/src/organizations/organizations.service.spec.ts`:

```ts
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

    const storage = new StorageService(new (require('@nestjs/config').ConfigService)());
    await storage.onModuleInit();
    await expect(storage.getObject(firstKey)).rejects.toThrow();
    expect(first!.bannerUrl).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -t "logo/banner upload" -v`
Expected: FAIL — `orgs.uploadLogo is not a function`.

- [ ] **Step 3: Implement `uploadLogo`/`uploadBanner`**

In `backend/src/organizations/organizations.service.ts`, add near the top (after imports, before the class):

```ts
const ALLOWED_IMAGE_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };
type BrandingKind = 'logo' | 'banner';
```

Add these imports at the top:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

(Replace the existing `import { ConflictException, Injectable } from '@nestjs/common';` line with the above — `BadRequestException` and `NotFoundException` are new.)

Add these methods to the class (after `findOne`, before `listForUser`):

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -v`
Expected: all tests pass (Task 1, 2, and 3's specs).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/organizations/organizations.service.ts src/organizations/organizations.service.spec.ts
git commit -m "feat: OrganizationsService.uploadLogo/uploadBanner with MIME/size validation"
```

---

### Task 4: Logo/banner delete

**Files:**
- Modify: `backend/src/organizations/organizations.service.ts`
- Test: `backend/src/organizations/organizations.service.spec.ts`

**Interfaces:**
- Consumes: same `StorageService` methods as Task 3.
- Produces: `OrganizationsService.deleteLogo(organizationId: string, actorUserId: string): Promise<ResolvedOrganization>`, `OrganizationsService.deleteBanner(...)` — same signature.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/organizations/organizations.service.spec.ts`:

```ts
describe('OrganizationsService logo/banner delete', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let audit: AuditService;
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
    audit = moduleRef.get(AuditService);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -t "logo/banner delete" -v`
Expected: FAIL — `orgs.deleteLogo is not a function`.

- [ ] **Step 3: Implement `deleteLogo`/`deleteBanner`**

In `backend/src/organizations/organizations.service.ts`, add after `uploadBanner`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest src/organizations/organizations.service.spec.ts -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/organizations/organizations.service.ts src/organizations/organizations.service.spec.ts
git commit -m "feat: OrganizationsService.deleteLogo/deleteBanner, idempotent on absent key"
```

---

### Task 5: Controller endpoints

**Files:**
- Modify: `backend/src/organizations/organizations.controller.ts`
- Test: `backend/test/organization-branding.e2e-spec.ts` (new — this task writes the first slice; Task 6 completes the suite)

**Interfaces:**
- Consumes: `OrganizationsService.uploadLogo/uploadBanner/deleteLogo/deleteBanner` (Tasks 3-4).
- Produces: `POST /organizations/:orgId/logo`, `DELETE /organizations/:orgId/logo`, `POST /organizations/:orgId/banner`, `DELETE /organizations/:orgId/banner`.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/organization-branding.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Organization branding (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let vpToken: string;
  let memberToken: string;
  let orgId: string;
  const pngBytes = () => Buffer.from('89504e470d0a1a0a', 'hex');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`brand-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'BrandOrg', slug: `brand-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee uploads a logo, GET reflects a fetchable logoUrl', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.logoUrl).toBeTruthy();

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(getRes.body.logoUrl).toBeTruthy();
    expect(getRes.body.logoKey).toBeUndefined();

    const fetched = await fetch(getRes.body.logoUrl);
    expect(fetched.status).toBe(200);
  });

  it('committee uploads a banner, GET reflects a fetchable bannerUrl', async () => {
    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/banner`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'banner.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.bannerUrl).toBeTruthy();
  });

  it('400 rejects a non-image MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 2MB', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  it('400 when no file is attached', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(400);
  });

  it('a plain member cannot upload a logo (403)', async () => {
    memberToken = await registerAndLogin(`brand-member-${Date.now()}@test.io`);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ userId: 'placeholder' })
      .catch(() => undefined);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${memberToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(403);
  });

  it('deletes the logo — idempotent on a second call', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);

    const firstDelete = await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(firstDelete.body.logoUrl).toBeNull();

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });

  it('PATCH .../settings round-trips secondaryColor', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ secondaryColor: '#123456' })
      .expect(200);
    expect(res.body.secondaryColor).toBe('#123456');
  });

  it('400 rejects an invalid secondaryColor hex', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ secondaryColor: 'not-a-color' })
      .expect(400);
  });

  it('tenant isolation: uploading against another org is 403/404, never affects it', async () => {
    const otherPresToken = await registerAndLogin(`brand-other-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`).send({ name: 'OtherOrg', slug: `other-${Date.now()}` })).body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/logo`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'logo.png', contentType: 'image/png' })
      .expect(403);

    const otherOrg = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(200);
    expect(otherOrg.body.logoUrl).toBeNull();
  });
});
```

Note: the "plain member cannot upload" test's `POST .../members` call is speculative scaffolding from an unrelated module and will 404/error harmlessly (`.catch(() => undefined)` swallows it) — `memberToken` belongs to a user with no membership in `orgId` at all, which is sufficient to prove the 403 (no membership means no role, `RolesGuard` denies). Remove that dead `POST .../members` call if it produces confusing output; it's not required for the assertion to hold.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-e2e.json organization-branding -v`
Expected: FAIL — `404` on `POST /organizations/:orgId/logo` (route doesn't exist yet).

- [ ] **Step 3: Add the controller endpoints**

Replace the full contents of `backend/src/organizations/organizations.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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

const BRANDING_UPLOAD_LIMITS = { limits: { fileSize: 2 * 1024 * 1024 } };

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
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `cd backend && npx jest --config ./test/jest-e2e.json organization-branding -v`
Expected: all tests pass. If the "tenant isolation" test's `POST .../logo` against `otherOrgId` returns `403` rather than expecting a different code — confirm this matches `TenantGuard`'s existing behavior (a token whose user has no membership in the target org): check `backend/src/tenancy/tenant.guard.ts` if the assertion fails, and adjust the expected status to match its actual behavior (403 is the documented pattern used by every other tenant-isolation test in this codebase, e.g. `certificate-generation.e2e-spec.ts`).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/organizations/organizations.controller.ts test/organization-branding.e2e-spec.ts
git commit -m "feat: logo/banner upload+delete endpoints on OrganizationsController"
```

---

### Task 6: Public page banner support

**Files:**
- Modify: `backend/src/public/public.service.ts:20-46`
- Test: `backend/test/public-profile.e2e-spec.ts`

**Interfaces:**
- Consumes: `Organization.bannerKey` (Task 1), `StorageService.getSignedDownloadUrl` (existing).
- Produces: `PublicService.getProfile()` response gains `bannerUrl: string | null`.

- [ ] **Step 1: Write the failing test**

Append to `backend/test/public-profile.e2e-spec.ts`, inside the existing `describe` block, after the first `it`:

```ts
  it('reflects a fetchable bannerUrl after the committee uploads one', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/banner`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('89504e470d0a1a0a', 'hex'), { filename: 'banner.png', contentType: 'image/png' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}/profile`)
      .expect(200);
    expect(res.body.bannerUrl).toBeTruthy();
    const fetched = await fetch(res.body.bannerUrl);
    expect(fetched.status).toBe(200);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest --config ./test/jest-e2e.json public-profile -v`
Expected: FAIL — `res.body.bannerUrl` is `undefined` (`requireOrganization`'s Prisma `select` doesn't include `bannerKey` yet, `getProfile` doesn't return it).

- [ ] **Step 3: Update `public.service.ts`**

In `backend/src/public/public.service.ts`, replace `requireOrganization`:

```ts
  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, description: true, logoKey: true, bannerKey: true, primaryColor: true, socialLinks: true, advisors: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }
```

Replace `getProfile`:

```ts
  async getProfile(organizationId: string) {
    const organization = await this.requireOrganization(organizationId);
    const logoUrl = organization.logoKey
      ? await this.storage.getSignedDownloadUrl(organization.logoKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const bannerUrl = organization.bannerKey
      ? await this.storage.getSignedDownloadUrl(organization.bannerKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const upcomingEvents = await this.events.listPublicUpcoming(organizationId);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest --config ./test/jest-e2e.json public-profile -v`
Expected: both the pre-existing tests and the new one pass.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/public/public.service.ts test/public-profile.e2e-spec.ts
git commit -m "feat: public club profile surfaces bannerUrl"
```

---

### Task 7: Full-suite verification

**Files:** none (verification-only task).

- [ ] **Step 1: Run the full unit suite**

Run: `cd backend && npm test`
Expected: all suites pass. Baseline before this plan was 76/76 (verified at spec-approval time) — this plan adds roughly 12 new unit tests across `organizations.service.spec.ts` (Tasks 1-4), so expect approximately 88/88. Treat this as a sanity check, not a hard gate — if the actual count differs, confirm every *new* test passes and no *existing* test newly fails, rather than chasing an exact number.

- [ ] **Step 2: Run the full e2e suite**

Run: `cd backend && npm run test:e2e`
Expected: all suites pass. Baseline before this plan was 290/290 — this plan adds 1 new e2e file (`organization-branding.e2e-spec.ts`, ~10 tests) plus 1 test to `public-profile.e2e-spec.ts`, so expect approximately 301/301. Same non-exact-number caveat as Step 1.

- [ ] **Step 3: If everything passes, this plan is complete**

No commit for this task — it's verification only. Proceed to the docs-sync step (updating `docs/database.md` and `docs/security.md`) outside this plan, per the standing "pause before docs sync" preference.
