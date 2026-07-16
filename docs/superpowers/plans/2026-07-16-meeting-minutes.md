# Meeting Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship structured, org-level Meeting Minutes records — create/list/get/edit/delete, with attendees validated against real Memberships, plus a paginated archive.

**Architecture:** A new `MinutesModule` (`backend/src/minutes/`) mirrors `EventsModule`'s CRUD shape (controller/service/DTOs) for create/update/delete, and `AuditService`'s pagination shape for the list endpoint. New `MeetingMinutes` Prisma model, added to `TENANT_SCOPED_MODELS`. Standalone — no relation to `Event`.

**Tech Stack:** NestJS, Prisma (PostgreSQL), `class-validator`/`class-transformer` (`@ValidateNested`/`@Type`, existing precedent in `backend/src/registrations/dto/upsert-registration-form.dto.ts`).

## Global Constraints

- Guard chain: create/edit/delete → `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`. List/get-one → `JwtAuthGuard, TenantGuard` only (any ACTIVE member of the org, any role).
- `attendeeMembershipIds`: `string[]`, required (may be empty array), every id must resolve to a real `Membership` row in the target org — checked with one `findMany`, not one query per id. Any unknown/foreign id → `400`.
- `agendaItems`: `Array<{ topic: string; notes: string }>`, required (may be empty), both fields non-empty strings.
- `actionItems`: `Array<{ task: string; owner?: string }>`, required (may be empty), `task` non-empty, `owner` optional. No status field.
- Not tied to `Event` — no `eventId` field, no linkage of any kind this phase.
- Three new audit actions: `minutes.create`, `minutes.update`, `minutes.delete` — `targetType: 'MeetingMinutes'`, same shape as `event.create`/`event.update`/`event.delete`.
- List pagination: `page` (default 1), `pageSize` (default 25, max 100) — same convention as `AuditService.list`. Response envelope: `{ data, total, page, pageSize }`.
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.

---

### Task 1: Schema + MinutesModule scaffold + create endpoint

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/**` (generated)
- Modify: `backend/src/prisma/tenant-scope.middleware.ts`
- Create: `backend/src/minutes/dto/agenda-item.dto.ts`
- Create: `backend/src/minutes/dto/action-item.dto.ts`
- Create: `backend/src/minutes/dto/create-minutes.dto.ts`
- Create: `backend/src/minutes/minutes.service.ts`
- Create: `backend/src/minutes/minutes.controller.ts`
- Create: `backend/src/minutes/minutes.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/minutes-create.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService` (`record(entry, tx?)`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`CurrentUser`/`MANAGE_EVENTS` (all pre-existing, same imports as `EventsController`).
- Produces: `MeetingMinutes` Prisma model (fields: `id, organizationId, title, meetingDate, attendeeMembershipIds, agendaItems, actionItems, createdByUserId, createdAt, updatedAt`), reachable via `prisma.meetingMinutes.*`. `MinutesService.create(organizationId: string, dto: CreateMinutesDto, actorUserId: string): Promise<MeetingMinutes>`; private helper `validateAttendees(organizationId: string, attendeeMembershipIds: string[]): Promise<void>` (throws `BadRequestException` on any unknown id — reused by Task 3's update). Route `POST /organizations/:orgId/minutes`. Tasks 2 and 3 add more methods to `MinutesService`/`MinutesController` in these same two files.

- [ ] **Step 1: Add the `MeetingMinutes` model to `schema.prisma`**

Open `backend/prisma/schema.prisma`. Add this model directly after the `OrgFile` model (before `CertificateDownload`):

```prisma
model MeetingMinutes {
  id                    String       @id @default(uuid())
  organizationId        String
  organization          Organization @relation(fields: [organizationId], references: [id])
  title                 String
  meetingDate           DateTime
  attendeeMembershipIds Json
  agendaItems           Json
  actionItems           Json
  createdByUserId       String
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  @@index([organizationId])
}
```

Add one field to the existing `Organization` model (in its list of relation fields, e.g. right after `files OrgFile[]`):

```prisma
  minutes        MeetingMinutes[]
```

- [ ] **Step 2: Add `MeetingMinutes` to `TENANT_SCOPED_MODELS`**

In `backend/src/prisma/tenant-scope.middleware.ts`, update line 4:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes'];
```

- [ ] **Step 3: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add_meeting_minutes_model
```

Expected: migration applies cleanly, Prisma Client regenerates with a `meetingMinutes` delegate. Confirm with:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 4: Write the failing e2e tests for create**

Create `backend/test/minutes-create.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes create (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  const pres = `min-${Date.now()}@test.io`;

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinOrg', slug: `min-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${presToken}`)).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee member creates a minutes entry', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Weekly Committee Meeting',
        meetingDate: '2026-07-10T00:00:00.000Z',
        attendeeMembershipIds: [presMembershipId],
        agendaItems: [{ topic: 'Budget', notes: 'Reviewed Q3 spend' }],
        actionItems: [{ task: 'Book venue for next event', owner: 'Secretary' }],
      })
      .expect(201);
    expect(res.body.title).toBe('Weekly Committee Meeting');
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.attendeeMembershipIds).toEqual([presMembershipId]);
    expect(res.body.agendaItems).toEqual([{ topic: 'Budget', notes: 'Reviewed Q3 spend' }]);
    expect(res.body.actionItems).toEqual([{ task: 'Book venue for next event', owner: 'Secretary' }]);
  });

  it('a plain participant cannot create minutes (403)', async () => {
    const email = `minp-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Sneaky Minutes', meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(403);
  });

  it('400 when an attendeeMembershipIds entry does not belong to this org', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Bad Attendee',
        meetingDate: '2026-07-10T00:00:00.000Z',
        attendeeMembershipIds: ['00000000-0000-0000-0000-000000000000'],
        agendaItems: [], actionItems: [],
      })
      .expect(400);
  });

  it('400 when title is missing', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(400);
  });

  it('400 when meetingDate is unparseable', async () => {
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Bad Date', meetingDate: 'not-a-date', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(400);
  });
});
```

- [ ] **Step 5: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-create
```

Expected: FAIL — `Cannot POST /organizations/:orgId/minutes` (404), no `MinutesModule` exists yet.

- [ ] **Step 6: Create the nested-item DTOs**

Create `backend/src/minutes/dto/agenda-item.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class AgendaItemDto {
  @IsString() @MinLength(1) topic!: string;
  @IsString() @MinLength(1) notes!: string;
}
```

Create `backend/src/minutes/dto/action-item.dto.ts`:

```ts
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ActionItemDto {
  @IsString() @MinLength(1) task!: string;
  @IsOptional() @IsString() owner?: string;
}
```

- [ ] **Step 7: Create the create DTO**

Create `backend/src/minutes/dto/create-minutes.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsString, MinLength, ValidateNested } from 'class-validator';
import { AgendaItemDto } from './agenda-item.dto';
import { ActionItemDto } from './action-item.dto';

export class CreateMinutesDto {
  @IsString() @MinLength(2) title!: string;
  @IsISO8601() meetingDate!: string;
  @IsArray() @IsString({ each: true }) attendeeMembershipIds!: string[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto) agendaItems!: AgendaItemDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => ActionItemDto) actionItems!: ActionItemDto[];
}
```

- [ ] **Step 8: Create `MinutesService`**

Create `backend/src/minutes/minutes.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateMinutesDto } from './dto/create-minutes.dto';

@Injectable()
export class MinutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async validateAttendees(organizationId: string, attendeeMembershipIds: string[]) {
    if (attendeeMembershipIds.length === 0) return;
    const found = await this.prisma.membership.findMany({
      where: { id: { in: attendeeMembershipIds }, organizationId },
      select: { id: true },
    });
    if (found.length !== attendeeMembershipIds.length) {
      throw new BadRequestException('One or more attendeeMembershipIds do not belong to this organization');
    }
  }

  async create(organizationId: string, dto: CreateMinutesDto, actorUserId: string) {
    await this.validateAttendees(organizationId, dto.attendeeMembershipIds);
    const meetingDate = new Date(dto.meetingDate);

    return this.prisma.$transaction(async (tx) => {
      const minutes = await tx.meetingMinutes.create({
        data: {
          organizationId,
          title: dto.title,
          meetingDate,
          attendeeMembershipIds: dto.attendeeMembershipIds as any,
          agendaItems: dto.agendaItems as any,
          actionItems: dto.actionItems as any,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'minutes.create',
        targetType: 'MeetingMinutes', targetId: minutes.id,
        metadata: { minutesId: minutes.id, title: minutes.title, meetingDate: minutes.meetingDate },
      }, tx);
      return minutes;
    });
  }
}
```

- [ ] **Step 9: Create `MinutesController`**

Create `backend/src/minutes/minutes.controller.ts`:

```ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { MinutesService } from './minutes.service';
import { CreateMinutesDto } from './dto/create-minutes.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/minutes')
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Post()
  create(
    @OrgId() orgId: string,
    @Body() dto: CreateMinutesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.minutes.create(orgId, dto, user.userId);
  }
}
```

- [ ] **Step 10: Create `MinutesModule`**

Create `backend/src/minutes/minutes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MinutesController } from './minutes.controller';
import { MinutesService } from './minutes.service';

@Module({
  controllers: [MinutesController],
  providers: [MinutesService],
  exports: [MinutesService],
})
export class MinutesModule {}
```

- [ ] **Step 11: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { MinutesModule } from './minutes/minutes.module';
```

Add `MinutesModule` to the `imports` array, after `FilesModule`:

```ts
    FilesModule,
    MinutesModule,
```

- [ ] **Step 12: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-create
```

Expected: all tests PASS.

- [ ] **Step 13: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed` (unaffected — no unit tests added, matching `EventsService`/`FilesService`'s precedent of e2e-only coverage); e2e `216 passed` (211 baseline from the File Repository phase + 5 new in `minutes-create.e2e-spec.ts`).

- [ ] **Step 14: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/prisma/tenant-scope.middleware.ts backend/src/minutes backend/src/app.module.ts backend/test/minutes-create.e2e-spec.ts
git commit -m "feat: meeting minutes schema + create endpoint"
```

---

### Task 2: List (archive) + get-one endpoints

**Files:**
- Modify: `backend/src/minutes/minutes.service.ts`
- Modify: `backend/src/minutes/minutes.controller.ts`
- Test: `backend/test/minutes-list-get.e2e-spec.ts`

**Interfaces:**
- Consumes: `MinutesService`/`MinutesController` from Task 1 (same files, extended in place).
- Produces: `MinutesService.list(organizationId: string, page?: string, pageSize?: string): Promise<{ data: MeetingMinutes[]; total: number; page: number; pageSize: number }>`; `MinutesService.findOne(organizationId: string, minutesId: string): Promise<MeetingMinutes>` (throws `NotFoundException` if not found). Routes `GET /organizations/:orgId/minutes` and `GET /organizations/:orgId/minutes/:minutesId`. Task 3 adds update/delete to these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/minutes-list-get.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes list + get (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createMinutes(title: string, meetingDate: string) {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, meetingDate, attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`minlg-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOrg', slug: `minlg-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists entries sorted by meetingDate descending', async () => {
    await createMinutes('Older Meeting', '2026-01-01T00:00:00.000Z');
    await createMinutes('Newer Meeting', '2026-06-01T00:00:00.000Z');

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    const titles = res.body.data.map((m: { title: string }) => m.title);
    expect(titles.indexOf('Newer Meeting')).toBeLessThan(titles.indexOf('Older Meeting'));
  });

  it('paginates with page and pageSize', async () => {
    const orgId2 = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOrg2', slug: `minlg2-${Date.now()}` })).body.id;
    const seed = (title: string, meetingDate: string) => request(app.getHttpServer())
      .post(`/organizations/${orgId2}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title, meetingDate, attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    await seed('M1', '2026-01-01T00:00:00.000Z');
    await seed('M2', '2026-01-02T00:00:00.000Z');
    await seed('M3', '2026-01-03T00:00:00.000Z');

    const page1 = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/minutes?page=1&pageSize=2`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const page2 = await request(app.getHttpServer())
      .get(`/organizations/${orgId2}/minutes?page=2&pageSize=2`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(page1.body.total).toBe(3);
    expect(page1.body.data).toHaveLength(2);
    expect(page2.body.data).toHaveLength(1);
  });

  it('a plain participant can list (no RBAC restriction)', async () => {
    const email = `minlg-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${memberToken}`).expect(200);
  });

  it('get-one returns the full entry including agenda and action items', async () => {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Full Entry', meetingDate: '2026-03-01T00:00:00.000Z',
        attendeeMembershipIds: [],
        agendaItems: [{ topic: 'Topic A', notes: 'Notes A' }],
        actionItems: [{ task: 'Task A', owner: 'Someone' }],
      }).expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${res.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(getRes.body.agendaItems).toEqual([{ topic: 'Topic A', notes: 'Notes A' }]);
    expect(getRes.body.actionItems).toEqual([{ task: 'Task A', owner: 'Someone' }]);
  });

  it('404 getting a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinLgOtherOrg', slug: `minlg-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('cross-org isolation: org B president cannot list org A minutes (403)', async () => {
    const otherPresToken = await registerAndLogin(`minlg-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'MinLgIsoOrg', slug: `minlg-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-list-get
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Add `list` and `findOne` to `MinutesService`**

In `backend/src/minutes/minutes.service.ts`, add the import and both methods to the class, after `create`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
```

(replaces the existing `import { BadRequestException, Injectable } from '@nestjs/common';`)

```ts
  async list(organizationId: string, page?: string, pageSize?: string) {
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 25));

    const [data, total] = await Promise.all([
      this.prisma.meetingMinutes.findMany({
        where: { organizationId },
        orderBy: { meetingDate: 'desc' },
        skip: (pageNum - 1) * size,
        take: size,
      }),
      this.prisma.meetingMinutes.count({ where: { organizationId } }),
    ]);
    return { data, total, page: pageNum, pageSize: size };
  }

  async findOne(organizationId: string, minutesId: string) {
    const minutes = await this.prisma.meetingMinutes.findFirst({ where: { id: minutesId, organizationId } });
    if (!minutes) throw new NotFoundException('Minutes not found in this organization');
    return minutes;
  }
```

- [ ] **Step 4: Add the two routes in `MinutesController`**

In `backend/src/minutes/minutes.controller.ts`, update the import to add `Get`, `Param`, `Query`:

```ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
```

Add these two methods to the class, after `create`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get()
  list(@OrgId() orgId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.minutes.list(orgId, page, pageSize);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':minutesId')
  findOne(@OrgId() orgId: string, @Param('minutesId') minutesId: string) {
    return this.minutes.findOne(orgId, minutesId);
  }
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-list-get
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `222 passed` (216 from Task 1 + 6 new in `minutes-list-get.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/minutes/minutes.service.ts backend/src/minutes/minutes.controller.ts backend/test/minutes-list-get.e2e-spec.ts
git commit -m "feat: meeting minutes list and get-one endpoints"
```

---

### Task 3: Update + delete endpoints; docs sync

**Files:**
- Create: `backend/src/minutes/dto/update-minutes.dto.ts`
- Modify: `backend/src/minutes/minutes.service.ts`
- Modify: `backend/src/minutes/minutes.controller.ts`
- Test: `backend/test/minutes-update.e2e-spec.ts`
- Test: `backend/test/minutes-delete.e2e-spec.ts`
- Modify: `docs/database.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: `MinutesService`/`MinutesController` from Tasks 1–2 (same files, extended in place); `validateAttendees` (Task 1).
- Produces: `MinutesService.update(organizationId: string, minutesId: string, dto: UpdateMinutesDto, actorUserId: string): Promise<MeetingMinutes>`; `MinutesService.remove(organizationId: string, minutesId: string, actorUserId: string): Promise<{ removed: true }>`. Routes `PATCH /organizations/:orgId/minutes/:minutesId` and `DELETE /organizations/:orgId/minutes/:minutesId`. No further tasks extend these files.

- [ ] **Step 1: Create the update DTO**

Create `backend/src/minutes/dto/update-minutes.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { AgendaItemDto } from './agenda-item.dto';
import { ActionItemDto } from './action-item.dto';

export class UpdateMinutesDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(2) title?: string;
  @IsOptional() @IsISO8601() meetingDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attendeeMembershipIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AgendaItemDto) agendaItems?: AgendaItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ActionItemDto) actionItems?: ActionItemDto[];
}
```

- [ ] **Step 2: Write the failing e2e tests**

Create `backend/test/minutes-update.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes update (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createMinutes() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({
        title: 'Original Title', meetingDate: '2026-02-01T00:00:00.000Z',
        attendeeMembershipIds: [], agendaItems: [{ topic: 'A', notes: 'B' }], actionItems: [],
      }).expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`minup-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinUpOrg', slug: `minup-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates a subset of fields, leaving others untouched', async () => {
    const id = await createMinutes();
    const res = await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Updated Title' })
      .expect(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.agendaItems).toEqual([{ topic: 'A', notes: 'B' }]);
  });

  it('400 when an updated attendeeMembershipIds entry does not belong to this org', async () => {
    const id = await createMinutes();
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ attendeeMembershipIds: ['00000000-0000-0000-0000-000000000000'] })
      .expect(400);
  });

  it('a plain participant cannot edit (403)', async () => {
    const id = await createMinutes();
    const email = `minup-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ title: 'Sneaky Edit' })
      .expect(403);
  });

  it('404 editing a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinUpOtherOrg', slug: `minup-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Should Not Work' })
      .expect(404);
  });
});
```

Create `backend/test/minutes-delete.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Meeting minutes delete (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function createMinutes() {
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Deletable', meetingDate: '2026-02-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);
    return res.body.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`mindel-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinDelOrg', slug: `mindel-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('committee deletes a minutes entry, and it 404s on subsequent get', async () => {
    const id = await createMinutes();
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${presToken}`).expect(404);
  });

  it('a plain participant cannot delete (403)', async () => {
    const id = await createMinutes();
    const email = `mindel-p-${Date.now()}@test.io`;
    await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email, role: 'PARTICIPANT' }).expect(201);
    const memberToken = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${id}`)
      .set('Authorization', `Bearer ${memberToken}`).expect(403);
  });

  it('404 deleting a minutesId from a different org', async () => {
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'MinDelOtherOrg', slug: `mindel-other-${Date.now()}` })).body.id;
    const otherRes = await request(app.getHttpServer())
      .post(`/organizations/${otherOrgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Other Org Minutes', meetingDate: '2026-01-01T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/organizations/${orgId}/minutes/${otherRes.body.id}`)
      .set('Authorization', `Bearer ${presToken}`)
      .expect(404);
  });
});
```

- [ ] **Step 3: Run both e2e files to verify they fail**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-update minutes-delete
```

Expected: FAIL — `PATCH`/`DELETE` on `/organizations/:orgId/minutes/:minutesId` both 404, neither route exists yet.

- [ ] **Step 4: Add `update` and `remove` to `MinutesService`**

In `backend/src/minutes/minutes.service.ts`, add the import and both methods to the class, after `findOne`:

```ts
import { Prisma } from '@prisma/client';
import { UpdateMinutesDto } from './dto/update-minutes.dto';
```

```ts
  async update(organizationId: string, minutesId: string, dto: UpdateMinutesDto, actorUserId: string) {
    if (dto.attendeeMembershipIds) {
      await this.validateAttendees(organizationId, dto.attendeeMembershipIds);
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.meetingMinutes.findFirst({ where: { id: minutesId, organizationId } });
      if (!current) throw new NotFoundException('Minutes not found in this organization');

      const data: Prisma.MeetingMinutesUpdateInput = {
        title: dto.title,
        meetingDate: dto.meetingDate ? new Date(dto.meetingDate) : undefined,
        attendeeMembershipIds: dto.attendeeMembershipIds as any,
        agendaItems: dto.agendaItems as any,
        actionItems: dto.actionItems as any,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.meetingMinutes.update({ where: { id: minutesId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'minutes.update',
        targetType: 'MeetingMinutes', targetId: minutesId, metadata: { minutesId, fields },
      }, tx);
      return updated;
    });
  }

  async remove(organizationId: string, minutesId: string, actorUserId: string): Promise<{ removed: true }> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.meetingMinutes.findFirst({ where: { id: minutesId, organizationId } });
      if (!current) throw new NotFoundException('Minutes not found in this organization');
      await tx.meetingMinutes.delete({ where: { id: minutesId, organizationId } });
      await this.audit.record({
        organizationId, actorUserId, action: 'minutes.delete',
        targetType: 'MeetingMinutes', targetId: minutesId,
        metadata: { minutesId, title: current.title },
      }, tx);
      return { removed: true as const };
    });
  }
```

- [ ] **Step 5: Add the two routes in `MinutesController`**

In `backend/src/minutes/minutes.controller.ts`, update the imports:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UpdateMinutesDto } from './dto/update-minutes.dto';
```

Add these two methods to the class, after `findOne`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Patch(':minutesId')
  update(
    @OrgId() orgId: string,
    @Param('minutesId') minutesId: string,
    @Body() dto: UpdateMinutesDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.minutes.update(orgId, minutesId, dto, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Delete(':minutesId')
  remove(@OrgId() orgId: string, @Param('minutesId') minutesId: string, @CurrentUser() user: { userId: string }) {
    return this.minutes.remove(orgId, minutesId, user.userId);
  }
```

- [ ] **Step 6: Run both e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json minutes-update minutes-delete
```

Expected: all tests PASS.

- [ ] **Step 7: Update `docs/database.md`**

Read the current file first (`docs/database.md`), find the `### OrgFile (shipped)` entry (added in the File Repository phase), and add a new entity block directly after it (before `### CertificateDownload (shipped)`):

```markdown
### MeetingMinutes (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| organizationId | uuid (FK → Organization) | |
| title | string | |
| meetingDate | timestamp | |
| attendeeMembershipIds | json | `string[]` of `Membership.id`s, validated against real ACTIVE-org memberships at create/update time |
| agendaItems | json | `Array<{ topic: string; notes: string }>` |
| actionItems | json | `Array<{ task: string; owner?: string }>` — no status field, text record only |
| createdByUserId | uuid | plain column, no FK relation |
| createdAt | timestamp | |
| updatedAt | timestamp | |
| — | `@@index([organizationId])` | |

`MeetingMinutes` **is** in `TENANT_SCOPED_MODELS` (same reasoning as
`OrgFile`) — the archive/list endpoint issues a genuine org-scoped
`findMany`. Not tied to `Event` — standalone org-level records. No join
table for attendees: stored as a validated `Json` array of Membership ids,
matching the `Json`-for-structured-non-relational-data convention already
used by `Organization.advisors`/`socialLinks`, `Membership.committeeHistory`,
and `Registration.answers`.
```

- [ ] **Step 8: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — file repository (shipped)` section (the most recent one), and add a new `### As built — meeting minutes (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`, matching where every prior "As built" section was inserted). Document:

- Five routes under `/organizations/:orgId/minutes*` (`POST` create, `GET` list, `GET /:minutesId`, `PATCH /:minutesId`, `DELETE /:minutesId`). Create/edit/delete gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` (same tier as Events/Files). List/get-one gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member, any role.
- `attendeeMembershipIds` is validated on every create/update against real `Membership` rows in the target org — an unknown or foreign-org id is rejected with `400`, never silently accepted.
- Standalone, org-level records — no relation to `Event`.
- Action items are plain text (`task` + optional `owner`) with no status field — this is a record, not a task tracker.
- List is paginated (`page`/`pageSize`, default 25/max 100 — same convention as `AuditService.list`), sorted `meetingDate desc`.
- Three new audit actions: `minutes.create`, `minutes.update`, `minutes.delete` (`targetType: 'MeetingMinutes'`) — matches `event.create`/`event.update`/`event.delete`'s shape. Reads (list, get-one) are unaudited.

- [ ] **Step 9: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `229 passed` (222 from Task 2 + 7 new: 4 in `minutes-update.e2e-spec.ts` + 3 in `minutes-delete.e2e-spec.ts`; docs changes add no tests).

- [ ] **Step 10: Commit**

```bash
git add backend/src/minutes/dto/update-minutes.dto.ts backend/src/minutes/minutes.service.ts backend/src/minutes/minutes.controller.ts backend/test/minutes-update.e2e-spec.ts backend/test/minutes-delete.e2e-spec.ts docs/database.md docs/security.md
git commit -m "feat: meeting minutes update and delete endpoints; docs sync"
```

---

## Post-plan: roadmap note

Meeting Minutes (Phase 2 item 3) is now shippable end-to-end: create,
paginated archive, get-one, edit, delete — attendees validated against
real Memberships, no Event linkage, no attachments. Eight Phase 2 items
remain, no fixed dependency order: Asset Management, Public Club Page,
Email Notifications, Certificate Generator, Branding & Themes, Event
Feedback+NPS, Committee Handover Pack, Consent-versioned re-prompt.
