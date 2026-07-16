# File Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an org-level document repository — upload/list/download/delete of files (SOPs, reports, etc.) tagged by category, sharing the org's existing storage quota with Certificates.

**Architecture:** A new `FilesModule` (`backend/src/files/`) mirrors `CertificatesModule`'s shape — one controller, one service, one upload DTO — using the existing `StorageService` and `AuditService`. New `OrgFile` Prisma model, added to `TENANT_SCOPED_MODELS` (unlike `CertificateDownload`, since list/filter queries against it are genuine `findMany` calls the tenant-scope middleware is meant to guard).

**Tech Stack:** NestJS, Prisma (PostgreSQL), `@nestjs/platform-express` `FileInterceptor` (already a dependency, used by Certificates), `crypto.randomUUID()` for storage keys (existing codebase convention — no `uuid` package).

## Global Constraints

- Guard chain: upload/delete → `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`. List/download → `JwtAuthGuard, TenantGuard` only (any ACTIVE member of the org, any role).
- Allowed MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.openxmlformats-officedocument.presentationml.presentation`, `image/png`, `image/jpeg`. Anything else → `400`.
- Max file size: 20MB (`MAX_FILE_BYTES = 20 * 1024 * 1024`), enforced in the service; `FileInterceptor` limit set to 25MB (matches Certificates' pattern of a slightly higher interceptor ceiling than the service-level check).
- Storage quota: shared with `Organization.storageQuotaMb` — every quota check sums `Certificate.fileSizeBytes` **and** `OrgFile.fileSizeBytes` for the org. Exceeding it → `400 BadRequestException('Organization storage quota exceeded')` (same message Certificates already uses).
- `storageKey` format: `org-files/{organizationId}/{randomUUID()}.{ext}` — unique per upload, never reused, never overwritten.
- Two new audit actions: `file.upload`, `file.delete` — `targetType: 'OrgFile'`, metadata `{ fileId, title, category }`.
- No versioning, no folders, no download tracking for org files, no per-category access control — all explicitly out of scope per the spec.
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.

---

### Task 1: Schema + FilesModule scaffold + upload endpoint

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/**` (generated)
- Modify: `backend/src/prisma/tenant-scope.middleware.ts`
- Create: `backend/src/files/dto/upload-file.dto.ts`
- Create: `backend/src/files/files.service.ts`
- Create: `backend/src/files/files.controller.ts`
- Create: `backend/src/files/files.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/files-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `StorageService` (`backend/src/storage/storage.service.ts` — `putObject(key, buffer, contentType)`), `AuditService` (`backend/src/audit/audit.service.ts` — `record(entry, tx?)`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`CurrentUser`/`MANAGE_EVENTS` (all pre-existing, same imports as `CertificatesController`).
- Produces: `OrgFile` Prisma model (fields: `id, organizationId, title, category, storageKey, originalFilename, mimeType, fileSizeBytes, uploadedByUserId, createdAt`), reachable via `prisma.orgFile.*`. `FilesService.upload(organizationId: string, title: string, category: FileCategory, file: { mimetype: string; size: number; buffer: Buffer; originalname: string } | undefined, actorUserId: string): Promise<OrgFile>`. Route `POST /organizations/:orgId/files`. Tasks 2 and 3 add more methods to `FilesService`/`FilesController` in these same two files.

- [ ] **Step 1: Add `OrgFile` model and `FileCategory` enum to `schema.prisma`**

Open `backend/prisma/schema.prisma`. Add this enum near the other enums (directly after `enum AttendanceStatus { ... }`):

```prisma
enum FileCategory {
  SOP
  REPORT
  FINANCIAL
  MEETING
  OTHER
}
```

Add the model directly after the `Certificate` model (before `CertificateDownload`):

```prisma
model OrgFile {
  id               String       @id @default(uuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id])
  title            String
  category         FileCategory
  storageKey       String
  originalFilename String
  mimeType         String
  fileSizeBytes    Int
  uploadedByUserId String
  createdAt        DateTime     @default(now())

  @@index([organizationId])
  @@index([organizationId, category])
}
```

Add one field to the existing `Organization` model (in its list of relation fields, e.g. right after `events Event[]`):

```prisma
  files          OrgFile[]
```

- [ ] **Step 2: Add `OrgFile` to `TENANT_SCOPED_MODELS`**

In `backend/src/prisma/tenant-scope.middleware.ts`, update line 4:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile'];
```

- [ ] **Step 3: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add_org_file_model
```

Expected: migration applies cleanly, Prisma Client regenerates with an `orgFile` delegate. Confirm with:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 4: Write the failing e2e tests for upload**

Create `backend/test/files-upload.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('File upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  const pres = `file-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FileOrg', slug: `file-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee uploads a PDF as an SOP', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Onboarding SOP')
      .field('category', 'SOP')
      .attach('file', pdfBytes(), { filename: 'onboarding.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.title).toBe('Onboarding SOP');
    expect(res.body.category).toBe('SOP');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.originalFilename).toBe('onboarding.pdf');
  });

  it('a plain participant cannot upload (403)', async () => {
    const email = `fp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .field('title', 'Sneaky Upload')
      .field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(403);
  });

  it('400 when no file is attached', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'No File')
      .field('category', 'OTHER')
      .expect(400);
  });

  it('400 rejects an unsupported MIME type', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Bad Type')
      .field('category', 'OTHER')
      .attach('file', Buffer.from('not allowed'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
  });

  it('400 rejects a file over 20MB', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024, 1);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Too Big')
      .field('category', 'OTHER')
      .attach('file', big, { filename: 'big.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('400 when the upload would exceed the org storage quota (summed across Certificate + OrgFile)', async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 0 } });
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Over Quota')
      .field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'x.pdf', contentType: 'application/pdf' })
      .expect(400);
    await prisma.organization.update({ where: { id: orgId }, data: { storageQuotaMb: 1024 } });
  });
});
```

- [ ] **Step 5: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-upload
```

Expected: FAIL — `Cannot POST /organizations/:orgId/files` (404), no `FilesModule` exists yet.

- [ ] **Step 6: Create the upload DTO**

Create `backend/src/files/dto/upload-file.dto.ts`:

```ts
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { FileCategory } from '@prisma/client';

export class UploadFileDto {
  @IsNotEmpty() @IsString() title!: string;
  @IsEnum(FileCategory) category!: FileCategory;
}
```

- [ ] **Step 7: Create `FilesService`**

Create `backend/src/files/files.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { FileCategory } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

type UploadedFile = { mimetype: string; size: number; buffer: Buffer; originalname: string };

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    organizationId: string,
    title: string,
    category: FileCategory,
    file: UploadedFile | undefined,
    actorUserId: string,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new BadRequestException('Unsupported file type');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('File exceeds the 20MB limit');

    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const [certUsage, fileUsage] = await Promise.all([
      this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
      this.prisma.orgFile.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
    ]);
    const usedBytes = (certUsage._sum.fileSizeBytes ?? 0) + (fileUsage._sum.fileSizeBytes ?? 0);
    const quotaBytes = organization!.storageQuotaMb * 1024 * 1024;
    if (usedBytes + file.size > quotaBytes) {
      throw new BadRequestException('Organization storage quota exceeded');
    }

    const ext = EXT_BY_MIME[file.mimetype];
    const storageKey = `org-files/${organizationId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(storageKey, file.buffer, file.mimetype);

    return this.prisma.$transaction(async (tx) => {
      const orgFile = await tx.orgFile.create({
        data: {
          organizationId, title, category, storageKey,
          originalFilename: file.originalname, mimeType: file.mimetype,
          fileSizeBytes: file.size, uploadedByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'file.upload',
        targetType: 'OrgFile', targetId: orgFile.id,
        metadata: { fileId: orgFile.id, title, category },
      }, tx);
      return orgFile;
    });
  }
}
```

- [ ] **Step 8: Create `FilesController`**

Create `backend/src/files/files.controller.ts`:

```ts
import { Body, Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
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
}
```

Note: `@Param('orgId')` is not needed here — `@OrgId()` (from `../tenancy/org-id.decorator`) already reads `req.organizationId`, set by `TenantGuard`.

- [ ] **Step 9: Create `FilesModule`**

Create `backend/src/files/files.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

- [ ] **Step 10: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { FilesModule } from './files/files.module';
```

Add `FilesModule` to the `imports` array, after `AnalyticsModule`:

```ts
    AnalyticsModule,
    FilesModule,
```

- [ ] **Step 11: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-upload
```

Expected: all tests PASS.

- [ ] **Step 12: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed` (unaffected — no unit tests added, matching `CertificatesService`'s precedent of e2e-only coverage); e2e `202 passed` committed (196 baseline from the Analytics phase + 6 new in `files-upload.e2e-spec.ts`; the untracked `zzz-concurrency-probe.e2e-spec.ts` continues to pass alongside).

- [ ] **Step 13: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/prisma/tenant-scope.middleware.ts backend/src/files backend/src/app.module.ts backend/test/files-upload.e2e-spec.ts
git commit -m "feat: file repository schema + upload endpoint"
```

---

### Task 2: List + download endpoints

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Modify: `backend/src/files/files.controller.ts`
- Test: `backend/test/files-list-download.e2e-spec.ts`

**Interfaces:**
- Consumes: `FilesService`/`FilesController` from Task 1 (same files, extended in place); `OrgFile` model.
- Produces: `FilesService.list(organizationId: string, category?: string): Promise<Array<{ id: string; title: string; category: FileCategory; originalFilename: string; mimeType: string; fileSizeBytes: number; uploadedByUserId: string; createdAt: Date }>>`; `FilesService.getDownloadUrl(organizationId: string, fileId: string): Promise<{ downloadUrl: string }>`. Routes `GET /organizations/:orgId/files` and `GET /organizations/:orgId/files/:fileId/download`. Task 3 adds delete to these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/files-list-download.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('File list + download (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `fld-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadFile(title: string, category: string, bytes: Buffer) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', title)
      .field('category', category)
      .attach('file', bytes, { filename: 'f.pdf', contentType: 'application/pdf' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOrg', slug: `fld-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists files without storageKey or a signed URL', async () => {
    await uploadFile('SOP One', 'SOP', pdfBytes());
    await uploadFile('Report One', 'REPORT', pdfBytes());

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].storageKey).toBeUndefined();
    expect(res.body[0].downloadUrl).toBeUndefined();
  });

  it('filters by category', async () => {
    const orgId2 = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOrg2', slug: `fld2-${Date.now()}` })).body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId2}/files`)
      .set('Authorization', `Bearer ${presToken}`).field('title', 'A').field('category', 'SOP')
      .attach('file', pdfBytes(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId2}/files`)
      .set('Authorization', `Bearer ${presToken}`).field('title', 'B').field('category', 'REPORT')
      .attach('file', pdfBytes(), { filename: 'b.pdf', contentType: 'application/pdf' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/files?category=SOP`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].category).toBe('SOP');
  });

  it('an unrecognized category value returns the unfiltered list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files?category=NOT_REAL`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `fld-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('download returns a signed URL that round-trips the original bytes', async () => {
    const bytes = Buffer.from('%PDF-1.4\n%download roundtrip bytes\n');
    const fileId = await uploadFile('Roundtrip', 'OTHER', bytes);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${fileId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(typeof res.body.downloadUrl).toBe('string');
    const fetched = await fetch(res.body.downloadUrl);
    const fetchedBytes = Buffer.from(await fetched.arrayBuffer());
    expect(fetchedBytes.equals(bytes)).toBe(true);
  });

  it('404 downloading a fileId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FldOtherOrg', slug: `fld-other-${Date.now()}` })).body.id;
    const otherFileId = await (async () => {
      const res = await request(app.getHttpServer())
        .post(`/organizations/${otherOrgId}/files`)
        .set('Authorization', `Bearer ${presToken}`)
        .field('title', 'Other Org File').field('category', 'OTHER')
        .attach('file', pdfBytes(), { filename: 'o.pdf', contentType: 'application/pdf' }).expect(201);
      return res.body.id;
    })();

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${otherFileId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-list-download
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Add `list` and `getDownloadUrl` to `FilesService`**

In `backend/src/files/files.service.ts`, add the import and both methods to the class, after `upload`:

```ts
import { StorageService } from '../storage/storage.service';
```

(already imported — no change needed to the import line itself.)

```ts
  list(organizationId: string, category?: string) {
    const validCategory = category && Object.values(FileCategory).includes(category as FileCategory)
      ? (category as FileCategory)
      : undefined;
    return this.prisma.orgFile.findMany({
      where: { organizationId, ...(validCategory && { category: validCategory }) },
      select: {
        id: true, title: true, category: true, originalFilename: true,
        mimeType: true, fileSizeBytes: true, uploadedByUserId: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(organizationId: string, fileId: string) {
    const orgFile = await this.prisma.orgFile.findFirst({ where: { id: fileId, organizationId } });
    if (!orgFile) throw new NotFoundException('File not found in this organization');
    const downloadUrl = await this.storage.getSignedDownloadUrl(orgFile.storageKey, SIGNED_URL_TTL_SECONDS);
    return { downloadUrl };
  }
```

Add `NotFoundException` to the existing `@nestjs/common` import at the top of the file:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
```

- [ ] **Step 4: Add the two routes in `FilesController`**

In `backend/src/files/files.controller.ts`, update the imports and add both methods:

```ts
import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
```

(replaces the existing `import { Body, Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';` — merge so both `Body`/`UploadedFile`/`UseInterceptors` from Task 1 and `Get`/`Query` from this task are present:)

```ts
import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
```

Add these two methods to the class, after `upload`:

```ts
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
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-list-download
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `208 passed` committed (202 from Task 1 + 6 new in `files-list-download.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/files/files.service.ts backend/src/files/files.controller.ts backend/test/files-list-download.e2e-spec.ts
git commit -m "feat: file repository list and download endpoints"
```

---

### Task 3: Delete endpoint + docs sync

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Modify: `backend/src/files/files.controller.ts`
- Test: `backend/test/files-delete.e2e-spec.ts`
- Modify: `docs/database.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: `FilesService`/`FilesController` from Tasks 1–2 (same files, extended in place).
- Produces: `FilesService.remove(organizationId: string, fileId: string, actorUserId: string): Promise<{ removed: true }>`. Route `DELETE /organizations/:orgId/files/:fileId`. No further tasks extend these files.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/files-delete.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('File delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `fdel-${Date.now()}@test.io`;
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock sop content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function uploadFile() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Deletable').field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'd.pdf', contentType: 'application/pdf' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FdelOrg', slug: `fdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes a file, and it 404s on subsequent download', async () => {
    const fileId = await uploadFile();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${fileId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/files/${fileId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const fileId = await uploadFile();
    const email = `fdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${fileId}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a fileId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'FdelOtherOrg', slug: `fdel-other-${Date.now()}` })).body.id;
    const otherFileRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Other Org File').field('category', 'OTHER')
      .attach('file', pdfBytes(), { filename: 'o.pdf', contentType: 'application/pdf' }).expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/files/${otherFileRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-delete
```

Expected: FAIL — `Cannot DELETE /organizations/:orgId/files/:fileId` (404), route doesn't exist yet.

- [ ] **Step 3: Add `remove` to `FilesService`**

In `backend/src/files/files.service.ts`, add this method to the class, after `getDownloadUrl`:

```ts
  async remove(organizationId: string, fileId: string, actorUserId: string) {
    const orgFile = await this.prisma.orgFile.findFirst({ where: { id: fileId, organizationId } });
    if (!orgFile) throw new NotFoundException('File not found in this organization');

    await this.prisma.$transaction(async (tx) => {
      await tx.orgFile.delete({ where: { id: fileId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'file.delete',
        targetType: 'OrgFile', targetId: fileId,
        metadata: { fileId, title: orgFile.title, category: orgFile.category },
      }, tx);
    });

    await this.storage.deleteObject(orgFile.storageKey);
    return { removed: true as const };
  }
```

- [ ] **Step 4: Add the route in `FilesController`**

In `backend/src/files/files.controller.ts`, update the import to add `Delete`:

```ts
import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
```

Add this method to the class, after `download`:

```ts
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
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json files-delete
```

Expected: all tests PASS.

- [ ] **Step 6: Update `docs/database.md`**

Read the current file first (`docs/database.md`), find the `### CertificateDownload (shipped)` entry (added in the Analytics phase), and add a new entity block directly after it (before `### ConsentRecord (PDPA) (shipped)`):

```markdown
### OrgFile (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| title | string | user-provided label, distinct from the original filename |
| category | enum (`SOP`, `REPORT`, `FINANCIAL`, `MEETING`, `OTHER`) | display/filter tag, not an access-control boundary |
| storageKey | string | `org-files/{organizationId}/{randomUUID()}.{ext}` — unique per upload, never reused or overwritten |
| originalFilename | string | as submitted by the uploader |
| mimeType | string | validated against a fixed allowlist at upload time |
| fileSizeBytes | int | counted toward the org's shared storage quota alongside `Certificate.fileSizeBytes` |
| uploadedByUserId | uuid | plain column, no FK relation (matches `Certificate.uploadedByUserId`'s convention) |
| createdAt | timestamp | |
| — | `@@index([organizationId])`, `@@index([organizationId, category])` | |

`OrgFile` **is** in `TENANT_SCOPED_MODELS` (unlike `CertificateDownload`) —
list/filter reads against it are genuine `findMany` calls the tenant-scope
middleware is meant to guard. No version history: re-uploading a "new
version" of a document creates a brand-new row; the old row must be
explicitly deleted if only one copy should remain visible.
```

- [ ] **Step 7: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — analytics (shipped)` section (the most recent one), and add a new `### As built — file repository (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`, matching where every prior "As built" section was inserted). Document:

- Four routes under `/organizations/:orgId/files*` (`POST` upload, `GET` list, `GET /:fileId/download`, `DELETE /:fileId`). Upload/delete gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` (same tier as Certificates/Events). List/download gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member of the org, any role, can view and download.
- Allowed MIME types verbatim: PDF, DOCX, XLSX, PPTX, PNG, JPEG. Max size 20MB. Any other type or oversized file → `400`.
- Storage quota is shared with Certificates: every upload sums `Certificate.fileSizeBytes` and `OrgFile.fileSizeBytes` against `Organization.storageQuotaMb` before writing.
- No download tracking for org files (unlike `CertificateDownload`) — out of scope this phase.
- Two new audit actions: `file.upload`, `file.delete` (`targetType: 'OrgFile'`) — reads (list, download) are unaudited, matching the Dashboard/Analytics precedent.
- No per-category access control — `category` is a display/filter tag only, not a permission boundary.

- [ ] **Step 8: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `211 passed` committed (208 from Task 2 + 3 new in `files-delete.e2e-spec.ts`; docs changes add no tests).

- [ ] **Step 9: Commit**

```bash
git add backend/src/files/files.service.ts backend/src/files/files.controller.ts backend/test/files-delete.e2e-spec.ts docs/database.md docs/security.md
git commit -m "feat: file repository delete endpoint; docs sync"
```

---

## Post-plan: roadmap note

File Repository (Phase 2 item 2) is now shippable end-to-end: upload,
list (with category filter), download, delete — all sharing the org's
existing storage quota with Certificates. Nine Phase 2 items remain, no
fixed dependency order: Meeting Minutes, Asset Management, Public Club
Page, Email Notifications, Certificate Generator, Branding & Themes, Event
Feedback+NPS, Committee Handover Pack, Consent-versioned re-prompt.
