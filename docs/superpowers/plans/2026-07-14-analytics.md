# Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five read-only analytics endpoints (attendance rate, registration/member-growth trends, faculty/programme demographics, certificate issuance vs. downloads, committee activity) plus the one small write path (`CertificateDownload` tracking) they depend on.

**Architecture:** A new `AnalyticsModule` (`backend/src/analytics/`) mirrors `DashboardModule`'s shape — one controller, one service, no DTOs, raw `@Query` params. `CertificatesService` gains a tracked write on every signed-URL issuance. All five routes are org-scoped behind the existing guard chain.

**Tech Stack:** NestJS, Prisma (PostgreSQL), no new dependencies.

## Global Constraints

- Every route: `JwtAuthGuard → TenantGuard → RolesGuard`, `@Roles(...MANAGE_EVENTS)` (President, Vice President, Secretary, Treasurer, Event Director, Committee) — same tier as the existing Dashboard endpoint.
- `days` query param (used by `trends` and `committee-activity`): optional, default `30`, non-numeric/non-positive silently defaults to `30` (never `400`s), clamped to `[1, 365]`.
- `CertificateDownload` is **not** added to `TENANT_SCOPED_MODELS` in `backend/src/prisma/tenant-scope.middleware.ts` — do not modify that file. It's queried through a `certificate: { organizationId }` relation filter, and written by known `certificateId` (`create`, not a scoped list action).
- Demographics endpoint returns aggregate counts only — never a member list, never any field alongside `faculty`/`programme` that could re-identify a person.
- No new audit action — all five reads are unaudited (same precedent as `GET /dashboard`); the one write (`CertificateDownload` insert) is a metrics row, not an audit entry.
- Follow this codebase's per-method `@UseGuards`/`@Roles` convention (repeated on every route, not hoisted to class level) — matches every existing multi-route controller (`certificates.controller.ts`, `attendance.controller.ts`, `memberships.controller.ts`).
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.

---

### Task 1: CertificateDownload schema + certificate-download tracking

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Migration: `backend/prisma/migrations/**` (generated)
- Modify: `backend/src/certificates/certificates.service.ts`
- Modify: `backend/src/certificates/certificates.controller.ts`
- Modify: `backend/test/certificates-list-download.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new — extends the existing `CertificatesService`/`CertificatesController` from the Certificate Repository phase.
- Produces: `CertificateDownload` Prisma model (fields `id`, `certificateId`, `userId`, `downloadedAt`), reachable via `prisma.certificateDownload.*` and `Certificate.downloads`. `CertificatesService.download()` gains a new required parameter `actorUserId: string` (signature becomes `download(organizationId: string, eventId: string, certificateId: string, actorUserId: string)`) — Task 2's analytics endpoints don't call this method directly, but any future caller must pass it.

- [ ] **Step 1: Add the model to `schema.prisma`**

Open `backend/prisma/schema.prisma`. Add this model directly after the `Certificate` model (before `ConsentRecord`):

```prisma
model CertificateDownload {
  id            String      @id @default(uuid())
  certificateId String
  certificate   Certificate @relation(fields: [certificateId], references: [id])
  userId        String
  downloadedAt  DateTime    @default(now())

  @@index([certificateId])
}
```

Then add one field to the existing `Certificate` model (in the block of relation fields, e.g. right after `user User @relation(...)`):

```prisma
  downloads        CertificateDownload[]
```

- [ ] **Step 2: Generate and run the migration**

```bash
cd backend && npx prisma migrate dev --name add_certificate_download_model
```

Expected: migration applies cleanly, Prisma Client regenerates with a `certificateDownload` delegate. Confirm with:

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid.`

- [ ] **Step 3: Write the failing e2e assertions**

Open `backend/test/certificates-list-download.e2e-spec.ts`. Add these two tests at the end of the `describe` block, right before the final closing `});`:

```ts
  it('GET /me records a CertificateDownload row', async () => {
    const { token, userId } = await presentParticipant();
    const bytes = Buffer.from('%PDF-1.4\n%tracking me bytes\n');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', bytes, { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);

    const downloads = await prisma.certificateDownload.findMany({ where: { certificateId: res.body.id, userId } });
    expect(downloads).toHaveLength(1);
  });

  it('committee download-by-id records a CertificateDownload row attributed to the committee actor', async () => {
    const { userId } = await presentParticipant();
    const bytes = Buffer.from('%PDF-1.4\n%tracking committee bytes\n');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', bytes, { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    const certId = list.body.find((c: { userId: string }) => c.userId === userId).id;

    const presUserId = (await prisma.user.findUnique({ where: { email: pres } }))!.id;

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const downloads = await prisma.certificateDownload.findMany({ where: { certificateId: certId } });
    expect(downloads).toHaveLength(1);
    expect(downloads[0].userId).toBe(presUserId);
  });
```

- [ ] **Step 4: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificates-list-download
```

Expected: the two new tests FAIL — `downloads` is an empty array (`toHaveLength(1)` fails), because nothing writes to `CertificateDownload` yet.

- [ ] **Step 5: Add tracking to `CertificatesService`**

In `backend/src/certificates/certificates.service.ts`, add a `Logger` import and instance, then a private tracking helper, and call it from both `findMine` and `download`. Replace the top of the file and the two methods:

```ts
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = 'application/pdf';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 300;

type UploadedFile = { mimetype: string; size: number; buffer: Buffer };

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}
```

Replace `findMine` and `download` with:

```ts
  async findMine(organizationId: string, eventId: string, userId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { eventId, organizationId, userId } });
    if (!certificate) throw new NotFoundException('No certificate found');
    const downloadUrl = await this.storage.getSignedDownloadUrl(certificate.storageKey, SIGNED_URL_TTL_SECONDS);
    await this.trackDownload(certificate.id, userId);
    return { ...certificate, downloadUrl };
  }

  async download(organizationId: string, eventId: string, certificateId: string, actorUserId: string) {
    const certificate = await this.prisma.certificate.findFirst({ where: { id: certificateId, organizationId, eventId } });
    if (!certificate) throw new NotFoundException('Certificate not found in this event');
    const downloadUrl = await this.storage.getSignedDownloadUrl(certificate.storageKey, SIGNED_URL_TTL_SECONDS);
    await this.trackDownload(certificate.id, actorUserId);
    return { ...certificate, downloadUrl };
  }

  // Best-effort: a signed URL has already been minted and handed to the
  // caller by the time this runs. A tracking-write hiccup must never turn
  // a successful download into a 500.
  private async trackDownload(certificateId: string, userId: string) {
    try {
      await this.prisma.certificateDownload.create({ data: { certificateId, userId } });
    } catch (error) {
      this.logger.warn(`Failed to record certificate download (certificateId=${certificateId}): ${error}`);
    }
  }
```

(Leave `upload`, `list`, and `remove` unchanged.)

- [ ] **Step 6: Wire `actorUserId` through the controller**

In `backend/src/certificates/certificates.controller.ts`, update the `download` handler to accept and pass the current user:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get(':certificateId/download')
  download(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Param('certificateId') certificateId: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.certificates.download(orgId, eventId, certificateId, user.userId);
  }
```

(`CurrentUser` is already imported in this file for the `upload` and `remove` handlers.)

- [ ] **Step 7: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificates-list-download
```

Expected: all tests in the file PASS, including the two new ones.

- [ ] **Step 8: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `Tests: 40 passed, 40 total` (unaffected — this task adds no unit tests, matching this codebase's precedent of testing `CertificatesService` at the e2e layer only); e2e `180 passed` committed (178 baseline from the PDPA phase + the 2 new tests added to `certificates-list-download.e2e-spec.ts` in this task; the untracked `zzz-concurrency-probe.e2e-spec.ts` continues to pass if its own `consent: true` fix from the PDPA phase is in place — if it still lacks that field, it will fail by design, out of scope for this task).

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/certificates/certificates.service.ts backend/src/certificates/certificates.controller.ts backend/test/certificates-list-download.e2e-spec.ts
git commit -m "feat: track certificate downloads (CertificateDownload)"
```

---

### Task 2: AnalyticsModule scaffold + overview + certificates endpoints

**Files:**
- Create: `backend/src/analytics/analytics.module.ts`
- Create: `backend/src/analytics/analytics.controller.ts`
- Create: `backend/src/analytics/analytics.service.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/analytics-overview.e2e-spec.ts`
- Test: `backend/test/analytics-certificates.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (`backend/src/prisma/prisma.service.ts`); `JwtAuthGuard`, `TenantGuard`, `RolesGuard`, `Roles`, `OrgId`, `MANAGE_EVENTS` (all pre-existing, same imports as `DashboardController`); Task 1's `CertificateDownload` model.
- Produces: `AnalyticsService.getOverview(organizationId: string): Promise<{ attendanceRate: number | null }>`; `AnalyticsService.getCertificates(organizationId: string): Promise<{ issued: number; downloaded: number }>`. Routes `GET /organizations/:orgId/analytics/overview` and `GET /organizations/:orgId/analytics/certificates`. Tasks 3 and 4 add more methods to `AnalyticsService` and more routes to `AnalyticsController` in these same two files.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/analytics-overview.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics overview (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-ov-${Date.now()}@test.io`;
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
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnOvOrg', slug: `an-ov-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Overview Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('returns null attendanceRate for a fresh org with no resolved attendance', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.attendanceRate).toBeNull();
  });

  it('computes attendanceRate as PRESENT / (PRESENT + ABSENT), excluding still-REGISTERED rows', async () => {
    // Participant A: scanned PRESENT.
    const tokenA = await registerAndLogin(`ov-a-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const mineA = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mineA.body.token }).expect(200);

    // Participant B: marked ABSENT.
    const tokenB = await registerAndLogin(`ov-b-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);
    const mineB = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${tokenB}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/${mineB.body.id}/absent`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Participant C: registered, still REGISTERED (excluded from the ratio).
    const tokenC = await registerAndLogin(`ov-c-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenC}`).send({}).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.attendanceRate).toBe(0.5);
  });

  it('a plain participant cannot view analytics (403)', async () => {
    const token = await registerAndLogin(`ov-p-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A overview (403)', async () => {
    const otherPresToken = await registerAndLogin(`ov-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnOvOtherOrg', slug: `an-ov-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/overview`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

Create `backend/test/analytics-certificates.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Analytics certificates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-cert-${Date.now()}@test.io`;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const pdfBytes = () => Buffer.from('%PDF-1.4\n%mock certificate content\n');

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnCertOrg', slug: `an-cert-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cert Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  async function presentParticipant() {
    const email = `pp-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    const user = await prisma.user.findUnique({ where: { email } });
    return { token, userId: user!.id };
  }

  it('counts issued certificates and total download activity (repeats count)', async () => {
    const { userId } = await presentParticipant();
    const upload = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    const certId = upload.body.id;

    // Two committee downloads of the same certificate.
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).get(`/organizations/${orgId}/events/${eventId}/certificates/${certId}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/certificates`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.issued).toBe(1);
    expect(res.body.downloaded).toBe(2);
  });

  it('cross-org isolation: org B president cannot view org A certificate analytics (403)', async () => {
    const otherPresToken = await registerAndLogin(`ancert-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnCertOtherOrg', slug: `an-cert-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/certificates`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run both new e2e files to verify they fail**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-overview analytics-certificates
```

Expected: FAIL — `Cannot GET /organizations/:orgId/analytics/overview` (404), no `AnalyticsModule` exists yet.

- [ ] **Step 3: Create `AnalyticsService`**

Create `backend/src/analytics/analytics.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string) {
    const [present, absent] = await Promise.all([
      this.prisma.attendance.count({ where: { organizationId, status: 'PRESENT' } }),
      this.prisma.attendance.count({ where: { organizationId, status: 'ABSENT' } }),
    ]);
    const resolved = present + absent;
    return { attendanceRate: resolved === 0 ? null : present / resolved };
  }

  async getCertificates(organizationId: string) {
    const [issued, downloaded] = await Promise.all([
      this.prisma.certificate.count({ where: { organizationId } }),
      this.prisma.certificateDownload.count({ where: { certificate: { organizationId } } }),
    ]);
    return { issued, downloaded };
  }
}
```

- [ ] **Step 4: Create `AnalyticsController`**

Create `backend/src/analytics/analytics.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('overview')
  getOverview(@OrgId() orgId: string) {
    return this.analytics.getOverview(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('certificates')
  getCertificates(@OrgId() orgId: string) {
    return this.analytics.getCertificates(orgId);
  }
}
```

- [ ] **Step 5: Create `AnalyticsModule`**

Create `backend/src/analytics/analytics.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 6: Register the module**

In `backend/src/app.module.ts`, add the import and list entry:

```ts
import { AnalyticsModule } from './analytics/analytics.module';
```

Add `AnalyticsModule` to the `imports` array, after `PdpaModule`:

```ts
    PdpaModule,
    AnalyticsModule,
```

- [ ] **Step 7: Run the two e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-overview analytics-certificates
```

Expected: all tests PASS.

- [ ] **Step 8: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `186 passed` committed (180 from Task 1 + 6 new: 4 in `analytics-overview.e2e-spec.ts` + 2 in `analytics-certificates.e2e-spec.ts`).

- [ ] **Step 9: Commit**

```bash
git add backend/src/analytics backend/src/app.module.ts backend/test/analytics-overview.e2e-spec.ts backend/test/analytics-certificates.e2e-spec.ts
git commit -m "feat: analytics overview and certificates endpoints"
```

---

### Task 3: Trends endpoint (registration trend + member growth)

**Files:**
- Create: `backend/src/analytics/date-window.util.ts`
- Modify: `backend/src/analytics/analytics.service.ts`
- Modify: `backend/src/analytics/analytics.controller.ts`
- Test: `backend/test/analytics-trends.e2e-spec.ts`

**Interfaces:**
- Consumes: `AnalyticsService`/`AnalyticsController` from Task 2 (same files, extended in place).
- Produces: `parseDaysParam(raw: string | undefined): number`, `windowStart(days: number): Date`, `dayRange(days: number): string[]`, `dateKey(date: Date): string` — exported from `date-window.util.ts`. Task 4's `committee-activity` endpoint reuses `parseDaysParam` and `windowStart` from this same file. `AnalyticsService.getTrends(organizationId: string, days: number): Promise<{ registrationTrend: Array<{ date: string; count: number }>; memberGrowth: Array<{ date: string; cumulativeActive: number }> }>`. Route `GET /organizations/:orgId/analytics/trends?days=`.

- [ ] **Step 1: Create the date-window utility**

Create `backend/src/analytics/date-window.util.ts`:

```ts
const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

// Non-numeric/non-positive silently defaults to 30 — this is a reporting
// window, not a security-sensitive filter, so a bad value degrading to the
// default (rather than 400ing) is the right tradeoff.
export function parseDaysParam(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(n), MIN_DAYS), MAX_DAYS);
}

// Midnight, `days - 1` days before today — the first day of the window
// (today counts as one of the `days`).
export function windowStart(days: number): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Every YYYY-MM-DD in the window, oldest first, including today.
export function dayRange(days: number): string[] {
  const start = windowStart(days);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return dateKey(d);
  });
}
```

- [ ] **Step 2: Write the failing e2e test**

Create `backend/test/analytics-trends.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Analytics trends (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const pres = `an-tr-${Date.now()}@test.io`;
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
    prisma = moduleRef.get(PrismaService);
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnTrOrg', slug: `an-tr-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Trends Event', startAt: future(5), endAt: future(6) });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('zero-fills registrationTrend and reports a non-decreasing cumulative memberGrowth', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Two registrations today (the org's president is a member from setup;
    // these two participants are new active members too).
    const tokenA = await registerAndLogin(`tr-a-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const tokenB = await registerAndLogin(`tr-b-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=7`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.registrationTrend).toHaveLength(7);
    expect(res.body.memberGrowth).toHaveLength(7);
    const todayTrend = res.body.registrationTrend.find((r: { date: string }) => r.date === today);
    expect(todayTrend.count).toBe(2);
    // At least one earlier day in the window has zero registrations (zero-filled, not omitted).
    const earlierDay = res.body.registrationTrend[0];
    expect(earlierDay.count).toBe(0);

    // Member growth is non-decreasing across the window, and today's
    // cumulative count includes the president + both new participants.
    const counts = res.body.memberGrowth.map((g: { cumulativeActive: number }) => g.cumulativeActive);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(3);
  });

  it('defaults days to 30 when the query param is missing or invalid', async () => {
    const res1 = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res1.body.registrationTrend).toHaveLength(30);

    const res2 = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=not-a-number`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res2.body.registrationTrend).toHaveLength(30);
  });

  it('clamps days to the [1, 365] range', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends?days=9999`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(res.body.registrationTrend).toHaveLength(365);
  });

  it('cross-org isolation: org B president cannot view org A trends (403)', async () => {
    const otherPresToken = await registerAndLogin(`antr-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnTrOtherOrg', slug: `an-tr-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/trends`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 3: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-trends
```

Expected: FAIL — `Cannot GET /organizations/:orgId/analytics/trends` (404), route doesn't exist yet.

- [ ] **Step 4: Implement `getTrends` in `AnalyticsService`**

In `backend/src/analytics/analytics.service.ts`, add the import and the new method:

```ts
import { dayRange, dateKey, windowStart } from './date-window.util';
```

Add this method to the class, after `getCertificates`:

```ts
  async getTrends(organizationId: string, days: number) {
    const buckets = dayRange(days);
    const start = windowStart(days);

    const [registrations, memberships] = await Promise.all([
      this.prisma.registration.findMany({
        where: { organizationId, createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      this.prisma.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { joinedAt: true },
      }),
    ]);

    const regCounts = new Map(buckets.map((d) => [d, 0]));
    for (const r of registrations) {
      const key = dateKey(r.createdAt);
      if (regCounts.has(key)) regCounts.set(key, regCounts.get(key)! + 1);
    }
    const registrationTrend = buckets.map((date) => ({ date, count: regCounts.get(date)! }));

    // Two-pointer walk over every active member's join date: first
    // absorb everyone who joined strictly before the window (the org's
    // starting headcount), then advance through the window day by day.
    // Not filtered to the window at the query level — an org older than
    // `days` still has a nonzero count on day 1 of the window.
    const sortedJoinDates = memberships.map((m) => dateKey(m.joinedAt)).sort();
    let idx = 0;
    let cumulative = 0;
    while (idx < sortedJoinDates.length && sortedJoinDates[idx] < buckets[0]) {
      cumulative++;
      idx++;
    }
    const memberGrowth = buckets.map((date) => {
      while (idx < sortedJoinDates.length && sortedJoinDates[idx] <= date) {
        cumulative++;
        idx++;
      }
      return { date, cumulativeActive: cumulative };
    });

    return { registrationTrend, memberGrowth };
  }
```

- [ ] **Step 5: Add the route in `AnalyticsController`**

In `backend/src/analytics/analytics.controller.ts`, add the import and route:

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { parseDaysParam } from './date-window.util';
```

Add this method to the class, after `getCertificates`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('trends')
  getTrends(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getTrends(orgId, parseDaysParam(daysRaw));
  }
```

- [ ] **Step 6: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-trends
```

Expected: all tests PASS.

- [ ] **Step 7: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `190 passed` committed (186 from Task 2 + 4 new in `analytics-trends.e2e-spec.ts`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/analytics/date-window.util.ts backend/src/analytics/analytics.service.ts backend/src/analytics/analytics.controller.ts backend/test/analytics-trends.e2e-spec.ts
git commit -m "feat: analytics trends endpoint (registration + member growth)"
```

---

### Task 4: Demographics + committee-activity endpoints

**Files:**
- Modify: `backend/src/analytics/analytics.service.ts`
- Modify: `backend/src/analytics/analytics.controller.ts`
- Test: `backend/test/analytics-demographics.e2e-spec.ts`
- Test: `backend/test/analytics-committee-activity.e2e-spec.ts`

**Interfaces:**
- Consumes: `AnalyticsService`/`AnalyticsController` from Tasks 2–3 (same files, extended in place); `parseDaysParam`, `windowStart` from `date-window.util.ts` (Task 3).
- Produces: `AnalyticsService.getDemographics(organizationId: string): Promise<{ faculty: Array<{ value: string | null; count: number }>; programme: Array<{ value: string | null; count: number }> }>`; `AnalyticsService.getCommitteeActivity(organizationId: string, days: number): Promise<{ data: Array<{ userId: string; fullName: string; role: Role; actionCount: number }> }>`. Routes `GET /organizations/:orgId/analytics/demographics` and `GET /organizations/:orgId/analytics/committee-activity?days=`.

- [ ] **Step 1: Write the failing e2e tests**

Create `backend/test/analytics-demographics.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics demographics (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `an-dem-${Date.now()}@test.io`;

  async function register(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
  }
  async function login(email: string) {
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await register(pres);
    presToken = await login(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnDemOrg', slug: `an-dem-${Date.now()}` })).body.id;

    const memberA = `dem-a-${Date.now()}@test.io`;
    const memberB = `dem-b-${Date.now()}@test.io`;
    const memberC = `dem-c-${Date.now()}@test.io`;
    await register(memberA);
    await register(memberB);
    await register(memberC);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberA, role: 'COMMITTEE', faculty: 'ICT', programme: 'BCS' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberB, role: 'COMMITTEE', faculty: 'ICT', programme: 'BIT' }).expect(201);
    // memberC has no faculty/programme set.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: memberC, role: 'VOLUNTEER' }).expect(201);
  });
  afterAll(async () => { await app.close(); });

  it('groups active members by faculty and programme, including a null group', async () => {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const ictGroup = res.body.faculty.find((f: { value: string | null }) => f.value === 'ICT');
    expect(ictGroup.count).toBe(2);
    const nullFaculty = res.body.faculty.find((f: { value: string | null }) => f.value === null);
    expect(nullFaculty.count).toBe(2); // memberC + the president (no faculty set)

    const bcsGroup = res.body.programme.find((p: { value: string | null }) => p.value === 'BCS');
    expect(bcsGroup.count).toBe(1);

    // No member-identifying field anywhere in the response.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('fullName');
  });

  it('a plain participant cannot view demographics (403)', async () => {
    const participant = `dem-p-${Date.now()}@test.io`;
    await register(participant);
    const token = await login(participant);
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Dem Event', startAt: new Date(Date.now() + 5 * 86400000).toISOString(), endAt: new Date(Date.now() + 6 * 86400000).toISOString() });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A demographics (403)', async () => {
    const otherEmail = `andem-other-${Date.now()}@test.io`;
    await register(otherEmail);
    const otherPresToken = await login(otherEmail);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnDemOtherOrg', slug: `an-dem-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/demographics`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

Create `backend/test/analytics-committee-activity.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics committee activity (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `an-ca-${Date.now()}@test.io`;
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
    presToken = await registerAndLogin(pres);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`).send({ name: 'AnCaOrg', slug: `an-ca-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('ranks committee members by audit action count, descending, excluding members with zero activity', async () => {
    // President creates 2 events (2 audited event.create actions, attributed to the president).
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CA Event 1', startAt: future(5), endAt: future(6) }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'CA Event 2', startAt: future(5), endAt: future(6) }).expect(201);

    // A second committee member creates 1 event. Adding them is itself an
    // audited `member.add` action — attributed to the CALLER (the
    // president), not the target — so this also adds 1 to the president's
    // count, not the new member's.
    const committeeEmail = `ca-committee-${Date.now()}@test.io`;
    const committeeToken = await registerAndLogin(committeeEmail);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: committeeEmail, role: 'COMMITTEE' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${committeeToken}`).send({ title: 'CA Event 3', startAt: future(5), endAt: future(6) }).expect(201);

    // A third committee member joins but performs no action of their own —
    // adding them is again attributed to the president, not to them.
    const idleEmail = `ca-idle-${Date.now()}@test.io`;
    await registerAndLogin(idleEmail);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: idleEmail, role: 'COMMITTEE' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/committee-activity`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.data.length).toBe(2); // president + the active committee member; idle member excluded (zero actions attributed to them)
    expect(res.body.data[0].actionCount).toBeGreaterThanOrEqual(res.body.data[1].actionCount);
    const presEntry = res.body.data.find((d: { role: string }) => d.role === 'PRESIDENT');
    // 2 event.create + 2 member.add (adding committeeEmail, then idleEmail).
    expect(presEntry.actionCount).toBe(4);
    const committeeEntry = res.body.data.find((d: { role: string }) => d.role === 'COMMITTEE');
    expect(committeeEntry.actionCount).toBe(1);
    expect(res.body.data.some((d: { userId: string }) => d.userId === undefined)).toBe(false);
  });

  it('cross-org isolation: org B president cannot view org A committee activity (403)', async () => {
    const otherPresToken = await registerAndLogin(`anca-other-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnCaOtherOrg', slug: `an-ca-other-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/committee-activity`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run both new e2e files to verify they fail**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-demographics analytics-committee-activity
```

Expected: FAIL — both routes 404, neither exists yet.

- [ ] **Step 3: Implement `getDemographics` and `getCommitteeActivity` in `AnalyticsService`**

In `backend/src/analytics/analytics.service.ts`, the import from Task 3 already covers this task's needs:

```ts
import { dayRange, dateKey, windowStart } from './date-window.util';
```

(`getCommitteeActivity` below uses `windowStart`, already imported — no import-line change needed in this task.)

Add these two methods to the class, after `getTrends`:

```ts
  async getDemographics(organizationId: string) {
    const [facultyGroups, programmeGroups] = await Promise.all([
      this.prisma.membership.groupBy({
        by: ['faculty'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.membership.groupBy({
        by: ['programme'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    return {
      faculty: facultyGroups.map((g) => ({ value: g.faculty, count: g._count._all })),
      programme: programmeGroups.map((g) => ({ value: g.programme, count: g._count._all })),
    };
  }

  async getCommitteeActivity(organizationId: string, days: number) {
    const since = windowStart(days);
    const grouped = await this.prisma.auditLog.groupBy({
      by: ['actorUserId'],
      where: { organizationId, createdAt: { gte: since }, actorUserId: { not: null } },
      _count: { _all: true },
    });

    const userIds = grouped
      .map((g) => g.actorUserId)
      .filter((id): id is string => id !== null);
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, userId: { in: userIds } },
      select: { userId: true, role: true, user: { select: { fullName: true } } },
    });
    const byUserId = new Map(memberships.map((m) => [m.userId, m]));

    // A user with a current Membership in this org is included; an actor
    // who has since left (no Membership row) has nothing to attribute a
    // name/role to, and is dropped rather than shown with placeholder data.
    const data = grouped
      .filter((g) => g.actorUserId !== null && byUserId.has(g.actorUserId))
      .map((g) => {
        const m = byUserId.get(g.actorUserId!)!;
        return { userId: g.actorUserId!, fullName: m.user.fullName, role: m.role, actionCount: g._count._all };
      })
      .sort((a, b) => b.actionCount - a.actionCount);

    return { data };
  }
```

- [ ] **Step 4: Add the two routes in `AnalyticsController`**

In `backend/src/analytics/analytics.controller.ts`, add these two methods to the class, after `getTrends`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('demographics')
  getDemographics(@OrgId() orgId: string) {
    return this.analytics.getDemographics(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('committee-activity')
  getCommitteeActivity(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getCommitteeActivity(orgId, parseDaysParam(daysRaw));
  }
```

- [ ] **Step 5: Run both e2e files to verify they pass**

```bash
cd backend && npx jest --config ./test/jest-e2e.json analytics-demographics analytics-committee-activity
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `195 passed` committed (190 from Task 3 + 5 new: 3 in `analytics-demographics.e2e-spec.ts` + 2 in `analytics-committee-activity.e2e-spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add backend/src/analytics/analytics.service.ts backend/src/analytics/analytics.controller.ts backend/test/analytics-demographics.e2e-spec.ts backend/test/analytics-committee-activity.e2e-spec.ts
git commit -m "feat: analytics demographics and committee-activity endpoints"
```

---

### Task 5: Docs sync

**Files:**
- Modify: `docs/database.md`
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: nothing new — documents Tasks 1–4's shipped behavior.
- Produces: no code changes.

- [ ] **Step 1: Update `docs/database.md`**

Read the current file first (`docs/database.md`), find the `### Certificate (shipped)` table, and add a new entity block directly after it (before `### ConsentRecord (PDPA) (shipped)`):

```markdown
### CertificateDownload (shipped)
| Field | Type | Notes |
|-------|------|-------|
| id | uuid (PK) | |
| certificateId | uuid (FK → Certificate) | |
| userId | uuid | the downloading actor — participant self-download or committee download-by-id; plain column, no FK relation (matches `Certificate.uploadedByUserId`'s convention) |
| downloadedAt | timestamp | |
| — | `@@index([certificateId])` | |

Not a tenant-scoped model — queried through `certificate: { organizationId }`
(a relation filter), written by known `certificateId` on every signed-URL
issuance from `CertificatesService.findMine`/`download`. One row per
issuance, not per unique downloader — a certificate downloaded five times
by the same person is five rows.
```

- [ ] **Step 2: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — PDPA (shipped)` section (the most recent one), and add a new `### As built — analytics (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`, matching where every prior "As built" section was inserted). Document:

- Five routes under `GET /organizations/:orgId/analytics/*` (`overview`, `trends`, `demographics`, `certificates`, `committee-activity`), all gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` — same tier as the existing Dashboard, no new permission tier.
- `attendanceRate` definition verbatim: `PRESENT / (PRESENT + ABSENT)`, excluding `REGISTERED` rows, `null` when there are zero resolved rows.
- `days` query param (`trends`, `committee-activity`): default `30`, invalid/non-positive silently defaults (never `400`s), clamped to `[1, 365]`.
- Demographics returns aggregate counts only (`faculty`/`programme` grouped counts) — never a member list or any identifying field, since that combination is demographic/PII-adjacent data.
- Committee activity is per-member `AuditLog` action counts within the window, joined to the actor's *current* `Membership` — an actor who has since left the org (no current Membership) is excluded, not shown with placeholder data.
- `CertificateDownload` tracking: written on every signed-URL issuance (`findMine` and `download`), best-effort (a tracking-write failure is logged and never blocks the download response, which already has a valid signed URL by that point).
- No new audit action — all five reads are unaudited (matching the Dashboard/audit-logs-list precedent); the `CertificateDownload` insert is a metrics row, not an audit entry.

- [ ] **Step 3: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed`; e2e `195 passed` committed (docs-only task, no test count change from Task 4).

- [ ] **Step 4: Commit**

```bash
git add docs/database.md docs/security.md
git commit -m "docs: sync database and security docs for analytics"
```

---

## Post-plan: roadmap note

After Task 5 is committed, Phase 2's first item (Analytics) is complete. `docs/roadmap.md`'s Phase 2 list has no fixed build order (unlike Phase 1's numbered list) — note in the next session's handoff that Analytics is done, and the remaining Phase 2 items (File Repository, Meeting Minutes, Asset Management, Public Club Page, Email Notifications, Certificate Generator, Branding & Themes, Event Feedback + NPS, Committee Handover Pack, Consent-versioned re-prompt) are all still unstarted — the user picks the next one.
