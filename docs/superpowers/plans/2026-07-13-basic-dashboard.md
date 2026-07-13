# Basic Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `GET /organizations/:orgId/dashboard`, a committee-facing aggregate endpoint returning KPI counts, upcoming events, pending approvals (WAITLISTED registrations), recent registrations, and an activity feed — Phase 1 roadmap item 9.

**Architecture:** One new backend module (`backend/src/dashboard/`) with a single controller route backed by a service method that runs eight org-scoped Prisma queries in parallel and assembles them into one response object. No new Prisma models, no new audit actions.

**Tech Stack:** NestJS, Prisma, PostgreSQL — matches every existing module in this backend. No new dependencies.

## Global Constraints

- Route: `GET /organizations/:orgId/dashboard`, guard chain `JwtAuthGuard → TenantGuard → RolesGuard`, `@Roles(...MANAGE_EVENTS)` (imported from `../rbac/role-groups`).
- Every query is `organizationId`-scoped. `Certificate`, `Registration`, and `AuditLog` are already in `TENANT_SCOPED_MODELS` (the Prisma tenant-scope middleware throws on an unscoped filtering read); `Event` and `Membership` are scoped by existing convention throughout this codebase.
- Every widget query uses an **explicit Prisma `select`** — never a raw spread of a full row (this follows the fix pattern from the certificate repository feature; `Registration` rows in particular carry `answers`/`consentRecordId`, which must never appear in a dashboard summary).
- KPI definitions (exact, from the design spec):
  - `activeMembers` = `Membership.count({ organizationId, status: 'ACTIVE' })`
  - `totalEvents` = `Event.count({ organizationId, status: { in: ['PUBLISHED', 'COMPLETED'] } })`
  - `activeRegistrations` = `Registration.count({ organizationId, status: { in: ['APPROVED', 'WAITLISTED'] } })`
  - `certificatesIssued` = `Certificate.count({ organizationId })`
- List widgets are fixed top-N, no pagination: upcoming events top 5 (`status: 'PUBLISHED'`, `startAt >= now`, `orderBy startAt asc`), pending approvals top 10 (`status: 'WAITLISTED'`, `orderBy createdAt asc`), recent registrations top 10 (any status, `orderBy createdAt desc`), activity feed top 15 (`orderBy createdAt desc`).
- No new audit action — this is a read-only aggregate endpoint (same precedent as `GET /certificates` list).
- No unit tests for the service — every widget is a straightforward scoped Prisma read, matching this codebase's existing precedent of proving pure read/aggregate services at the e2e layer only (`RegistrationsService.list`, `CertificatesService.list` have no unit specs either).
- Spec: `docs/superpowers/specs/2026-07-13-basic-dashboard-design.md` (read this first for full rationale — this plan implements it verbatim).

---

### Task 1: Dashboard module — service, controller, e2e suite

**Files:**
- Create: `backend/src/dashboard/dashboard.service.ts`
- Create: `backend/src/dashboard/dashboard.controller.ts`
- Create: `backend/src/dashboard/dashboard.module.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/dashboard.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`backend/src/prisma/prisma.service.ts`, globally provided by `PrismaModule`), `JwtAuthGuard`/`TenantGuard`/`RolesGuard`/`Roles`/`OrgId`/`MANAGE_EVENTS` — all existing, same imports as `backend/src/certificates/certificates.controller.ts`.
- Produces: `DashboardService.getSummary(organizationId: string): Promise<DashboardSummary>` where `DashboardSummary` is the response shape below. `DashboardModule` exported for `AppModule` wiring — no other module needs to import it.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/dashboard.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Dashboard summary (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock certificate content\n');

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  describe('happy path', () => {
    let orgId: string;
    let presToken: string;
    let eventPubId: string;
    let participant1Id: string;
    let participant2Id: string;

    beforeAll(async () => {
      presToken = await registerAndLogin(`dash-pres-${Date.now()}@test.io`);
      orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
        .send({ name: 'DashOrg', slug: `dashorg-${Date.now()}` })).body.id;

      // DRAFT event — excluded from totalEvents and upcomingEvents
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Draft Event', startAt: future(10), endAt: future(11) }).expect(201);

      // PUBLISHED event, capacity 1 — drives the WAITLISTED registration
      const eventPub = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Published Event', startAt: future(5), endAt: future(6), capacity: 1 }).expect(201);
      eventPubId = eventPub.body.id;
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      // A second event, published then completed — counts toward totalEvents,
      // excluded from upcomingEvents once no longer PUBLISHED
      const eventCompleted = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ title: 'Completed Event', startAt: future(2), endAt: future(3) }).expect(201);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventCompleted.body.id}/publish`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventCompleted.body.id}/complete`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      const p1Email = `dash-p1-${Date.now()}@test.io`;
      const p1Token = await registerAndLogin(p1Email);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${p1Token}`).send({}).expect(201);
      participant1Id = (await prisma.user.findUnique({ where: { email: p1Email } }))!.id;

      const p2Email = `dash-p2-${Date.now()}@test.io`;
      const p2Token = await registerAndLogin(p2Email);
      await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${p2Token}`).send({}).expect(201);
      participant2Id = (await prisma.user.findUnique({ where: { email: p2Email } }))!.id;

      // Mark participant1 PRESENT so a certificate can be issued to them
      const mine = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/events/${eventPubId}/attendance/me`)
        .set('Authorization', `Bearer ${p1Token}`).expect(200);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/attendance/scan`)
        .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);

      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/certificates`)
        .set('Authorization', `Bearer ${presToken}`)
        .field('userId', participant1Id)
        .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
        .expect(201);

      // A fourth member, added then moved to ALUMNI — proves activeMembers
      // excludes non-ACTIVE members
      const alumniEmail = `dash-alumni-${Date.now()}@test.io`;
      await registerAndLogin(alumniEmail);
      const added = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ email: alumniEmail, role: 'PARTICIPANT' }).expect(201);
      await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${added.body.id}`)
        .set('Authorization', `Bearer ${presToken}`)
        .send({ status: 'ALUMNI' }).expect(200);
    });

    it('returns exact KPI counts', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.kpis).toEqual({
        activeMembers: 3, totalEvents: 2, activeRegistrations: 2, certificatesIssued: 1,
      });
    });

    it('upcomingEvents contains only the PUBLISHED future event, with a raw registration count', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.upcomingEvents).toHaveLength(1);
      expect(res.body.upcomingEvents[0]).toMatchObject({
        id: eventPubId, title: 'Published Event', registrationCount: 2,
      });
    });

    it('pendingApprovals contains only the WAITLISTED registration', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.pendingApprovals).toHaveLength(1);
      expect(res.body.pendingApprovals[0]).toMatchObject({
        eventId: eventPubId, eventTitle: 'Published Event', userId: participant2Id,
      });
    });

    it('recentRegistrations contains both registrations, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      expect(res.body.recentRegistrations).toHaveLength(2);
      expect(res.body.recentRegistrations[0].userId).toBe(participant2Id);
      expect(res.body.recentRegistrations[1].userId).toBe(participant1Id);
    });

    it('activityFeed reflects every audited action in this org, newest first', async () => {
      const res = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${presToken}`).expect(200);

      // 12 audited actions occur in this org during setup: 3x event.create,
      // 2x event.publish, 1x event.complete, 2x registration.create,
      // 1x attendance.scan, 1x certificate.upload, 1x member.add,
      // 1x member.status.change. All fit under the top-15 limit.
      expect(res.body.activityFeed).toHaveLength(12);
      expect(res.body.activityFeed[0].action).toBe('member.status.change');
      const timestamps = res.body.activityFeed.map((a: { createdAt: string }) => new Date(a.createdAt).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
      }
    });

    it('a plain PARTICIPANT cannot view the dashboard (403)', async () => {
      const partToken = await registerAndLogin(`dash-part-${Date.now()}@test.io`);
      await request(app.getHttpServer())
        .post(`/organizations/${orgId}/events/${eventPubId}/registrations`)
        .set('Authorization', `Bearer ${partToken}`).send({}).expect(201);

      await request(app.getHttpServer())
        .get(`/organizations/${orgId}/dashboard`)
        .set('Authorization', `Bearer ${partToken}`).expect(403);
    });
  });

  it('an org with just its president returns activeMembers:1, every other KPI 0, all arrays empty', async () => {
    const presToken = await registerAndLogin(`dash-empty-${Date.now()}@test.io`);
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'EmptyDashOrg', slug: `emptydashorg-${Date.now()}` })).body.id;

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/dashboard`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.kpis).toEqual({ activeMembers: 1, totalEvents: 0, activeRegistrations: 0, certificatesIssued: 0 });
    expect(res.body.upcomingEvents).toEqual([]);
    expect(res.body.pendingApprovals).toEqual([]);
    expect(res.body.recentRegistrations).toEqual([]);
    expect(res.body.activityFeed).toEqual([]);
  });

  it('cross-org isolation: org B committee cannot view org A dashboard (403)', async () => {
    const presAToken = await registerAndLogin(`dash-isoa-${Date.now()}@test.io`);
    const orgAId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presAToken}`)
      .send({ name: 'DashIsoA', slug: `dashisoa-${Date.now()}` })).body.id;

    const presBToken = await registerAndLogin(`dash-isob-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presBToken}`)
      .send({ name: 'DashIsoB', slug: `dashisob-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgAId}/dashboard`)
      .set('Authorization', `Bearer ${presBToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the suite to confirm it fails**

From `backend/`:

```bash
npx jest --config test/jest-e2e.json dashboard
```

Expected: every request to `GET /organizations/:orgId/dashboard` returns `404` (route doesn't exist yet) — all tests FAIL. If any test fails for a different reason (e.g. a 500, or a helper request like event/registration/attendance/certificate setup itself failing), stop and fix the test file before continuing; the only expected failure source at this point is the missing dashboard route.

- [ ] **Step 3: Create `DashboardService`**

Create `backend/src/dashboard/dashboard.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const UPCOMING_EVENTS_LIMIT = 5;
const PENDING_APPROVALS_LIMIT = 10;
const RECENT_REGISTRATIONS_LIMIT = 10;
const ACTIVITY_FEED_LIMIT = 15;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(organizationId: string) {
    const [
      activeMembers,
      totalEvents,
      activeRegistrations,
      certificatesIssued,
      upcomingEventsRaw,
      pendingApprovalsRaw,
      recentRegistrationsRaw,
      activityFeed,
    ] = await Promise.all([
      this.prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.event.count({ where: { organizationId, status: { in: ['PUBLISHED', 'COMPLETED'] } } }),
      this.prisma.registration.count({ where: { organizationId, status: { in: ['APPROVED', 'WAITLISTED'] } } }),
      this.prisma.certificate.count({ where: { organizationId } }),
      this.prisma.event.findMany({
        where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
        select: {
          id: true,
          title: true,
          startAt: true,
          venue: true,
          _count: { select: { registrations: true } },
        },
        orderBy: { startAt: 'asc' },
        take: UPCOMING_EVENTS_LIMIT,
      }),
      this.prisma.registration.findMany({
        where: { organizationId, status: 'WAITLISTED' },
        select: {
          id: true,
          eventId: true,
          userId: true,
          createdAt: true,
          event: { select: { title: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: PENDING_APPROVALS_LIMIT,
      }),
      this.prisma.registration.findMany({
        where: { organizationId },
        select: {
          id: true,
          eventId: true,
          userId: true,
          status: true,
          createdAt: true,
          event: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: RECENT_REGISTRATIONS_LIMIT,
      }),
      this.prisma.auditLog.findMany({
        where: { organizationId },
        select: {
          id: true,
          action: true,
          targetType: true,
          targetId: true,
          actorUserId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_FEED_LIMIT,
      }),
    ]);

    return {
      kpis: { activeMembers, totalEvents, activeRegistrations, certificatesIssued },
      upcomingEvents: upcomingEventsRaw.map((e) => ({
        id: e.id,
        title: e.title,
        startAt: e.startAt,
        venue: e.venue,
        registrationCount: e._count.registrations,
      })),
      pendingApprovals: pendingApprovalsRaw.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventTitle: r.event.title,
        userId: r.userId,
        createdAt: r.createdAt,
      })),
      recentRegistrations: recentRegistrationsRaw.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventTitle: r.event.title,
        userId: r.userId,
        status: r.status,
        createdAt: r.createdAt,
      })),
      activityFeed,
    };
  }
}
```

- [ ] **Step 4: Create `DashboardController`**

Create `backend/src/dashboard/dashboard.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get()
  getSummary(@OrgId() orgId: string) {
    return this.dashboard.getSummary(orgId);
  }
}
```

- [ ] **Step 5: Create `DashboardModule`**

Create `backend/src/dashboard/dashboard.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 6: Wire `DashboardModule` into `AppModule`**

Modify `backend/src/app.module.ts` — add the import and register it in the `imports` array, after `CertificatesModule`:

```ts
import { CertificatesModule } from './certificates/certificates.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    EventsModule,
    RegistrationsModule,
    AttendanceModule,
    CertificatesModule,
    DashboardModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Run the dashboard e2e suite to confirm it passes**

From `backend/`:

```bash
npx jest --config test/jest-e2e.json dashboard
```

Expected: `Tests: 8 passed, 8 total` (6 tests inside the `happy path` describe block — KPIs, upcomingEvents, pendingApprovals, recentRegistrations, activityFeed, plain-PARTICIPANT-403 — plus the 2 top-level tests: empty-org and cross-org isolation). Count the `it(...)` blocks in the file and confirm the number matches.

- [ ] **Step 8: Run the full unit and e2e suites**

```bash
npx jest
npx jest --config test/jest-e2e.json
```

Expected: unit `Tests: 40 passed, 40 total` (no unit tests added this task); e2e all passing (154 baseline + 8 new dashboard = 162 committed, 163 with the user's untracked `zzz-concurrency-probe.e2e-spec.ts`).

- [ ] **Step 9: Commit**

```bash
git add backend/src/dashboard backend/src/app.module.ts backend/test/dashboard.e2e-spec.ts
git commit -m "feat: dashboard summary endpoint"
```

---

### Task 2: Docs sync

**Files:**
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: nothing new — documents Task 1's shipped behavior.
- Produces: no code changes.

No `docs/database.md` change is needed — this feature adds no Prisma model.

- [ ] **Step 1: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — certificates (shipped)` section added during the certificate repository phase, and add a new `### As built — dashboard (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`). Document:

- The single route: `GET /organizations/:orgId/dashboard`, `MANAGE_EVENTS` only (no participant-facing variant).
- The four KPI definitions verbatim from the design spec (`activeMembers`, `totalEvents`, `totalEvents` status filter, `activeRegistrations` status filter, `certificatesIssued`).
- That "pending approvals" maps to `WAITLISTED` registrations specifically — `RegistrationStatus.PENDING` remains unused, this endpoint does not introduce a new approval gate.
- Fixed top-N list widgets (5/10/10/15), no pagination — explicit scope decision, not an oversight.
- Explicit-`select` discipline on every widget query (no raw row spreads), same convention as the certificates fix.
- No new audit action — read-only aggregate endpoint.

- [ ] **Step 2: Run the full unit and e2e suites one more time**

```bash
npx jest
npx jest --config test/jest-e2e.json
```

Expected: unit `Tests: 40 passed, 40 total`; e2e all passing (162 committed, 163 with the user's untracked probe).

- [ ] **Step 3: Commit**

```bash
git add docs/security.md
git commit -m "docs: sync security docs for basic dashboard"
```

---

## Post-plan: roadmap update

After Task 2 is committed, Phase 1 roadmap item 9 (Basic Dashboard) is complete. Check `docs/roadmap.md` for the next unstarted Phase 1 item (item 10 — Audit Logs) and note it at the end of the SDD progress ledger for the next session, matching the certificate repository phase's handoff convention.
