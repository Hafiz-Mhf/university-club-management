# Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /organizations/:orgId/audit-logs`, a paginated/filterable committee-facing query endpoint over the existing `AuditLog` table — Phase 1 roadmap item 10 (read side only; break-glass alerting is explicitly deferred per the design spec).

**Architecture:** Extend the existing `AuditService` (already global, already used everywhere for writes) with a `list()` read method, and add one new controller to the existing `AuditModule`. No new module, no new Prisma model, no new audit action.

**Tech Stack:** NestJS, Prisma, PostgreSQL — matches every existing module. No new dependencies.

## Global Constraints

- Route: `GET /organizations/:orgId/audit-logs`, guard chain `JwtAuthGuard → TenantGuard → RolesGuard`, `@Roles(...MANAGE_MEMBERS)` (imported from `../rbac/role-groups` — **not** `MANAGE_EVENTS**, this is the narrower tier: President, VP, Secretary, Treasurer, Event Director — Committee is excluded).
- `AuditLog` is already in `TENANT_SCOPED_MODELS`; every query is `organizationId`-scoped.
- Query params (all optional, raw `@Query('x')` strings — no DTO class, matching `MembershipsController.list`'s existing convention): `action` (exact match), `actorUserId` (exact match), `from`/`to` (ISO8601, filters `createdAt`; unparseable → `400`), `page` (default 1), `pageSize` (default 25, clamped to `[1, 100]`).
- Response: `{ data: AuditLogEntry[], total: number, page: number, pageSize: number }`. `data` rows select exactly: `id, organizationId, actorUserId, action, targetType, targetId, metadata, isBreakGlass, createdAt` — `ipAddress`/`userAgent` excluded (always-null dead columns; `AuditService`'s own `AuditEntry` interface doesn't accept either field). `orderBy: { createdAt: 'desc' }`.
- No new audit action — viewing the log is not itself audited (matches `GET /certificates` and `GET /dashboard` precedent).
- No unit tests for the new service method — a single scoped `findMany`/`count` pair, matching this codebase's precedent of proving pure read logic at the e2e layer only.
- Spec: `docs/superpowers/specs/2026-07-13-audit-logs-design.md` (read this first for full rationale — this plan implements it verbatim).

---

### Task 1: Audit log read endpoint

**Files:**
- Modify: `backend/src/audit/audit.service.ts`
- Create: `backend/src/audit/audit-log.controller.ts`
- Modify: `backend/src/audit/audit.module.ts`
- Test: `backend/test/audit-logs.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (already injected in `AuditService`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`MANAGE_MEMBERS` — same imports as `backend/src/memberships/memberships.controller.ts`.
- Produces: `AuditService.list(organizationId: string, filters: AuditListFilters): Promise<{ data: AuditLogEntry[]; total: number; page: number; pageSize: number }>` where `AuditListFilters = { action?: string; actorUserId?: string; from?: string; to?: string; page?: string; pageSize?: string }`.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/audit-logs.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Audit log query (e2e)', () => {
  let app: INestApplication;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  describe('happy path', () => {
    let orgId: string;
    let presToken: string;
    let midpoint: string;

    beforeAll(async () => {
      presToken = await registerAndLogin(`audit-pres-${Date.now()}@test.io`);
      orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'AuditOrg', slug: `auditorg-${Date.now()}` })).body.id;

      // Batch 1: event.create + event.publish
      const eventA = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Event A', startAt: future(5), endAt: future(6) }).expect(201);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventA.body.id}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      await wait(50);
      midpoint = new Date().toISOString();
      await wait(50);

      // Batch 2: event.create + registration.create
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Event B', startAt: future(5), endAt: future(6) }).expect(201);

      const partToken = await registerAndLogin(`audit-part-${Date.now()}@test.io`);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventA.body.id}/registrations`)
        .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);
    });

    it('returns all 4 rows, newest first, with default pagination', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.total).toBe(4);
      expect(res.body.page).toBe(1);
      expect(res.body.pageSize).toBe(25);
      expect(res.body.data).toHaveLength(4);
      expect(res.body.data[0].action).toBe('registration.create');
      expect(res.body.data[3].action).toBe('event.create');
      expect(res.body.data[0].metadata).not.toBeNull();
      expect(typeof res.body.data[0].metadata).toBe('object');
    });

    it('filters by action', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?action=event.create`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((r: { action: string }) => r.action === 'event.create')).toBe(true);
    });

    it('filters by from/to date range', async () => {
      const afterRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?from=${encodeURIComponent(midpoint)}`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(afterRes.body.total).toBe(2);
      expect(afterRes.body.data.map((r: { action: string }) => r.action).sort()).toEqual(['event.create', 'registration.create']);

      const beforeRes = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?to=${encodeURIComponent(midpoint)}`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      expect(beforeRes.body.total).toBe(2);
      expect(beforeRes.body.data.map((r: { action: string }) => r.action).sort()).toEqual(['event.create', 'event.publish']);
    });

    it('rejects an invalid "from" date with 400', async () => {
      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?from=not-a-date`)
        .set('Authorization', `Bearer ${presToken}`).expect(400);
    });

    it('paginates correctly across two pages with a small pageSize', async () => {
      const page1 = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?page=1&pageSize=2`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      const page2 = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs?page=2&pageSize=2`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(page1.body.total).toBe(4);
      expect(page2.body.total).toBe(4);
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);
      const page1Ids = page1.body.data.map((r: { id: string }) => r.id);
      const page2Ids = page2.body.data.map((r: { id: string }) => r.id);
      expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
    });

    it('a COMMITTEE-tier member cannot view the audit log (403)', async () => {
      const committeeEmail = `audit-committee-${Date.now()}@test.io`;
      const committeeToken = await registerAndLogin(committeeEmail);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ email: committeeEmail, role: 'COMMITTEE' }).expect(201);

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${committeeToken}`).expect(403);
    });
  });

  it('cross-org isolation: org B president cannot view org A audit log (403)', async () => {
    const presAToken = await registerAndLogin(`audit-isoa-${Date.now()}@test.io`);
    const orgAId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presAToken}`)
      .send({ name: 'AuditIsoA', slug: `auditisoa-${Date.now()}` })).body.id;

    const presBToken = await registerAndLogin(`audit-isob-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presBToken}`)
      .send({ name: 'AuditIsoB', slug: `auditisob-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/audit-logs`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the suite to confirm it fails**

From `backend/`:

```bash
npx jest --config test/jest-e2e.json audit-logs
```

Expected: every request to `GET /organizations/:orgId/audit-logs` returns `404` (route doesn't exist yet) — all tests FAIL. If any test fails for a different reason (e.g. a setup request like event/registration/member creation itself failing), stop and fix the test file before continuing; the only expected failure source at this point is the missing route.

- [ ] **Step 3: Add `AuditService.list()`**

Modify `backend/src/audit/audit.service.ts` — add the new interface and method (keep the existing `AuditEntry` interface and `record()` method unchanged):

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  isBreakGlass?: boolean;
}

export interface AuditListFilters {
  action?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  page?: string;
  pageSize?: string;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata as any,
        isBreakGlass: entry.isBreakGlass ?? false,
      },
    });
  }

  async list(organizationId: string, filters: AuditListFilters) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) {
      const parsedFrom = new Date(filters.from);
      if (isNaN(parsedFrom.getTime())) throw new BadRequestException('Invalid "from" date');
      createdAt.gte = parsedFrom;
    }
    if (filters.to) {
      const parsedTo = new Date(filters.to);
      if (isNaN(parsedTo.getTime())) throw new BadRequestException('Invalid "to" date');
      createdAt.lte = parsedTo;
    }

    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(filters.pageSize) || DEFAULT_PAGE_SIZE));

    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(filters.action && { action: filters.action }),
      ...(filters.actorUserId && { actorUserId: filters.actorUserId }),
      ...(Object.keys(createdAt).length > 0 && { createdAt }),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          organizationId: true,
          actorUserId: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          isBreakGlass: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }
}
```

- [ ] **Step 4: Create `AuditLogController`**

Create `backend/src/audit/audit-log.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_MEMBERS } from '../rbac/role-groups';

@Controller('organizations/:orgId/audit-logs')
export class AuditLogController {
  constructor(private readonly audit: AuditService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_MEMBERS)
  @Get()
  list(
    @OrgId() orgId: string,
    @Query('action') action?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.audit.list(orgId, { action, actorUserId, from, to, page, pageSize });
  }
}
```

- [ ] **Step 5: Wire `AuditLogController` into `AuditModule`**

Modify `backend/src/audit/audit.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditLogController } from './audit-log.controller';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

No `app.module.ts` change is needed — `AuditModule` is already imported there.

- [ ] **Step 6: Run the audit-logs e2e suite to confirm it passes**

From `backend/`:

```bash
npx jest --config test/jest-e2e.json audit-logs
```

Expected: `Tests: 7 passed, 7 total` (6 tests inside the `happy path` describe block — default list, action filter, date-range filter, invalid date 400, pagination, RBAC — plus the 1 top-level cross-org isolation test). Count the `it(...)` blocks in the file and confirm the number matches.

- [ ] **Step 7: Run the full unit and e2e suites**

```bash
npx jest
npx jest --config test/jest-e2e.json
```

Expected: unit `Tests: 40 passed, 40 total` (no unit tests added this task — `AuditService.list()` is proven at the e2e layer only, matching this codebase's precedent for pure read methods); e2e all passing (161 committed baseline + 7 new audit-logs = 168 committed, 169 with the user's untracked `zzz-concurrency-probe.e2e-spec.ts`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/audit backend/test/audit-logs.e2e-spec.ts
git commit -m "feat: audit log query endpoint"
```

---

### Task 2: Docs sync

**Files:**
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: nothing new — documents Task 1's shipped behavior.
- Produces: no code changes.

No `docs/database.md` change is needed — this feature adds no Prisma model or field.

- [ ] **Step 1: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — dashboard (shipped)` section added during the Basic Dashboard phase, and add a new `### As built — audit logs (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`). Document:

- The single route: `GET /organizations/:orgId/audit-logs`, `MANAGE_MEMBERS` only — explicitly note this is narrower than `MANAGE_EVENTS` (excludes plain Committee), matching the original planning-phase permission matrix's "View audit log" row.
- The filter/pagination query params and their defaults/clamping (`page` default 1, `pageSize` default 25 clamped to 100).
- That `metadata` is included in this response (unlike the dashboard's activity feed, which excludes it) since this is the dedicated log viewer and every audited action already follows the ids-only metadata convention.
- That break-glass alerting remains explicitly deferred — `AuditLog.isBreakGlass` stays schema-ready-but-unset, same posture as `User.mfaSecret` for MFA — pending a future `SuperAdmin`/cross-tenant access feature this codebase does not yet have.
- Update the "Permission Matrix (Phase 1)" table's `View audit log` row if it does not already reflect the shipped `MANAGE_MEMBERS` mapping (it currently reads ✅ for President/VP/Sec/Treas/EvDir, ❌ for Committee/Volunteer/Participant — confirm this still matches `MANAGE_MEMBERS` exactly and leave it as-is if so; only edit if it has drifted).

- [ ] **Step 2: Run the full unit and e2e suites one more time**

```bash
npx jest
npx jest --config test/jest-e2e.json
```

Expected: unit `Tests: 40 passed, 40 total`; e2e all passing (168 committed, 169 with the user's untracked probe).

- [ ] **Step 3: Commit**

```bash
git add docs/security.md
git commit -m "docs: sync security docs for audit logs"
```

---

## Post-plan: roadmap update

After Task 2 is committed, Phase 1 roadmap item 10 (Audit Logs) is complete. Check `docs/roadmap.md` for the next unstarted Phase 1 item (item 11 — Basic PDPA) and note it at the end of the SDD progress ledger for the next session, matching the certificate repository and dashboard phases' handoff convention.
