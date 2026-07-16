# Asset Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static, quantity-per-type inventory of club-owned assets — create/list/get/edit/delete, with condition tracking.

**Architecture:** A new `AssetsModule` (`backend/src/assets/`) mirrors `MinutesModule`'s CRUD shape (controller/service/DTOs). New `Asset` Prisma model with an `AssetCondition` enum, added to `TENANT_SCOPED_MODELS`. Standalone, org-level, unpaginated list (bounded inventory, unlike Meeting Minutes' growing archive).

**Tech Stack:** NestJS, Prisma (PostgreSQL), `class-validator` (existing precedent, no new dependencies).

## Global Constraints

- Guard chain: create/edit/delete → `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`. List/get-one → `JwtAuthGuard, TenantGuard` only (any ACTIVE member of the org, any role).
- `name`: required, non-empty string. `quantity`: required int ≥ 1. `condition`: optional `AssetCondition` enum (`GOOD`/`DAMAGED`/`LOST`), defaults `GOOD` at creation if omitted. `location`, `notes`: optional strings.
- List returns a plain array, no pagination — inventory is bounded (dozens of asset types, not thousands), sorted `name asc`.
- Three new audit actions: `asset.create`, `asset.update`, `asset.delete` — `targetType: 'Asset'`, same shape as `event.create`/`event.update`/`event.delete`.
- No checkout/return tracking, no individual-unit tracking, no purchase/cost fields, no category grouping — all explicitly out of scope per the spec.
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.

---

### Task 1: Schema + AssetsModule scaffold + create endpoint

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/**` (generated)
- Modify: `backend/src/prisma/tenant-scope.middleware.ts`
- Create: `backend/src/assets/dto/create-asset.dto.ts`
- Create: `backend/src/assets/assets.service.ts`
- Create: `backend/src/assets/assets.controller.ts`
- Create: `backend/src/assets/assets.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/assets-create.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService` (`record(entry, tx?)`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`CurrentUser`/`MANAGE_EVENTS` (all pre-existing, same imports as `MinutesController`).
- Produces: `Asset` Prisma model (fields: `id, organizationId, name, quantity, condition, location, notes, createdByUserId, createdAt, updatedAt`), reachable via `prisma.asset.*`. `AssetsService.create(organizationId: string, dto: CreateAssetDto, actorUserId: string): Promise<Asset>`. Route `POST /organizations/:orgId/assets`. Tasks 2 and 3 add more methods to `AssetsService`/`AssetsController` in these same two files.

- [ ] **Step 1: Add the `AssetCondition` enum and `Asset` model to `schema.prisma`**

Open `backend/prisma/schema.prisma`. Add this enum near the other enums (directly after `enum FileCategory { ... }`):

```prisma
enum AssetCondition {
  GOOD
  DAMAGED
  LOST
}
```

Add the model directly after the `MeetingMinutes` model (before `CertificateDownload`):

```prisma
model Asset {
  id              String         @id @default(uuid())
  organizationId  String
  organization    Organization   @relation(fields: [organizationId], references: [id])
  name            String
  quantity        Int
  condition       AssetCondition @default(GOOD)
  location        String?
  notes           String?
  createdByUserId String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  @@index([organizationId])
}
```

Add one field to the existing `Organization` model (in its list of relation fields, e.g. right after `minutes MeetingMinutes[]`):

```prisma
  assets         Asset[]
```

- [ ] **Step 2: Add `Asset` to `TENANT_SCOPED_MODELS`**

In `backend/src/prisma/tenant-scope.middleware.ts`, update line 4:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes', 'Asset'];
```

- [ ] **Step 3: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add_asset_model
```

Expected: migration applies cleanly, Prisma Client regenerates with an `asset` delegate. Confirm with:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 4: Write the failing e2e tests for create**

Create `backend/test/assets-create.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset create (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `asset-${Date.now()}@test.io`;

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetOrg', slug: `asset-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member creates an asset with all fields', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Folding Chairs', quantity: 20, condition: 'GOOD', location: 'Storage Room B', notes: 'Bought 2025' })
      .expect(201);
    expect(res.body.name).toBe('Folding Chairs');
    expect(res.body.quantity).toBe(20);
    expect(res.body.condition).toBe('GOOD');
    expect(res.body.location).toBe('Storage Room B');
    expect(res.body.organizationId).toBe(orgId);
  });

  it('condition defaults to GOOD when omitted', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Projector', quantity: 1 })
      .expect(201);
    expect(res.body.condition).toBe('GOOD');
  });

  it('a plain participant cannot create an asset (403)', async () => {
    const email = `assetp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sneaky Asset', quantity: 1 })
      .expect(403);
  });

  it('400 when name is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ quantity: 1 })
      .expect(400);
  });

  it('400 when quantity is 0', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Zero Item', quantity: 0 })
      .expect(400);
  });
});
```

- [ ] **Step 5: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-create
```

Expected: FAIL — `Cannot POST /organizations/:orgId/assets` (404), no `AssetsModule` exists yet.

- [ ] **Step 6: Create the create DTO**

Create `backend/src/assets/dto/create-asset.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AssetCondition } from '@prisma/client';

export class CreateAssetDto {
  @IsString() @MinLength(1) name!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 7: Create `AssetsService`**

Create `backend/src/assets/assets.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAssetDto } from './dto/create-asset.dto';

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(organizationId: string, dto: CreateAssetDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: {
          organizationId,
          name: dto.name,
          quantity: dto.quantity,
          condition: dto.condition,
          location: dto.location,
          notes: dto.notes,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.create',
        targetType: 'Asset', targetId: asset.id,
        metadata: { assetId: asset.id, name: asset.name, quantity: asset.quantity },
      }, tx);
      return asset;
    });
  }
}
```

- [ ] **Step 8: Create `AssetsController`**

Create `backend/src/assets/assets.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assets.create(orgId, dto, user.userId);
  }
}
```

- [ ] **Step 9: Create `AssetsModule`**

Create `backend/src/assets/assets.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
```

- [ ] **Step 10: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { AssetsModule } from './assets/assets.module';
```

Add `AssetsModule` to the `imports` array, after `MinutesModule`:

```ts
    MinutesModule,
    AssetsModule,
```

- [ ] **Step 11: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-create
```

Expected: all tests PASS.

- [ ] **Step 12: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed` (unaffected — no unit tests added, matching `MinutesService`/`FilesService`'s precedent of e2e-only coverage); e2e `234 passed` (229 baseline from the Meeting Minutes phase + 5 new in `assets-create.e2e-spec.ts`).

- [ ] **Step 13: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/prisma/tenant-scope.middleware.ts backend/src/assets backend/src/app.module.ts backend/test/assets-create.e2e-spec.ts
git commit -m "feat: asset management schema + create endpoint"
```

---

### Task 2: List + get-one endpoints

**Files:**
- Modify: `backend/src/assets/assets.service.ts`
- Modify: `backend/src/assets/assets.controller.ts`
- Test: `backend/test/assets-list-get.e2e-spec.ts`

**Interfaces:**
- Consumes: `AssetsService`/`AssetsController` from Task 1 (same files, extended in place).
- Produces: `AssetsService.list(organizationId: string): Promise<Asset[]>` (sorted `name asc`); `AssetsService.findOne(organizationId: string, assetId: string): Promise<Asset>` (throws `NotFoundException` if not found). Routes `GET /organizations/:orgId/assets` and `GET /organizations/:orgId/assets/:assetId`. Task 3 adds update/delete to these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/assets-list-get.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAsset(name: string, quantity: number) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name, quantity })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetLgOrg', slug: `assetlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists assets sorted alphabetically by name', async () => {
    await createAsset('Zebra Banner', 1);
    await createAsset('Amplifier', 2);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const names = res.body.map((a: { name: string }) => a.name);
    expect(names.indexOf('Amplifier')).toBeLessThan(names.indexOf('Zebra Banner'));
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `assetlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('cross-org isolation: org B president cannot list org A assets (403)', async () => {
    const otherPresToken = await registerAndLogin(`assetlg-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AssetLgIsoOrg', slug: `assetlg-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });

  it('get-one returns the full entry', async () => {
    const id = await createAsset('Get One Asset', 5);
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.name).toBe('Get One Asset');
    expect(res.body.quantity).toBe(5);
  });

  it('404 getting an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetLgOtherOrg', slug: `assetlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-list-get
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Add `list` and `findOne` to `AssetsService`**

In `backend/src/assets/assets.service.ts`, add the import and both methods to the class, after `create`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
```

(replaces the existing `import { Injectable } from '@nestjs/common';`)

```ts
  list(organizationId: string) {
    return this.prisma.asset.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(organizationId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, organizationId } });
    if (!asset) throw new NotFoundException('Asset not found in this organization');
    return asset;
  }
```

- [ ] **Step 4: Add the two routes in `AssetsController`**

In `backend/src/assets/assets.controller.ts`, update the import to add `Get`, `Param`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
```

Add these two methods to the class, after `create`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string) {
    return this.assets.list(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':assetId')
  findOne(@OrgId() orgId: string, @Param('assetId') assetId: string) {
    return this.assets.findOne(orgId, assetId);
  }
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-list-get
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `239 passed` (234 from Task 1 + 5 new in `assets-list-get.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/assets/assets.service.ts backend/src/assets/assets.controller.ts backend/test/assets-list-get.e2e-spec.ts
git commit -m "feat: asset management list and get-one endpoints"
```

---

### Task 3: Update + delete endpoints; docs sync

**Files:**
- Create: `backend/src/assets/dto/update-asset.dto.ts`
- Modify: `backend/src/assets/assets.service.ts`
- Modify: `backend/src/assets/assets.controller.ts`
- Test: `backend/test/assets-update.e2e-spec.ts`
- Test: `backend/test/assets-delete.e2e-spec.ts`
- Modify: `docs/database.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: `AssetsService`/`AssetsController` from Tasks 1–2 (same files, extended in place).
- Produces: `AssetsService.update(organizationId: string, assetId: string, dto: UpdateAssetDto, actorUserId: string): Promise<Asset>`; `AssetsService.remove(organizationId: string, assetId: string, actorUserId: string): Promise<{ removed: true }>`. Routes `PATCH /organizations/:orgId/assets/:assetId` and `DELETE /organizations/:orgId/assets/:assetId`. No further tasks extend these files.

- [ ] **Step 1: Create the update DTO**

Create `backend/src/assets/dto/update-asset.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';
import { AssetCondition } from '@prisma/client';

export class UpdateAssetDto {
  @ValidateIf((o) => o.name !== undefined) @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 2: Write the failing e2e tests**

Create `backend/test/assets-update.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset update (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAsset() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Original Name', quantity: 10, location: 'Room A' })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetUpOrg', slug: `assetup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createAsset();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ condition: 'DAMAGED' })
      .expect(200);
    expect(res.body.condition).toBe('DAMAGED');
    expect(res.body.name).toBe('Original Name');
    expect(res.body.location).toBe('Room A');
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createAsset();
    const email = `assetup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ quantity: 999 })
      .expect(403);
  });

  it('404 editing an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetUpOtherOrg', slug: `assetup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ quantity: 2 })
      .expect(404);
  });
});
```

Create `backend/test/assets-delete.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Asset delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createAsset() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Deletable', quantity: 1 })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`assetdel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetDelOrg', slug: `assetdel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes an asset, and it 404s on subsequent get', async () => {
    const id = await createAsset();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createAsset();
    const email = `assetdel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting an assetId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AssetDelOtherOrg', slug: `assetdel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'Other Org Asset', quantity: 1 })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/assets/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 3: Run both e2e files to verify they fail**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-update assets-delete
```

Expected: FAIL — `PATCH`/`DELETE` on `/organizations/:orgId/assets/:assetId` both 404, neither route exists yet.

- [ ] **Step 4: Add `update` and `remove` to `AssetsService`**

In `backend/src/assets/assets.service.ts`, add the import and both methods to the class, after `findOne`:

```ts
import { Prisma } from '@prisma/client';
import { UpdateAssetDto } from './dto/update-asset.dto';
```

```ts
  async update(organizationId: string, assetId: string, dto: UpdateAssetDto, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.asset.findFirst({ where: { id: assetId, organizationId } });
      if (!current) throw new NotFoundException('Asset not found in this organization');

      const data: Prisma.AssetUpdateInput = {
        name: dto.name,
        quantity: dto.quantity,
        condition: dto.condition,
        location: dto.location,
        notes: dto.notes,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.asset.update({ where: { id: assetId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.update',
        targetType: 'Asset', targetId: assetId, metadata: { assetId, fields },
      }, tx);
      return updated;
    });
  }

  async remove(organizationId: string, assetId: string, actorUserId: string): Promise<{ removed: true }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.asset.findFirst({ where: { id: assetId, organizationId } });
      if (!current) throw new NotFoundException('Asset not found in this organization');
      await tx.asset.delete({ where: { id: assetId, organizationId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'asset.delete',
        targetType: 'Asset', targetId: assetId,
        metadata: { assetId, name: current.name },
      }, tx);
      return { removed: true as const };
    });
  }
```

- [ ] **Step 5: Add the two routes in `AssetsController`**

In `backend/src/assets/assets.controller.ts`, update the imports:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UpdateAssetDto } from './dto/update-asset.dto';
```

Add these two methods to the class, after `findOne`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':assetId')
  update(
    @OrgId() orgId: string,
    @Param('assetId') assetId: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.assets.update(orgId, assetId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':assetId')
  remove(@OrgId() orgId: string, @Param('assetId') assetId: string, @CurrentUser() user: { userId: string }) {
    return this.assets.remove(orgId, assetId, user.userId);
  }
```

- [ ] **Step 6: Run both e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json assets-update assets-delete
```

Expected: all tests PASS.

- [ ] **Step 7: Update `docs/database.md`**

Read the current file first (`docs/database.md`), find the `### MeetingMinutes (shipped)` entry (added in the Meeting Minutes phase), and add a new entity block directly after it (before `### ConsentRecord (PDPA) (shipped)`):

```markdown
### Asset (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| name | string | asset type name, e.g. "Folding Chairs" |
| quantity | int | total count of this asset type owned, ≥ 1 |
| condition | enum (`GOOD`, `DAMAGED`, `LOST`) | defaults `GOOD` at creation |
| location | string? | free text, e.g. "Storage Room B" — no fixed enum |
| notes | string? | |
| createdByUserId | uuid | plain column, no FK relation |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| — | `@@index([organizationId])` | |

`Asset` **is** in `TENANT_SCOPED_MODELS` (same reasoning as `OrgFile` and
`MeetingMinutes`). Quantity-per-type, not individual-unit tracking — one
row per asset type, not one row per physical item. List is unpaginated
(bounded inventory, unlike the Meeting Minutes archive), sorted `name asc`.
```

- [ ] **Step 8: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — meeting minutes (shipped)` section (the most recent one), and add a new `### As built — asset management (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`, matching where every prior "As built" section was inserted). Document:

- Five routes under `/organizations/:orgId/assets*` (`POST` create, `GET` list, `GET /:assetId`, `PATCH /:assetId`, `DELETE /:assetId`). Create/edit/delete gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` (same tier as Files/Minutes). List/get-one gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member, any role.
- Quantity-per-type inventory, not individual-unit tracking. `condition` defaults `GOOD` if omitted at creation.
- List is unpaginated — a bounded inventory (dozens of asset types), unlike the paginated Meeting Minutes archive.
- No checkout/return tracking, no purchase/cost fields — out of scope this phase (cost tracking deferred to a future budget-management item).
- Three new audit actions: `asset.create`, `asset.update`, `asset.delete` (`targetType: 'Asset'`) — matches `event.create`/`event.update`/`event.delete`'s shape. Reads (list, get-one) are unaudited.

- [ ] **Step 9: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `245 passed` (239 from Task 2 + 6 new: 3 in `assets-update.e2e-spec.ts` + 3 in `assets-delete.e2e-spec.ts`; docs changes add no tests).

- [ ] **Step 10: Commit**

```bash
git add backend/src/assets/dto/update-asset.dto.ts backend/src/assets/assets.service.ts backend/src/assets/assets.controller.ts backend/test/assets-update.e2e-spec.ts backend/test/assets-delete.e2e-spec.ts docs/database.md docs/security.md
git commit -m "feat: asset management update and delete endpoints; docs sync"
```

---

## Post-plan: roadmap note

Asset Management (Phase 2 item 4) is now shippable end-to-end: create,
unpaginated list, get-one, edit, delete — quantity-per-type inventory with
condition tracking, no checkout/lending workflow, no purchase fields.
Seven Phase 2 items remain, no fixed dependency order: Public Club Page,
Email Notifications, Certificate Generator, Branding & Themes, Event
Feedback+NPS, Committee Handover Pack, Consent-versioned re-prompt.
