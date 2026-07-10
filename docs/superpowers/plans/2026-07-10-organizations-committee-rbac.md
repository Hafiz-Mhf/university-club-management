# Organizations & Committee/RBAC Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full committee/member management on top of the foundation — list "my orgs", update org profile, list org members, add/update/remove members, and change committee roles — all per-org RBAC-gated, tenant-isolated, and audited.

**Architecture:** A new `memberships` module (controller/service/DTOs) alongside the existing `organizations` module. Member endpoints are nested under `/organizations/:orgId/...`, guarded by `JwtAuthGuard → TenantGuard → RolesGuard`. All membership queries are org-scoped (the Prisma tenant-scope middleware already throws on unscoped `Membership` filtering queries, so scoping is enforced, not optional). Sensitive mutations (role change, removal) write `AuditLog` rows. A guardrail prevents removing/demoting the last active `PRESIDENT`.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, class-validator, Jest + Supertest. Reuses existing `JwtAuthGuard`, `TenantGuard`, `RolesGuard`, `@Roles`, `@OrgId`, `@CurrentUser`, `AuditService`.

## Global Constraints

- Every membership query is org-scoped by `organizationId` (never trust a raw `membershipId` alone — verify it belongs to `req.organizationId` first).
- RBAC per-organization via `Membership.role`. Permission tiers (from `docs/security.md`):
  - **Manage members** (add / update profile / remove / list): `PRESIDENT`, `VICE_PRESIDENT`, `SECRETARY`, `TREASURER`, `EVENT_DIRECTOR`.
  - **Manage committee roles** (change a member's role): `PRESIDENT`, `VICE_PRESIDENT` only.
  - **View members**: the manage-members tier plus `COMMITTEE`.
- An organization must always have ≥ 1 active `PRESIDENT` — reject any role-change or removal that would drop the last one (`ConflictException`).
- Adding a member requires the target user to already have an account (invite-by-email with account creation is Phase 2). Unknown email → `404`.
- A user may hold only one membership per org (`@@unique([userId, organizationId])`) — duplicate add → `409`.
- Audit these actions: `member.add`, `member.role.change`, `member.remove`, `member.status.change`. Metadata carries ids + role names only — **no personal data** (no email/name/phone).
- All endpoints validate input via DTOs. e2e tests use `import request from 'supertest'` (default import). TDD throughout. No regressions to the existing suite.

---

### Task 1: Org profile update + "my organizations" list

**Files:**
- Create: `backend/src/organizations/dto/update-organization.dto.ts`
- Modify: `backend/src/organizations/organizations.service.ts`
- Modify: `backend/src/organizations/organizations.controller.ts`
- Test: `backend/test/organizations.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, guards, `@CurrentUser`, `@OrgId`.
- Produces: `OrganizationsService.listForUser(userId): Promise<Organization[]>` (orgs where the user has a membership); `OrganizationsService.updateProfile(orgId, dto, actorUserId): Promise<Organization>` (updates name/description/logoKey/socialLinks/advisors; audited `organization.profile.update`). Routes: `GET /organizations` (my orgs), `PATCH /organizations/:orgId` (profile; `PRESIDENT`/`VICE_PRESIDENT`).

- [ ] **Step 1: Write `dto/update-organization.dto.ts`**

```typescript
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
  @IsString()
  logoKey?: string;

  @IsOptional()
  socialLinks?: Record<string, string>;

  @IsOptional()
  advisors?: string[];
}
```

- [ ] **Step 2: Write failing e2e `backend/test/organizations.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Organizations profile/list (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let orgId: string;
  const email = `org-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'Org Owner' });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`).send({ name: 'ACM', slug: `acm-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists organizations the caller belongs to', async () => {
    const res = await request(app.getHttpServer()).get('/organizations')
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.map((o: { id: string }) => o.id)).toContain(orgId);
  });

  it('updates the org profile as PRESIDENT', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Computing society', advisors: ['Dr. Smith'] })
      .expect(200);
    expect(res.body.description).toBe('Computing society');
    expect(res.body.advisors).toEqual(['Dr. Smith']);
  });

  it('rejects an unknown field via DTO whitelist (no mass-assignment)', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ storageQuotaMb: 999999 })
      .expect(200);
    const fetched = await request(app.getHttpServer()).get(`/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(fetched.body.storageQuotaMb).toBe(1024); // unchanged default
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- organizations`
Expected: FAIL (GET /organizations 404 / PATCH :orgId 404 — routes missing).

- [ ] **Step 4: Add service methods**

In `organizations.service.ts`:

```typescript
listForUser(userId: string) {
  return this.prisma.organization.findMany({
    where: { memberships: { some: { userId } } },
    orderBy: { name: 'asc' },
  });
}

async updateProfile(
  organizationId: string,
  dto: import('./dto/update-organization.dto').UpdateOrganizationDto,
  actorUserId?: string,
) {
  const data: Prisma.OrganizationUpdateInput = {};
  if (dto.name !== undefined) data.name = dto.name;
  if (dto.description !== undefined) data.description = dto.description;
  if (dto.logoKey !== undefined) data.logoKey = dto.logoKey;
  if (dto.socialLinks !== undefined) data.socialLinks = dto.socialLinks as Prisma.InputJsonValue;
  if (dto.advisors !== undefined) data.advisors = dto.advisors as Prisma.InputJsonValue;
  const org = await this.prisma.organization.update({ where: { id: organizationId }, data });
  await this.audit.record({
    organizationId, actorUserId, action: 'organization.profile.update',
    targetType: 'Organization', targetId: organizationId,
    metadata: { fields: Object.keys(data) },
  });
  return org;
}
```

- [ ] **Step 5: Add routes**

In `organizations.controller.ts` (import `UpdateOrganizationDto`):

```typescript
@UseGuards(JwtAuthGuard)
@Get()
listMine(@CurrentUser() user: { userId: string }) {
  return this.orgs.listForUser(user.userId);
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
```

Note: `GET /organizations` (no `:orgId`) must be declared so it does not collide with `GET /organizations/:orgId`; Nest matches the static path fine, but keep `listMine` above `findOne` for clarity.

- [ ] **Step 6: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- organizations && npx jest && npm run test:e2e`
Expected: organizations e2e 3/3 PASS; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/organizations backend/test/organizations.e2e-spec.ts
git commit -m "feat: org profile update + list my organizations"
```

---

### Task 2: Memberships module + list members + my membership

**Files:**
- Create: `backend/src/memberships/memberships.module.ts`
- Create: `backend/src/memberships/memberships.service.ts`
- Create: `backend/src/memberships/memberships.controller.ts`
- Create: `backend/src/rbac/role-groups.ts`
- Modify: `backend/src/app.module.ts` (register `MembershipsModule`)
- Test: `backend/test/memberships-list.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, guards, `@OrgId`, `@CurrentUser`.
- Produces: `role-groups.ts` exporting `MANAGE_MEMBERS: Role[]` (`PRESIDENT, VICE_PRESIDENT, SECRETARY, TREASURER, EVENT_DIRECTOR`), `VIEW_MEMBERS: Role[]` (MANAGE_MEMBERS + `COMMITTEE`), `MANAGE_ROLES: Role[]` (`PRESIDENT, VICE_PRESIDENT`). `MembershipsService.list(orgId, { status?, role? }): Promise<Membership[]>` (org-scoped, includes user `{id, fullName, email}`); `MembershipsService.findMine(orgId, userId): Promise<Membership | null>`. Routes: `GET /organizations/:orgId/members` (VIEW_MEMBERS), `GET /organizations/:orgId/members/me` (any member).

- [ ] **Step 1: Write `src/rbac/role-groups.ts`**

```typescript
import { Role } from '@prisma/client';

export const MANAGE_MEMBERS: Role[] = ['PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR'];
export const VIEW_MEMBERS: Role[] = [...MANAGE_MEMBERS, 'COMMITTEE'];
export const MANAGE_ROLES: Role[] = ['PRESIDENT', 'VICE_PRESIDENT'];
```

- [ ] **Step 2: Write failing e2e `backend/test/memberships-list.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Memberships list/me (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let orgId: string;
  const email = `mem-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'Pres' });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`).send({ name: 'M', slug: `m-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('lists members (creator present as PRESIDENT)', async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].role).toBe('PRESIDENT');
    expect(res.body[0].user.email).toBe(email);
  });

  it('returns my membership', async () => {
    const res = await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.role).toBe('PRESIDENT');
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- memberships-list`
Expected: FAIL (routes missing / module not registered).

- [ ] **Step 4: Write the service**

`src/memberships/memberships.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const USER_SELECT = { id: true, fullName: true, email: true };

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string, filter: { status?: MemberStatus; role?: Role }) {
    return this.prisma.membership.findMany({
      where: { organizationId, status: filter.status, role: filter.role },
      include: { user: { select: USER_SELECT } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  findMine(organizationId: string, userId: string) {
    return this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { user: { select: USER_SELECT } },
    });
  }
}
```

- [ ] **Step 5: Write the controller**

`src/memberships/memberships.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role, MemberStatus } from '@prisma/client';
import { MembershipsService } from './memberships.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VIEW_MEMBERS } from '../rbac/role-groups';

@Controller('organizations/:orgId/members')
export class MembershipsController {
  constructor(private readonly members: MembershipsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...VIEW_MEMBERS)
  @Get()
  list(
    @OrgId() orgId: string,
    @Query('status') status?: MemberStatus,
    @Query('role') role?: Role,
  ) {
    return this.members.list(orgId, { status, role });
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    return this.members.findMine(orgId, user.userId);
  }
}
```

- [ ] **Step 6: Write the module + register it**

`src/memberships/memberships.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';

@Module({
  providers: [MembershipsService],
  controllers: [MembershipsController],
  exports: [MembershipsService],
})
export class MembershipsModule {}
```

Register `MembershipsModule` in `app.module.ts` imports.

- [ ] **Step 7: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- memberships-list && npx jest && npm run test:e2e`
Expected: memberships-list 2/2 PASS; whole suite green.

- [ ] **Step 8: Commit**

```bash
git add backend/src/memberships backend/src/rbac/role-groups.ts backend/src/app.module.ts backend/test/memberships-list.e2e-spec.ts
git commit -m "feat: memberships module + list members + my membership"
```

---

### Task 3: Add a member (existing user, by email)

**Files:**
- Create: `backend/src/memberships/dto/add-member.dto.ts`
- Modify: `backend/src/memberships/memberships.service.ts`, `memberships.controller.ts`, `memberships.module.ts`
- Test: `backend/test/memberships-add.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `MANAGE_MEMBERS`.
- Produces: `MembershipsService.add(orgId, dto, actorUserId): Promise<Membership>` — resolves the target user by email (`404` if none), creates a `Membership` (`409` if already a member), attaches profile fields, audits `member.add`. Route: `POST /organizations/:orgId/members` (MANAGE_MEMBERS).

- [ ] **Step 1: Write `dto/add-member.dto.ts`**

```typescript
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() faculty?: string;
  @IsOptional() @IsString() programme?: string;
  @IsOptional() @IsString() intake?: string;
  @IsOptional() @IsString() phone?: string;
}
```

- [ ] **Step 2: Write failing e2e `backend/test/memberships-add.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Add member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `pres-${Date.now()}@test.io`;
  const newbie = `new-${Date.now()}@test.io`;

  async function register(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email.split('@')[0] });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await register(pres);
    await register(newbie);
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' });
    presToken = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${presToken}`).send({ name: 'AddOrg', slug: `add-${Date.now()}` });
    orgId = org.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('adds an existing user as COMMITTEE', async () => {
    const res = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: newbie, role: 'COMMITTEE', faculty: 'ICT' })
      .expect(201);
    expect(res.body.role).toBe('COMMITTEE');
    expect(res.body.faculty).toBe('ICT');
  });

  it('409 on adding the same user twice', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: newbie, role: 'VOLUNTEER' })
      .expect(409);
  });

  it('404 when the email has no account', async () => {
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email: `ghost-${Date.now()}@test.io`, role: 'VOLUNTEER' })
      .expect(404);
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- memberships-add`
Expected: FAIL (route missing).

- [ ] **Step 4: Add `add` to the service**

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AddMemberDto } from './dto/add-member.dto';
// constructor: add `private readonly audit: AuditService,`

async add(organizationId: string, dto: AddMemberDto, actorUserId?: string) {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) throw new NotFoundException('No account for that email');
  const existing = await this.prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  if (existing) throw new ConflictException('User is already a member');
  const membership = await this.prisma.membership.create({
    data: {
      organizationId,
      userId: user.id,
      role: dto.role,
      studentId: dto.studentId,
      faculty: dto.faculty,
      programme: dto.programme,
      intake: dto.intake,
      phone: dto.phone,
    },
  });
  await this.audit.record({
    organizationId, actorUserId, action: 'member.add',
    targetType: 'Membership', targetId: membership.id,
    metadata: { userId: user.id, role: dto.role },
  });
  return membership;
}
```

- [ ] **Step 5: Add the route + wire AuditModule availability**

In `memberships.controller.ts`:

```typescript
import { Body, Post } from '@nestjs/common';
import { AddMemberDto } from './dto/add-member.dto';
import { Roles } from '../rbac/roles.decorator';
import { MANAGE_MEMBERS } from '../rbac/role-groups';
// ...
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...MANAGE_MEMBERS)
@Post()
add(
  @OrgId() orgId: string,
  @Body() dto: AddMemberDto,
  @CurrentUser() user: { userId: string },
) {
  return this.members.add(orgId, dto, user.userId);
}
```

`AuditModule` is `@Global`, so `AuditService` injects without importing. No module change needed beyond confirming the build.

- [ ] **Step 6: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- memberships-add && npx jest && npm run test:e2e`
Expected: memberships-add 3/3 PASS; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/memberships backend/test/memberships-add.e2e-spec.ts
git commit -m "feat: add member (existing user) with role + profile"
```

---

### Task 4: Update member profile + status (active/alumni)

**Files:**
- Create: `backend/src/memberships/dto/update-member.dto.ts`
- Modify: `backend/src/memberships/memberships.service.ts`, `memberships.controller.ts`
- Test: `backend/test/memberships-update.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `MANAGE_MEMBERS`.
- Produces: `MembershipsService.updateMember(orgId, membershipId, dto, actorUserId): Promise<Membership>` — verifies the membership belongs to the org (org-scoped `findFirst`; `404` otherwise), updates profile fields and/or `status`; audits `member.status.change` when status changes. Route: `PATCH /organizations/:orgId/members/:membershipId` (MANAGE_MEMBERS). **Does not** change `role` (that is Task 5).

- [ ] **Step 1: Write `dto/update-member.dto.ts`**

```typescript
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { MemberStatus } from '@prisma/client';

export class UpdateMemberDto {
  @IsOptional() @IsEnum(MemberStatus) status?: MemberStatus;
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() faculty?: string;
  @IsOptional() @IsString() programme?: string;
  @IsOptional() @IsString() intake?: string;
  @IsOptional() @IsString() phone?: string;
}
```

- [ ] **Step 2: Write failing e2e `backend/test/memberships-update.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Update member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let memberId: string;
  const pres = `p-${Date.now()}@test.io`;
  const other = `o-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'U', slug: `u-${Date.now()}` })).body.id;
    const added = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' });
    memberId = added.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('updates profile fields', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${memberId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ programme: 'BCS', intake: '2024' }).expect(200);
    expect(res.body.programme).toBe('BCS');
  });

  it('marks a member as ALUMNI', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${memberId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ status: 'ALUMNI' }).expect(200);
    expect(res.body.status).toBe('ALUMNI');
  });

  it('404 for a membership id not in this org', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${presToken}`).send({ programme: 'x' }).expect(404);
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- memberships-update`
Expected: FAIL (route missing).

- [ ] **Step 4: Add `updateMember` to the service**

```typescript
import { UpdateMemberDto } from './dto/update-member.dto';

async updateMember(
  organizationId: string,
  membershipId: string,
  dto: UpdateMemberDto,
  actorUserId?: string,
) {
  // org-scoped existence check (findFirst is a scoped action — includes organizationId)
  const current = await this.prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!current) throw new NotFoundException('Membership not found in this organization');

  const updated = await this.prisma.membership.update({
    where: { id: membershipId },
    data: {
      status: dto.status,
      studentId: dto.studentId,
      faculty: dto.faculty,
      programme: dto.programme,
      intake: dto.intake,
      phone: dto.phone,
    },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });

  if (dto.status && dto.status !== current.status) {
    await this.audit.record({
      organizationId, actorUserId, action: 'member.status.change',
      targetType: 'Membership', targetId: membershipId,
      metadata: { from: current.status, to: dto.status },
    });
  }
  return updated;
}
```

- [ ] **Step 5: Add the route**

```typescript
import { Param, Patch } from '@nestjs/common';
import { UpdateMemberDto } from './dto/update-member.dto';
// ...
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...MANAGE_MEMBERS)
@Patch(':membershipId')
update(
  @OrgId() orgId: string,
  @Param('membershipId') membershipId: string,
  @Body() dto: UpdateMemberDto,
  @CurrentUser() user: { userId: string },
) {
  return this.members.updateMember(orgId, membershipId, dto, user.userId);
}
```

- [ ] **Step 6: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- memberships-update && npx jest && npm run test:e2e`
Expected: memberships-update 3/3 PASS; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/memberships backend/test/memberships-update.e2e-spec.ts
git commit -m "feat: update member profile + status (active/alumni)"
```

---

### Task 5: Change a member's committee role (+ history, last-President guardrail)

**Files:**
- Create: `backend/src/memberships/dto/change-role.dto.ts`
- Modify: `backend/src/memberships/memberships.service.ts`, `memberships.controller.ts`
- Test: `backend/test/memberships-role.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `MANAGE_ROLES`.
- Produces: `MembershipsService.changeRole(orgId, membershipId, newRole, actorUserId): Promise<Membership>` — org-scoped lookup (`404`); if the target is currently the **last active PRESIDENT** and `newRole !== PRESIDENT`, throw `ConflictException`; otherwise update `role`, append `{ role: <old>, until: <now> }` to `committeeHistory`, audit `member.role.change`. Route: `PATCH /organizations/:orgId/members/:membershipId/role` (`PRESIDENT`/`VICE_PRESIDENT`).

- [ ] **Step 1: Write `dto/change-role.dto.ts`**

```typescript
import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class ChangeRoleDto {
  @IsEnum(Role)
  role!: Role;
}
```

- [ ] **Step 2: Write failing e2e `backend/test/memberships-role.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Change member role (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  let otherId: string;
  const pres = `pr-${Date.now()}@test.io`;
  const other = `ot-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'R', slug: `r-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${presToken}`)).body.id;
    otherId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/members`).set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('promotes a member to VICE_PRESIDENT and records history', async () => {
    const res = await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${otherId}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'VICE_PRESIDENT' }).expect(200);
    expect(res.body.role).toBe('VICE_PRESIDENT');
    expect(Array.isArray(res.body.committeeHistory)).toBe(true);
    expect(res.body.committeeHistory[0].role).toBe('COMMITTEE');
  });

  it('refuses to demote the last PRESIDENT', async () => {
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${presMembershipId}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'COMMITTEE' }).expect(409);
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- memberships-role`
Expected: FAIL (route missing).

- [ ] **Step 4: Add `changeRole` to the service**

```typescript
import { Prisma } from '@prisma/client';

async changeRole(
  organizationId: string,
  membershipId: string,
  newRole: Role,
  actorUserId?: string,
) {
  const current = await this.prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!current) throw new NotFoundException('Membership not found in this organization');

  if (current.role === 'PRESIDENT' && newRole !== 'PRESIDENT') {
    const presidents = await this.prisma.membership.count({
      where: { organizationId, role: 'PRESIDENT', status: 'ACTIVE' },
    });
    if (presidents <= 1) {
      throw new ConflictException('Organization must have at least one president');
    }
  }

  const history = Array.isArray(current.committeeHistory)
    ? (current.committeeHistory as unknown[])
    : [];
  const nextHistory = [{ role: current.role, until: new Date().toISOString() }, ...history];

  const updated = await this.prisma.membership.update({
    where: { id: membershipId },
    data: { role: newRole, committeeHistory: nextHistory as Prisma.InputJsonValue },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  });
  await this.audit.record({
    organizationId, actorUserId, action: 'member.role.change',
    targetType: 'Membership', targetId: membershipId,
    metadata: { from: current.role, to: newRole },
  });
  return updated;
}
```

- [ ] **Step 5: Add the route**

```typescript
import { ChangeRoleDto } from './dto/change-role.dto';
import { MANAGE_ROLES } from '../rbac/role-groups';
// ...
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...MANAGE_ROLES)
@Patch(':membershipId/role')
changeRole(
  @OrgId() orgId: string,
  @Param('membershipId') membershipId: string,
  @Body() dto: ChangeRoleDto,
  @CurrentUser() user: { userId: string },
) {
  return this.members.changeRole(orgId, membershipId, dto.role, user.userId);
}
```

- [ ] **Step 6: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- memberships-role && npx jest && npm run test:e2e`
Expected: memberships-role 2/2 PASS; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/memberships backend/test/memberships-role.e2e-spec.ts
git commit -m "feat: change committee role + history + last-president guardrail"
```

---

### Task 6: Remove a member (last-President guardrail)

**Files:**
- Modify: `backend/src/memberships/memberships.service.ts`, `memberships.controller.ts`
- Test: `backend/test/memberships-remove.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `MANAGE_ROLES`.
- Produces: `MembershipsService.remove(orgId, membershipId, actorUserId): Promise<{ removed: true }>` — org-scoped lookup (`404`); if the target is the last active PRESIDENT, `ConflictException`; delete the membership; audit `member.remove`. Route: `DELETE /organizations/:orgId/members/:membershipId` (`PRESIDENT`/`VICE_PRESIDENT`). Removal is authorized at the committee level and does not delete the underlying `User` (which may belong to other orgs).

- [ ] **Step 1: Write failing e2e `backend/test/memberships-remove.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Remove member (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let presMembershipId: string;
  let otherId: string;
  const pres = `prm-${Date.now()}@test.io`;
  const other = `otm-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    for (const e of [pres, other]) {
      await request(app.getHttpServer()).post('/auth/register').send({ email: e, password: 'password123', fullName: e });
    }
    presToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: pres, password: 'password123' })).body.accessToken;
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'RM', slug: `rm-${Date.now()}` })).body.id;
    presMembershipId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${presToken}`)).body.id;
    otherId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/members`).set('Authorization', `Bearer ${presToken}`).send({ email: other, role: 'COMMITTEE' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('removes a committee member', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgId}/members/${otherId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const list = await request(app.getHttpServer()).get(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`);
    expect(list.body.map((m: { id: string }) => m.id)).not.toContain(otherId);
  });

  it('refuses to remove the last PRESIDENT', async () => {
    await request(app.getHttpServer()).delete(`/organizations/${orgId}/members/${presMembershipId}`)
      .set('Authorization', `Bearer ${presToken}`).expect(409);
  });
});
```

- [ ] **Step 2: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- memberships-remove`
Expected: FAIL (route missing).

- [ ] **Step 3: Add `remove` to the service**

```typescript
async remove(organizationId: string, membershipId: string, actorUserId?: string): Promise<{ removed: true }> {
  const current = await this.prisma.membership.findFirst({
    where: { id: membershipId, organizationId },
  });
  if (!current) throw new NotFoundException('Membership not found in this organization');

  if (current.role === 'PRESIDENT' && current.status === 'ACTIVE') {
    const presidents = await this.prisma.membership.count({
      where: { organizationId, role: 'PRESIDENT', status: 'ACTIVE' },
    });
    if (presidents <= 1) {
      throw new ConflictException('Organization must have at least one president');
    }
  }

  await this.prisma.membership.delete({ where: { id: membershipId } });
  await this.audit.record({
    organizationId, actorUserId, action: 'member.remove',
    targetType: 'Membership', targetId: membershipId,
    metadata: { userId: current.userId, role: current.role },
  });
  return { removed: true };
}
```

- [ ] **Step 4: Add the route**

```typescript
import { Delete } from '@nestjs/common';
// ...
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Roles(...MANAGE_ROLES)
@Delete(':membershipId')
remove(
  @OrgId() orgId: string,
  @Param('membershipId') membershipId: string,
  @CurrentUser() user: { userId: string },
) {
  return this.members.remove(orgId, membershipId, user.userId);
}
```

- [ ] **Step 5: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- memberships-remove && npx jest && npm run test:e2e`
Expected: memberships-remove 2/2 PASS; whole suite green.

- [ ] **Step 6: Commit**

```bash
git add backend/src/memberships backend/test/memberships-remove.e2e-spec.ts
git commit -m "feat: remove member + last-president guardrail"
```

---

### Task 7: Cross-tenant isolation test for member endpoints

**Files:**
- Test: `backend/test/memberships-isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: the full member surface from Tasks 2-6.
- Produces: proof that a President of org A cannot list, add to, update, change roles in, or remove from org B (all `403` via `TenantGuard`, since A has no membership in B).

- [ ] **Step 1: Write the isolation e2e `backend/test/memberships-isolation.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Membership tenant isolation (e2e)', () => {
  let app: INestApplication;
  let aToken: string;
  let bOrgId: string;
  let bMemberId: string;
  const a = `ia-${Date.now()}@test.io`;
  const b = `ib-${Date.now()}@test.io`;

  async function setupUserOrg(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    const token = (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`).send({ name: email, slug: `${email.split('@')[0]}-${Date.now()}` })).body.id;
    const memberId = (await request(app.getHttpServer()).get(`/organizations/${orgId}/members/me`).set('Authorization', `Bearer ${token}`)).body.id;
    return { token, orgId, memberId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const A = await setupUserOrg(a);
    const B = await setupUserOrg(b);
    aToken = A.token;
    bOrgId = B.orgId;
    bMemberId = B.memberId;
  });
  afterAll(async () => { await app.close(); });

  it('A cannot list B members', () =>
    request(app.getHttpServer()).get(`/organizations/${bOrgId}/members`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));

  it('A cannot add to B', () =>
    request(app.getHttpServer()).post(`/organizations/${bOrgId}/members`)
      .set('Authorization', `Bearer ${aToken}`).send({ email: a, role: 'COMMITTEE' }).expect(403));

  it('A cannot change roles in B', () =>
    request(app.getHttpServer()).patch(`/organizations/${bOrgId}/members/${bMemberId}/role`)
      .set('Authorization', `Bearer ${aToken}`).send({ role: 'COMMITTEE' }).expect(403));

  it('A cannot remove from B', () =>
    request(app.getHttpServer()).delete(`/organizations/${bOrgId}/members/${bMemberId}`)
      .set('Authorization', `Bearer ${aToken}`).expect(403));
});
```

- [ ] **Step 2: Run the isolation e2e**

Run: `cd backend && npm run test:e2e -- memberships-isolation`
Expected: 4/4 PASS — org A is blocked from every org-B member mutation (403 from `TenantGuard`).

- [ ] **Step 3: Run the full suite**

Run: `cd backend && npx jest && npm run test:e2e`
Expected: everything green.

- [ ] **Step 4: Commit**

```bash
git add backend/test/memberships-isolation.e2e-spec.ts
git commit -m "test: cross-tenant isolation for member endpoints"
```

---

## Self-Review Notes

- **Spec coverage:** org profile update + my-orgs (T1); list members + my membership (T2); add member (T3); update profile/status (T4); change role + history + guardrail (T5); remove + guardrail (T6); tenant-isolation proof (T7). Matches the "Organizations & Committee/RBAC mgmt" roadmap item.
- **Permission tiers** are centralized in `role-groups.ts` (DRY) and applied via `@Roles(...GROUP)` — MANAGE_MEMBERS vs MANAGE_ROLES vs VIEW_MEMBERS used consistently across tasks.
- **Isolation:** every member query is org-scoped; the tenant-scope middleware forces `organizationId` on `findMany`/`findFirst`/`count`; `updateMember`/`changeRole`/`remove` all do an org-scoped `findFirst` before mutating by id. T7 proves org A cannot touch org B.
- **Last-President guardrail** enforced in both `changeRole` and `remove`; tested in T5 + T6.
- **Audit + PDPA:** sensitive actions audited with ids/roles only — no personal data in metadata.
- **No placeholders:** every step has full code, commands, and expected output. Types (`MANAGE_MEMBERS`, `AddMemberDto`, `updateMember`, `changeRole`, `remove`) are consistent across tasks.
- **YAGNI:** no email-invite flow, no bulk import, no soft-delete of memberships — deferred to later phases.
