# Public Club Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a committee-managed Gallery, committee-managed Achievements, and — for the first time in this codebase — three genuinely unauthenticated public routes exposing org profile info, upcoming events, gallery photos, and achievements to anyone.

**Architecture:** `GalleryModule` (`backend/src/gallery/`) and `AchievementsModule` (`backend/src/achievements/`) follow the established committee-CRUD shape (`MANAGE_EVENTS` writes, any-member reads). `PublicModule` (`backend/src/public/`) has its own controller with **zero guards on every route** — it reuses `GalleryService.list`, `AchievementsService.list`, `OrganizationsService`, and a new `EventsService.listPublicUpcoming` method rather than duplicating logic. Every public method explicitly checks the org exists (no `TenantGuard` to do it implicitly).

**Tech Stack:** NestJS, Prisma (PostgreSQL), `@nestjs/platform-express` `FileInterceptor` (existing precedent from Certificates/Files), `crypto.randomUUID()` for storage keys.

## Global Constraints

- Gallery: upload/delete → `MANAGE_EVENTS`. List → any ACTIVE member, **and the list response embeds a signed `downloadUrl` per photo** (not metadata-only like File Repository — a gallery exists to render a grid of images, not to be browsed then fetched one at a time). No edit route — caption changes are delete + re-upload. No separate single-photo download endpoint — the list already carries the signed URLs.
- Gallery upload: MIME allowlist `image/png`/`image/jpeg` only, size ≤ 10MB (interceptor ceiling 15MB). Storage quota check sums `Certificate` + `OrgFile` + `GalleryPhoto` (three tables now, extending File Repository's two-table pattern).
- `GalleryPhoto.storageKey`: `gallery/{organizationId}/{randomUUID()}.{ext}`.
- Achievements: create/edit/delete → `MANAGE_EVENTS`. List/get → any ACTIVE member. `title`/`description` required non-empty strings, `year` required int, no range bound. List unpaginated, sorted `year desc`.
- Both `GalleryPhoto` and `Achievement` go in `TENANT_SCOPED_MODELS`.
- Public routes (`/public/organizations/:orgId/*`): **no guards at all** — not `JwtAuthGuard`, not `TenantGuard`, not `RolesGuard`. Each method explicitly checks `organizationId` exists and throws `NotFoundException` if not.
- Public profile response is a fixed field allowlist: `name`, `description`, `logoUrl` (signed URL from `logoKey` if set, else `null`), `primaryColor`, `socialLinks`, `advisors`, `upcomingEvents` — never `storageQuotaMb`, `settings`, or any other `Organization` column.
- `EventsService.listPublicUpcoming(organizationId)`: `status: 'PUBLISHED'`, `startAt: { gte: new Date() }`, sorted `startAt asc`.
- Five new audit actions: `gallery.upload`, `gallery.delete`, `achievement.create`, `achievement.update`, `achievement.delete`. Public reads are unaudited.
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.

---

### Task 1: Schema (GalleryPhoto + Achievement) + GalleryModule scaffold + upload endpoint

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/**` (generated)
- Modify: `backend/src/prisma/tenant-scope.middleware.ts`
- Create: `backend/src/gallery/dto/upload-photo.dto.ts`
- Create: `backend/src/gallery/gallery.service.ts`
- Create: `backend/src/gallery/gallery.controller.ts`
- Create: `backend/src/gallery/gallery.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/gallery-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `StorageService` (`putObject`, `getSignedDownloadUrl`, `deleteObject` — `backend/src/storage/storage.service.ts`), `AuditService` (`record`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`CurrentUser`/`MANAGE_EVENTS` (same imports as `FilesController`).
- Produces: `GalleryPhoto` Prisma model (`id, organizationId, storageKey, caption, uploadedByUserId, createdAt`) and `Achievement` Prisma model (`id, organizationId, title, description, year, createdByUserId, createdAt, updatedAt`), both reachable via `prisma.galleryPhoto.*`/`prisma.achievement.*`. `GalleryService.upload(organizationId: string, caption: string | undefined, file: { mimetype: string; size: number; buffer: Buffer } | undefined, actorUserId: string): Promise<GalleryPhoto>`. Route `POST /organizations/:orgId/gallery`. Tasks 2 adds more methods to `GalleryService`/`GalleryController` in these same two files. Task 3 creates the sibling `AchievementsModule` using the `Achievement` model defined here.

- [ ] **Step 1: Add `GalleryPhoto` and `Achievement` models to `schema.prisma`**

Open `backend/prisma/schema.prisma`. Add both models directly after the `Asset` model (before `CertificateDownload`):

```prisma
model GalleryPhoto {
  id               String       @id @default(uuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id])
  storageKey       String
  caption          String?
  fileSizeBytes    Int
  uploadedByUserId String
  createdAt        DateTime     @default(now())

  @@index([organizationId])
}

model Achievement {
  id              String       @id @default(uuid())
  organizationId  String
  organization    Organization @relation(fields: [organizationId], references: [id])
  title           String
  description     String
  year            Int
  createdByUserId String
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId])
}
```

Add two fields to the existing `Organization` model (in its list of relation fields, e.g. right after `assets Asset[]`):

```prisma
  galleryPhotos  GalleryPhoto[]
  achievements   Achievement[]
```

- [ ] **Step 2: Add both models to `TENANT_SCOPED_MODELS`**

In `backend/src/prisma/tenant-scope.middleware.ts`, update line 4:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes', 'Asset', 'GalleryPhoto', 'Achievement'];
```

- [ ] **Step 3: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add_gallery_and_achievement_models
```

Expected: migration applies cleanly, Prisma Client regenerates with `galleryPhoto` and `achievement` delegates. Confirm with:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 4: Write the failing e2e tests for gallery upload**

Create `backend/test/gallery-upload.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Gallery upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  const pres = `gal-${Date.now()}@test.io`;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GalOrg', slug: `gal-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member uploads a photo with a caption', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', 'Annual Dinner 2025')
      .attach('file', pngBytes(), { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body.caption).toBe('Annual Dinner 2025');
    expect(res.body.organizationId).toBe(orgId);
  });

  it('a plain participant cannot upload (403)', async () => {
    const email = `galp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
      .expect(403);
  });

  it('400 rejects an unsupported MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 10MB', async () => {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  it('400 when the upload would exceed the org storage quota (summed across Certificate + OrgFile + GalleryPhoto)', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 0 } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 1024 } });
  });
});
```

- [ ] **Step 5: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json gallery-upload
```

Expected: FAIL — `Cannot POST /organizations/:orgId/gallery` (404), no `GalleryModule` exists yet.

- [ ] **Step 6: Create the upload DTO**

Create `backend/src/gallery/dto/upload-photo.dto.ts`:

```ts
import { IsOptional, IsString } from 'class-validator';

export class UploadPhotoDto {
  @IsOptional() @IsString() caption?: string;
}
```

- [ ] **Step 7: Create `GalleryService`**

Create `backend/src/gallery/gallery.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(organizationId: string, caption: string | undefined, file: UploadedFile | undefined, actorUserId: string) {
    if (!file) throw new BadRequestException('A file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Unsupported file type');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('File exceeds the 10MB limit');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const [certUsage, fileUsage, photoUsage] = await Promise.all([
      this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.orgFile.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.galleryPhoto.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
    ]);
    const usedBytes = (certUsage._sum.fileSizeBytes ?? 0) + (fileUsage._sum.fileSizeBytes ?? 0) + (photoUsage._sum.fileSizeBytes ?? 0);
    const quotaBytes = organization!.storageQuotaMb * 1024 * 1024;
    if (usedBytes + file.size > quotaBytes) {
      throw new BadRequestException('Organization storage quota exceeded');
    }

    const ext = EXT_BY_MIME[file.mimetype];
    const storageKey = `gallery/${organizationId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(storageKey, file.buffer, file.mimetype);

    return this.prisma.$transaction(async (tx) => {
      const photo = await tx.galleryPhoto.create({
        data: {
          organizationId, storageKey, caption,
          fileSizeBytes: file.size, uploadedByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'gallery.upload',
        targetType: 'GalleryPhoto', targetId: photo.id,
        metadata: { photoId: photo.id, caption },
      }, tx);
      return photo;
    });
  }
}
```

`SIGNED_URL_TTL_SECONDS` is unused in this task — Task 2 uses it in `list`.

- [ ] **Step 8: Create `GalleryController`**

Create `backend/src/gallery/gallery.controller.ts`:

```ts
import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
}
```

- [ ] **Step 9: Create `GalleryModule`**

Create `backend/src/gallery/gallery.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GalleryController } from './gallery.controller';
import { GalleryService } from './gallery.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [GalleryController],
  providers: [GalleryService],
  exports: [GalleryService],
})
export class GalleryModule {}
```

- [ ] **Step 10: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { GalleryModule } from './gallery/gallery.module';
```

Add `GalleryModule` to the `imports` array, after `AssetsModule`:

```ts
    AssetsModule,
    GalleryModule,
```

- [ ] **Step 11: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json gallery-upload
```

Expected: all tests PASS.

- [ ] **Step 12: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `250 passed` (245 baseline from the Asset Management phase + 5 new in `gallery-upload.e2e-spec.ts`).

- [ ] **Step 13: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/prisma/tenant-scope.middleware.ts backend/src/gallery backend/src/app.module.ts backend/test/gallery-upload.e2e-spec.ts
git commit -m "feat: gallery + achievements schema; gallery upload endpoint"
```

---

### Task 2: Gallery list (with signed URLs) + delete endpoints

**Files:**
- Modify: `backend/src/gallery/gallery.service.ts`
- Modify: `backend/src/gallery/gallery.controller.ts`
- Test: `backend/test/gallery-list-delete.e2e-spec.ts`

**Interfaces:**
- Consumes: `GalleryService`/`GalleryController` from Task 1 (same files, extended in place).
- Produces: `GalleryService.list(organizationId: string): Promise<Array<{ id: string; caption: string | null; downloadUrl: string; createdAt: Date }>>`. `GalleryService.remove(organizationId: string, photoId: string, actorUserId: string): Promise<{ removed: true }>`. Routes `GET /organizations/:orgId/gallery` and `DELETE /organizations/:orgId/gallery/:photoId`. Task 6's `PublicModule` calls `GalleryService.list` directly — no further changes to these two files after this task.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/gallery-list-delete.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Gallery list + delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadPhoto(caption: string, bytes: Buffer) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', caption)
      .attach('file', bytes, { filename: 'p.png', contentType: 'image/png' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`gld-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GldOrg', slug: `gld-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('list includes a working signed downloadUrl per photo', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x99]);
    await uploadPhoto('Roundtrip Photo', bytes);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const entry = res.body.find((p: { caption: string }) => p.caption === 'Roundtrip Photo');
    expect(typeof entry.downloadUrl).toBe('string');
    const fetched = await fetch(entry.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `gld-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('committee deletes a photo, and it no longer appears in the list', async () => {
    const id = await uploadPhoto('Deletable', pngBytes());
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.find((p: { id: string }) => p.id === id)).toBeUndefined();
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await uploadPhoto('Protected', pngBytes());
    const email = `gld-p2-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a photoId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'GldOtherOrg', slug: `gld-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .attach('file', pngBytes(), { filename: 'o.png', contentType: 'image/png' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/gallery/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json gallery-list-delete
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Add `list` and `remove` to `GalleryService`**

In `backend/src/gallery/gallery.service.ts`, add the import and both methods to the class, after `upload`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
```

(replaces the existing `import { BadRequestException, Injectable } from '@nestjs/common';`)

```ts
  async list(organizationId: string) {
    const photos = await this.prisma.galleryPhoto.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(photos.map(async (photo) => ({
      id: photo.id,
      caption: photo.caption,
      downloadUrl: await this.storage.getSignedDownloadUrl(photo.storageKey, SIGNED_URL_TTL_SECONDS),
      createdAt: photo.createdAt,
    })));
  }

  async remove(organizationId: string, photoId: string, actorUserId: string): Promise<{ removed: true }> {
    const photo = await this.prisma.galleryPhoto.findFirst({ where: { id: photoId, organizationId } });
    if (!photo) throw new NotFoundException('Photo not found in this organization');

    await this.prisma.$transaction(async (tx) => {
      await tx.galleryPhoto.delete({ where: { id: photoId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'gallery.delete',
        targetType: 'GalleryPhoto', targetId: photoId,
        metadata: { photoId, caption: photo.caption },
      }, tx);
    });

    await this.storage.deleteObject(photo.storageKey);
    return { removed: true as const };
  }
```

- [ ] **Step 4: Add the two routes in `GalleryController`**

In `backend/src/gallery/gallery.controller.ts`, update the import to add `Delete`, `Get`, `Param`:

```ts
import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
```

Add these two methods to the class, after `upload`:

```ts
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
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json gallery-list-delete
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `255 passed` (250 from Task 1 + 5 new in `gallery-list-delete.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/gallery/gallery.service.ts backend/src/gallery/gallery.controller.ts backend/test/gallery-list-delete.e2e-spec.ts
git commit -m "feat: gallery list and delete endpoints"
```

---

### Task 3: AchievementsModule scaffold + create endpoint

**Files:**
- Create: `backend/src/achievements/dto/create-achievement.dto.ts`
- Create: `backend/src/achievements/achievements.service.ts`
- Create: `backend/src/achievements/achievements.controller.ts`
- Create: `backend/src/achievements/achievements.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/achievements-create.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`CurrentUser`/`MANAGE_EVENTS`. `Achievement` Prisma model from Task 1.
- Produces: `AchievementsService.create(organizationId: string, dto: CreateAchievementDto, actorUserId: string): Promise<Achievement>`. Route `POST /organizations/:orgId/achievements`. Tasks 4 and 5 add more methods to `AchievementsService`/`AchievementsController` in these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/achievements-create.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement create (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `ach-${Date.now()}@test.io`;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchOrg', slug: `ach-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member creates an achievement', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Best Club Award', description: 'Awarded for outstanding community engagement', year: 2025 })
      .expect(201);
    expect(res.body.title).toBe('Best Club Award');
    expect(res.body.year).toBe(2025);
    expect(res.body.organizationId).toBe(orgId);
  });

  it('a plain participant cannot create an achievement (403)', async () => {
    const email = `achp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Sneaky', description: 'x', year: 2025 })
      .expect(403);
  });

  it('400 when title is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ description: 'x', year: 2025 })
      .expect(400);
  });

  it('400 when description is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'x', year: 2025 })
      .expect(400);
  });

  it('400 when year is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'x', description: 'x' })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-create
```

Expected: FAIL — `Cannot POST /organizations/:orgId/achievements` (404), no `AchievementsModule` exists yet.

- [ ] **Step 3: Create the create DTO**

Create `backend/src/achievements/dto/create-achievement.dto.ts`:

```ts
import { IsInt, IsString, MinLength } from 'class-validator';

export class CreateAchievementDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) description!: string;
  @IsInt() year!: number;
}
```

- [ ] **Step 4: Create `AchievementsService`**

Create `backend/src/achievements/achievements.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';

@Injectable()
export class AchievementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateAchievementDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const achievement = await tx.achievement.create({
        data: {
          organizationId, title: dto.title, description: dto.description, year: dto.year,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.create',
        targetType: 'Achievement', targetId: achievement.id,
        metadata: { achievementId: achievement.id, title: achievement.title, year: achievement.year },
      }, tx);
      return achievement;
    });
  }
}
```

- [ ] **Step 5: Create `AchievementsController`**

Create `backend/src/achievements/achievements.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/achievements')
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateAchievementDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.achievements.create(orgId, dto, user.userId);
  }
}
```

- [ ] **Step 6: Create `AchievementsModule`**

Create `backend/src/achievements/achievements.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

@Module({
  controllers: [AchievementsController],
  providers: [AchievementsService],
  exports: [AchievementsService],
})
export class AchievementsModule {}
```

- [ ] **Step 7: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { AchievementsModule } from './achievements/achievements.module';
```

Add `AchievementsModule` to the `imports` array, after `GalleryModule`:

```ts
    GalleryModule,
    AchievementsModule,
```

- [ ] **Step 8: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-create
```

Expected: all tests PASS.

- [ ] **Step 9: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `260 passed` (255 from Task 2 + 5 new in `achievements-create.e2e-spec.ts`).

- [ ] **Step 10: Commit**

```bash
git add backend/src/achievements backend/src/app.module.ts backend/test/achievements-create.e2e-spec.ts
git commit -m "feat: achievements schema scaffold + create endpoint"
```

---

### Task 4: Achievements list + get-one endpoints

**Files:**
- Modify: `backend/src/achievements/achievements.service.ts`
- Modify: `backend/src/achievements/achievements.controller.ts`
- Test: `backend/test/achievements-list-get.e2e-spec.ts`

**Interfaces:**
- Consumes: `AchievementsService`/`AchievementsController` from Task 3 (same files, extended in place).
- Produces: `AchievementsService.list(organizationId: string): Promise<Achievement[]>` (sorted `year desc`). `AchievementsService.findOne(organizationId: string, achievementId: string): Promise<Achievement>` (throws `NotFoundException` if not found). Routes `GET /organizations/:orgId/achievements` and `GET /organizations/:orgId/achievements/:achievementId`. Task 6's `PublicModule` calls `AchievementsService.list` directly. Task 5 adds update/delete to these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/achievements-list-get.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAchievement(title: string, year: number) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, description: 'desc', year })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchLgOrg', slug: `achlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists achievements sorted by year descending', async () => {
    await createAchievement('Older Award', 2020);
    await createAchievement('Newer Award', 2025);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const titles = res.body.map((a: { title: string }) => a.title);
    expect(titles.indexOf('Newer Award')).toBeLessThan(titles.indexOf('Older Award'));
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `achlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('get-one returns the full entry', async () => {
    const id = await createAchievement('Full Entry Award', 2023);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.title).toBe('Full Entry Award');
    expect(res.body.year).toBe(2023);
  });

  it('404 getting an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchLgOtherOrg', slug: `achlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-list-get
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Add `list` and `findOne` to `AchievementsService`**

In `backend/src/achievements/achievements.service.ts`, add the import and both methods to the class, after `create`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
```

(replaces the existing `import { Injectable } from '@nestjs/common';`)

```ts
  list(organizationId: string) {
    return this.prisma.achievement.findMany({
      where: { organizationId },
      orderBy: { year: 'desc' },
    });
  }

  async findOne(organizationId: string, achievementId: string) {
    const achievement = await this.prisma.achievement.findFirst({ where: { id: achievementId, organizationId } });
    if (!achievement) throw new NotFoundException('Achievement not found in this organization');
    return achievement;
  }
```

- [ ] **Step 4: Add the two routes in `AchievementsController`**

In `backend/src/achievements/achievements.controller.ts`, update the import to add `Get`, `Param`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
```

Add these two methods to the class, after `create`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string) {
    return this.achievements.list(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':achievementId')
  findOne(@OrgId() orgId: string, @Param('achievementId') achievementId: string) {
    return this.achievements.findOne(orgId, achievementId);
  }
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-list-get
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `264 passed` (260 from Task 3 + 4 new in `achievements-list-get.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/achievements/achievements.service.ts backend/src/achievements/achievements.controller.ts backend/test/achievements-list-get.e2e-spec.ts
git commit -m "feat: achievements list and get-one endpoints"
```

---

### Task 5: Achievements update + delete endpoints

**Files:**
- Create: `backend/src/achievements/dto/update-achievement.dto.ts`
- Modify: `backend/src/achievements/achievements.service.ts`
- Modify: `backend/src/achievements/achievements.controller.ts`
- Test: `backend/test/achievements-update.e2e-spec.ts`
- Test: `backend/test/achievements-delete.e2e-spec.ts`

**Interfaces:**
- Consumes: `AchievementsService`/`AchievementsController` from Tasks 3–4 (same files, extended in place).
- Produces: `AchievementsService.update(organizationId: string, achievementId: string, dto: UpdateAchievementDto, actorUserId: string): Promise<Achievement>`. `AchievementsService.remove(organizationId: string, achievementId: string, actorUserId: string): Promise<{ removed: true }>`. Routes `PATCH /organizations/:orgId/achievements/:achievementId` and `DELETE /organizations/:orgId/achievements/:achievementId`. No further tasks extend these files.

- [ ] **Step 1: Create the update DTO**

Create `backend/src/achievements/dto/update-achievement.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpdateAchievementDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(1) title?: string;
  @ValidateIf((o) => o.description !== undefined) @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsInt() year?: number;
}
```

- [ ] **Step 2: Write the failing e2e tests**

Create `backend/test/achievements-update.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement update (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAchievement() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Original Title', description: 'Original Description', year: 2022 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchUpOrg', slug: `achup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createAchievement();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ year: 2023 })
      .expect(200);
    expect(res.body.year).toBe(2023);
    expect(res.body.title).toBe('Original Title');
    expect(res.body.description).toBe('Original Description');
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createAchievement();
    const email = `achup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ year: 1999 })
      .expect(403);
  });

  it('404 editing an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchUpOtherOrg', slug: `achup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ year: 2000 })
      .expect(404);
  });
});
```

Create `backend/test/achievements-delete.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Achievement delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAchievement() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Deletable', description: 'x', year: 2022 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`achdel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchDelOrg', slug: `achdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes an achievement, and it 404s on subsequent get', async () => {
    const id = await createAchievement();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createAchievement();
    const email = `achdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting an achievementId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AchDelOtherOrg', slug: `achdel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Award', description: 'x', year: 2021 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/achievements/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 3: Run both e2e files to verify they fail**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-update achievements-delete
```

Expected: FAIL — `PATCH`/`DELETE` on `/organizations/:orgId/achievements/:achievementId` both 404, neither route exists yet.

- [ ] **Step 4: Add `update` and `remove` to `AchievementsService`**

In `backend/src/achievements/achievements.service.ts`, add the import and both methods to the class, after `findOne`:

```ts
import { Prisma } from '@prisma/client';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
```

```ts
  async update(organizationId: string, achievementId: string, dto: UpdateAchievementDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.achievement.findFirst({ where: { id: achievementId, organizationId } });
      if (!current) throw new NotFoundException('Achievement not found in this organization');

      const data: Prisma.AchievementUpdateInput = {
        title: dto.title,
        description: dto.description,
        year: dto.year,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.achievement.update({ where: { id: achievementId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.update',
        targetType: 'Achievement', targetId: achievementId, metadata: { achievementId, fields },
      }, tx);
      return updated;
    });
  }

  async remove(organizationId: string, achievementId: string, actorUserId: string): Promise<{ removed: true }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.achievement.findFirst({ where: { id: achievementId, organizationId } });
      if (!current) throw new NotFoundException('Achievement not found in this organization');
      await tx.achievement.delete({ where: { id: achievementId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'achievement.delete',
        targetType: 'Achievement', targetId: achievementId,
        metadata: { achievementId, title: current.title },
      }, tx);
      return { removed: true as const };
    });
  }
```

- [ ] **Step 5: Add the two routes in `AchievementsController`**

In `backend/src/achievements/achievements.controller.ts`, update the imports:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
```

Add these two methods to the class, after `findOne`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':achievementId')
  update(
    @OrgId() orgId: string,
    @Param('achievementId') achievementId: string,
    @Body() dto: UpdateAchievementDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.achievements.update(orgId, achievementId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':achievementId')
  remove(@OrgId() orgId: string, @Param('achievementId') achievementId: string, @CurrentUser() user: { userId: string }) {
    return this.achievements.remove(orgId, achievementId, user.userId);
  }
```

- [ ] **Step 6: Run both e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json achievements-update achievements-delete
```

Expected: all tests PASS.

- [ ] **Step 7: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `270 passed` (264 from Task 4 + 6 new: 3 in `achievements-update.e2e-spec.ts` + 3 in `achievements-delete.e2e-spec.ts`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/achievements/dto/update-achievement.dto.ts backend/src/achievements/achievements.service.ts backend/src/achievements/achievements.controller.ts backend/test/achievements-update.e2e-spec.ts backend/test/achievements-delete.e2e-spec.ts
git commit -m "feat: achievements update and delete endpoints"
```

---

### Task 6: EventsService.listPublicUpcoming + PublicModule; docs sync

**Files:**
- Modify: `backend/src/events/events.service.ts`
- Create: `backend/src/public/public.service.ts`
- Create: `backend/src/public/public.controller.ts`
- Create: `backend/src/public/public.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/public-profile.e2e-spec.ts`
- Test: `backend/test/public-gallery-achievements.e2e-spec.ts`
- Modify: `docs/database.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: `EventsService` (extended with a new method here), `GalleryService.list` (Task 2), `AchievementsService.list` (Task 4), `OrganizationsModule`'s exported `OrganizationsService` is NOT used directly — `PublicService` queries `PrismaService` directly for the profile fields, since `OrganizationsService.findOne` returns the full row (including `storageQuotaMb`/`settings`) and this task needs a field-scoped `select`, not a reusable service method. `StorageService.getSignedDownloadUrl`.
- Produces: `EventsService.listPublicUpcoming(organizationId: string): Promise<Event[]>`. `PublicService.getProfile(organizationId: string)`, `PublicService.getGallery(organizationId: string)`, `PublicService.getAchievements(organizationId: string)` — all three throw `NotFoundException` if the org doesn't exist. Routes `GET /public/organizations/:orgId/profile`, `GET /public/organizations/:orgId/gallery`, `GET /public/organizations/:orgId/achievements` — **no guards on any of them.** No further tasks extend these files.

- [ ] **Step 1: Add `listPublicUpcoming` to `EventsService`**

In `backend/src/events/events.service.ts`, add this method to the class, after `list`:

```ts
  listPublicUpcoming(organizationId: string) {
    return this.prisma.event.findMany({
      where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
      select: { id: true, title: true, startAt: true, endAt: true, venue: true },
    });
  }
```

- [ ] **Step 2: Write the failing e2e test for the public profile route**

Create `backend/test/public-profile.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public profile (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`pub-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubOrg', slug: `pub-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('returns the profile with no Authorization header at all', async () => {
    const draftEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Draft Event', startAt: future(5), endAt: future(6) }).expect(201);

    const publishedEvent = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Published Event', startAt: future(10), endAt: future(11) }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${publishedEvent.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}/profile`)
      .expect(200);
    expect(res.body.name).toBe('PubOrg');
    expect(res.body.primaryColor).toBe('#2563eb');
    const titles = res.body.upcomingEvents.map((e: { title: string }) => e.title);
    expect(titles).toContain('Published Event');
    expect(titles).not.toContain('Draft Event');
    expect(res.body.storageQuotaMb).toBeUndefined();
    expect(res.body.settings).toBeUndefined();
  });

  it('404 for a nonexistent orgId', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/00000000-0000-0000-0000-000000000000/profile')
      .expect(404);
  });
});
```

- [ ] **Step 3: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json public-profile
```

Expected: FAIL — `Cannot GET /public/organizations/:orgId/profile` (404), no `PublicModule` exists yet.

- [ ] **Step 4: Write the failing e2e test for the public gallery/achievements routes**

Create `backend/test/public-gallery-achievements.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Public gallery + achievements (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pngBytes = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`pubga-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'PubGaOrg', slug: `pubga-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('public gallery route returns photos with no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/gallery`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('caption', 'Public Photo')
      .attach('file', pngBytes(), { filename: 'p.png', contentType: 'image/png' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}/gallery`)
      .expect(200);
    expect(res.body.find((p: { caption: string }) => p.caption === 'Public Photo')).toBeDefined();
  });

  it('404 for a nonexistent orgId on public gallery', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/00000000-0000-0000-0000-000000000000/gallery')
      .expect(404);
  });

  it('public achievements route returns achievements sorted by year, no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/achievements`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Public Award', description: 'x', year: 2025 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/public/organizations/${orgId}/achievements`)
      .expect(200);
    expect(res.body.find((a: { title: string }) => a.title === 'Public Award')).toBeDefined();
  });

  it('404 for a nonexistent orgId on public achievements', async () => {
    await request(app.getHttpServer())
      .get('/public/organizations/00000000-0000-0000-0000-000000000000/achievements')
      .expect(404);
  });
});
```

- [ ] **Step 5: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json public-gallery-achievements
```

Expected: FAIL — all three routes not found.

- [ ] **Step 6: Create `PublicService`**

Create `backend/src/public/public.service.ts`:

```ts
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

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, description: true, logoKey: true, primaryColor: true, socialLinks: true, advisors: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  async getProfile(organizationId: string) {
    const organization = await this.requireOrganization(organizationId);
    const logoUrl = organization.logoKey
      ? await this.storage.getSignedDownloadUrl(organization.logoKey, SIGNED_URL_TTL_SECONDS)
      : null;
    const upcomingEvents = await this.events.listPublicUpcoming(organizationId);
    return {
      name: organization.name,
      description: organization.description,
      logoUrl,
      primaryColor: organization.primaryColor,
      socialLinks: organization.socialLinks,
      advisors: organization.advisors,
      upcomingEvents,
    };
  }

  async getGallery(organizationId: string) {
    await this.requireOrganization(organizationId);
    return this.gallery.list(organizationId);
  }

  async getAchievements(organizationId: string) {
    await this.requireOrganization(organizationId);
    return this.achievements.list(organizationId);
  }
}
```

- [ ] **Step 7: Create `PublicController`**

Create `backend/src/public/public.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

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
```

Note: `@Param('orgId')` is used directly here, unlike every other controller
in this codebase which reads `@OrgId()` (populated by `TenantGuard`). There
is no `TenantGuard` on this controller — `orgId` comes straight from the
route param, and `PublicService.requireOrganization` is what validates it.

- [ ] **Step 8: Create `PublicModule`**

Create `backend/src/public/public.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { StorageModule } from '../storage/storage.module';
import { EventsModule } from '../events/events.module';
import { GalleryModule } from '../gallery/gallery.module';
import { AchievementsModule } from '../achievements/achievements.module';

@Module({
  imports: [StorageModule, EventsModule, GalleryModule, AchievementsModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
```

- [ ] **Step 9: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { PublicModule } from './public/public.module';
```

Add `PublicModule` to the `imports` array, after `AchievementsModule`:

```ts
    AchievementsModule,
    PublicModule,
```

- [ ] **Step 10: Run both e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json public-profile public-gallery-achievements
```

Expected: all tests PASS.

- [ ] **Step 11: Update `docs/database.md`**

Read the current file first (`docs/database.md`), find the `### Asset (shipped)` entry (added in the Asset Management phase), and add two new entity blocks directly after it (before `### ConsentRecord (PDPA) (shipped)`):

```markdown
### GalleryPhoto (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| storageKey | string | `gallery/{organizationId}/{randomUUID()}.{ext}` |
| caption | string? | |
| fileSizeBytes | int | counted toward the org's shared storage quota alongside `Certificate.fileSizeBytes` and `OrgFile.fileSizeBytes` |
| uploadedByUserId | uuid | plain column, no FK relation |
| createdAt | timestamp | |
| — | `@@index([organizationId])` | |

No edit endpoint — caption changes are delete + re-upload. List embeds a
signed `downloadUrl` per photo (unlike `OrgFile`'s list, which is
metadata-only) since a gallery exists to render a grid of images, not to
be browsed then fetched one at a time.

### Achievement (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| title | string | |
| description | string | |
| year | int | no range bound |
| createdByUserId | uuid | plain column, no FK relation |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| — | `@@index([organizationId])` | |

Both `GalleryPhoto` and `Achievement` are in `TENANT_SCOPED_MODELS`.
```

- [ ] **Step 12: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — asset management (shipped)` section (the most recent one), and add a new `### As built — public club page (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`). Document:

- Gallery: `POST`/`GET`/`DELETE /organizations/:orgId/gallery*`. Upload/delete `MANAGE_EVENTS`; list any ACTIVE member, list response embeds a signed `downloadUrl` per photo (10MB cap, PNG/JPEG only, quota summed across `Certificate` + `OrgFile` + `GalleryPhoto`).
- Achievements: full CRUD under `/organizations/:orgId/achievements*`, same RBAC/audit shape as Asset Management.
- **Public routes — the first unauthenticated surface in this codebase:** `GET /public/organizations/:orgId/profile`, `/gallery`, `/achievements`. No `JwtAuthGuard`, no `TenantGuard`, no `RolesGuard` — anyone can call these with no credentials at all. Each explicitly checks the org exists (`404` if not) since there's no guard to do that implicitly. The profile response is a fixed field allowlist — `name`, `description`, `logoUrl` (signed, if `logoKey` is set), `primaryColor`, `socialLinks`, `advisors`, `upcomingEvents` (published + future only) — and never includes `storageQuotaMb`, `settings`, or any other `Organization` column.
- Public reads are unaudited (no authenticated actor to attribute them to).
- Anonymous event registration remains out of scope — the public profile only surfaces event *links* (id/title/dates); registering still requires signup/login.

- [ ] **Step 13: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `276 passed` (270 from Task 5 + 6 new: 2 in `public-profile.e2e-spec.ts` + 4 in `public-gallery-achievements.e2e-spec.ts`; docs changes add no tests).

- [ ] **Step 14: Commit**

```bash
git add backend/src/events/events.service.ts backend/src/public backend/src/app.module.ts backend/test/public-profile.e2e-spec.ts backend/test/public-gallery-achievements.e2e-spec.ts docs/database.md docs/security.md
git commit -m "feat: public club page routes (profile, gallery, achievements); docs sync"
```

---

## Post-plan: roadmap note

Public Club Page (Phase 2 item 5) is now shippable end-to-end: committee
manages a photo gallery and achievements list, and anyone — no account, no
credentials — can view an org's public profile, upcoming published
events, gallery, and achievements. This is the first unauthenticated
surface in the codebase; the pattern (explicit org-existence check
replacing `TenantGuard`, fixed field allowlists replacing implicit
RBAC-scoped queries) is the template for any future public-facing route.
Six Phase 2 items remain, no fixed dependency order: Email Notifications,
Certificate Generator, Branding & Themes, Event Feedback+NPS, Committee
Handover Pack, Consent-versioned re-prompt.
