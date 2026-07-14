# Basic PDPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consent capture at signup, `GET /me/export`, `GET /me/consents`, and `DELETE /me` (immediate anonymize) — Phase 1 item 11, backend-only.

**Architecture:** New `backend/src/pdpa` module owning three user-level routes under `/me` (JwtAuthGuard only — no TenantGuard/RolesGuard, no `:orgId`). Signup-consent change lands in the existing `auth` module. Spec: `docs/superpowers/specs/2026-07-14-basic-pdpa-design.md`.

**Tech Stack:** NestJS, Prisma, class-validator, argon2, existing StorageService (MinIO signed URLs), existing AuditService.

## Global Constraints

- All `/me` routes: `@UseGuards(JwtAuthGuard)` ONLY. They are cross-org user-level routes; TenantGuard/RolesGuard must NOT appear.
- Tenant-scope middleware (`backend/src/prisma/tenant-scope.middleware.ts`) throws on `findMany`/`count`/`updateMany`/`deleteMany`/`aggregate`/`groupBy` against Membership/Registration/Attendance/Certificate/Event/AuditLog without `organizationId` in `where`. `findUnique`, `update`, `delete`, `create` by unique id are exempt by design. Export reads everything through ONE `user.findUnique` include tree (User is not tenant-scoped; nested includes do not fire separate middleware events). Anonymize writes per-row by unique `id`. Never add a middleware bypass.
- `CURRENT_POLICY_VERSION = 'v1'` — value unchanged, moves to `backend/src/pdpa/policy-version.ts`.
- Signed URL TTL for export certificate links: `300` seconds (same as certificates module).
- Anonymized values, exact: email `deleted-<uuid>@anonymized.invalid`, fullName `'Deleted User'`, passwordHash = argon2 hash of a random UUID, mfaSecret null, deletedAt now.
- Sole-president deletion → `409` with message `Transfer presidency in <org names, comma-joined> before deleting your account`.
- Audit actions: `pdpa.export` (targetType 'User', no organizationId), `pdpa.delete` (one per membership's org, targetType 'Membership'). Metadata ids-only. `GET /me/consents` unaudited.
- ConsentRecords and Attendance rows are NEVER deleted or modified by anonymize. Membership `status`/`role` unchanged.
- **DO NOT TOUCH:** `.gitignore` (uncommitted user change), `backend/test/zzz-concurrency-probe.e2e-spec.ts` (untracked, user-owned — it calls `/auth/register` without consent and WILL fail after Task 1; the user handles that file themselves; report committed-suite results only), `backend/.env`. Never run `git push`.
- Test commands run from `backend/`: `npm test` (unit), `npm run test:e2e` (all e2e), `npm run test:e2e -- pdpa` (one suite).
- Baseline before this feature: unit 40, committed e2e 168 (169 with the user's untracked probe).

---

### Task 1: Signup consent capture

**Files:**
- Create: `backend/src/pdpa/policy-version.ts`
- Create: `backend/test/pdpa.e2e-spec.ts` (consent describe-block only; Tasks 2–3 extend this file)
- Modify: `backend/src/auth/dto/register.dto.ts`
- Modify: `backend/src/auth/auth.service.ts` (register method only)
- Modify: `backend/src/registrations/registrations.service.ts` (constant import only)
- Modify: every committed e2e spec under `backend/test/` that posts `/auth/register` (31 files — NOT zzz-concurrency-probe)

**Interfaces:**
- Consumes: existing `RegisterDto`, `AuthService.register`, `prisma.user.create`.
- Produces: `CURRENT_POLICY_VERSION` exported from `backend/src/pdpa/policy-version.ts` (Tasks 2–3 import nothing from this task; Task 4 documents it). Register now requires `consent: true` in the body.

- [ ] **Step 1: Write the failing tests**

Create `backend/test/pdpa.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PDPA (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' })).body.accessToken;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  describe('signup consent', () => {
    it('rejects registration without consent (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-nc-${Date.now()}@test.io`, password: 'password123', fullName: 'NoConsent' })
        .expect(400);
    });

    it('rejects registration with consent: false (400)', async () => {
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email: `pdpa-fc-${Date.now()}@test.io`, password: 'password123', fullName: 'FalseConsent', consent: false })
        .expect(400);
    });

    it('records an account ConsentRecord on registration', async () => {
      const email = `pdpa-c-${Date.now()}@test.io`;
      const res = await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: 'Consenting', consent: true })
        .expect(201);
      const consents = await prisma.consentRecord.findMany({ where: { userId: res.body.id } });
      expect(consents).toHaveLength(1);
      expect(consents[0].purpose).toBe('account');
      expect(consents[0].policyVersion).toBe('v1');
      expect(consents[0].grantedAt).toBeInstanceOf(Date);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:e2e -- pdpa` (from `backend/`)
Expected: FAIL — the no-consent registrations currently return 201 (no validation yet), and no ConsentRecord row exists.

- [ ] **Step 3: Create the shared policy-version constant**

Create `backend/src/pdpa/policy-version.ts`:

```ts
// Single source of truth for the privacy-policy version stamped onto every
// ConsentRecord. Bump when the policy text changes (re-prompt is a Phase 2+
// roadmap item).
export const CURRENT_POLICY_VERSION = 'v1';
```

In `backend/src/registrations/registrations.service.ts`, delete the local line:

```ts
const CURRENT_POLICY_VERSION = 'v1';
```

and add to its imports:

```ts
import { CURRENT_POLICY_VERSION } from '../pdpa/policy-version';
```

- [ ] **Step 4: Require consent in RegisterDto**

`backend/src/auth/dto/register.dto.ts` — full new content:

```ts
import { Equals, IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  // PDPA: explicit consent to the account privacy policy. Missing or false → 400.
  @Equals(true)
  consent!: boolean;
}
```

- [ ] **Step 5: Write the ConsentRecord atomically in register()**

In `backend/src/auth/auth.service.ts`, add the import:

```ts
import { CURRENT_POLICY_VERSION } from '../pdpa/policy-version';
```

and replace the `user.create` call inside `register()` with a nested write (atomic — user and consent land or fail together):

```ts
const user = await this.prisma.user.create({
  data: {
    email: dto.email,
    passwordHash,
    fullName: dto.fullName,
    consentRecords: {
      create: { purpose: 'account', policyVersion: CURRENT_POLICY_VERSION },
    },
  },
});
```

- [ ] **Step 6: Update every committed e2e register call**

Every committed spec under `backend/test/` that posts `/auth/register` sends `{ email, password: 'password123', fullName: ... }` — add `consent: true` to each such `.send({...})`. Find them all:

```bash
grep -rln "auth/register" backend/test --include="*.e2e-spec.ts" | grep -v zzz-concurrency-probe
```

(31 files; most have exactly one `registerAndLogin` helper, a few have two call sites — update every occurrence.) **Do not touch `backend/test/zzz-concurrency-probe.e2e-spec.ts`** — user-owned; it will fail after this task and the user handles it.

Verify no committed register call is missing consent:

```bash
grep -rn "auth/register" backend/test --include="*.e2e-spec.ts" -A 1 | grep -v consent | grep "send(" | grep -v zzz-concurrency-probe
```

Expected: no output.

- [ ] **Step 7: Run pdpa suite, then full suites**

Run: `npm run test:e2e -- pdpa` → 3/3 pass.
Run: `npm test` → 40/40 (auth login-persist unit specs create users via service — check whether any unit spec calls `auth.register(...)`; if one does, add `consent: true` to its DTO literal).
Run: `npm run test:e2e` → all committed suites pass: 168 committed baseline + 3 new = 171 committed (the user's untracked probe fails by design — report it separately, do not fix it).

- [ ] **Step 8: Commit**

```bash
git add backend/src/pdpa/policy-version.ts backend/src/auth/dto/register.dto.ts backend/src/auth/auth.service.ts backend/src/registrations/registrations.service.ts backend/test/pdpa.e2e-spec.ts
git add backend/test/*.e2e-spec.ts
git reset backend/test/zzz-concurrency-probe.e2e-spec.ts 2>/dev/null; true
git commit -m "feat: require and record signup consent (PDPA)"
```

---

### Task 2: PDPA module — GET /me/consents + GET /me/export

**Files:**
- Create: `backend/src/pdpa/pdpa.module.ts`
- Create: `backend/src/pdpa/pdpa.controller.ts`
- Create: `backend/src/pdpa/pdpa.service.ts`
- Modify: `backend/src/app.module.ts` (register PdpaModule)
- Modify: `backend/test/pdpa.e2e-spec.ts` (append describe-blocks)

**Interfaces:**
- Consumes: `CURRENT_POLICY_VERSION` sibling file (not imported here — controller/service don't need it), `StorageService.getSignedDownloadUrl(key, ttl)` from `../storage/storage.service`, `AuditService.record(entry)` (global module), `CurrentUser` decorator from `../auth/decorators/current-user.decorator`, `JwtAuthGuard` from `../auth/guards/jwt-auth.guard`.
- Produces: `PdpaService` with `consents(userId): Promise<...>`, `export(userId): Promise<...>`; `PdpaController` at `@Controller('me')`. Task 3 adds `deleteAccount(userId)` to this same service and a `@Delete()` handler to this same controller.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/pdpa.e2e-spec.ts` (inside the top-level `describe('PDPA (e2e)')`, after the signup-consent block). The seeding helper creates: an org (president), a published event, a participant registration (writes the event-registration ConsentRecord), and a directly-seeded certificate (prisma + storage — avoids the attendance-scan ceremony, which is not what this suite tests):

```ts
describe('consents and export', () => {
  let presToken: string;
  let partToken: string;
  let partUserId: string;
  let orgId: string;
  let eventId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  beforeAll(async () => {
    presToken = await registerAndLogin(`pdpa-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'PdpaOrg', slug: `pdpaorg-${Date.now()}` })).body.id;
    const ev = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'PDPA Event', startAt: future(5), endAt: future(6) }).expect(201);
    eventId = ev.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const partEmail = `pdpa-part-${Date.now()}@test.io`;
    partToken = await registerAndLogin(partEmail);
    partUserId = (await prisma.user.findUnique({ where: { email: partEmail } }))!.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${partToken}`).send({ answers: { note: 'my dietary needs' } }).expect(201);

    // Seed a certificate directly (row + storage object) — upload RBAC/flow is certificates-suite territory.
    const { StorageService } = await import('../src/storage/storage.service');
    const storage = app.get(StorageService);
    const key = `certificates/${orgId}/${eventId}/${partUserId}.pdf`;
    await storage.putObject(key, Buffer.from('%PDF-1.4\npdpa cert\n'), 'application/pdf');
    await prisma.certificate.create({
      data: { eventId, organizationId: orgId, userId: partUserId, storageKey: key, fileSizeBytes: 20, uploadedByUserId: partUserId },
    });
  });

  it('GET /me/consents lists account + event-registration consents, no ipAddress', async () => {
    const res = await request(app.getHttpServer()).get('/me/consents')
      .set('Authorization', `Bearer ${partToken}`).expect(200);
    expect(res.body).toHaveLength(2);
    const purposes = res.body.map((c: { purpose: string }) => c.purpose).sort();
    expect(purposes).toEqual(['account', 'event-registration']);
    for (const c of res.body) {
      expect(c.policyVersion).toBe('v1');
      expect(c.grantedAt).toBeDefined();
      expect(c).not.toHaveProperty('ipAddress');
    }
  });

  it('GET /me/export returns every section with only own data', async () => {
    const res = await request(app.getHttpServer()).get('/me/export')
      .set('Authorization', `Bearer ${partToken}`).expect(200);

    expect(res.body.profile.id).toBe(partUserId);
    expect(res.body.memberships).toEqual([]); // participant registered for an event; never added as a member
    expect(res.body.registrations).toHaveLength(1);
    expect(res.body.registrations[0].eventTitle).toBe('PDPA Event');
    expect(res.body.registrations[0].organizationName).toBe('PdpaOrg');
    expect(res.body.registrations[0].answers).toEqual({ note: 'my dietary needs' });
    expect(res.body.consents).toHaveLength(2);
    expect(res.body.certificates).toHaveLength(1);
    expect(res.body.certificates[0].eventTitle).toBe('PDPA Event');
    expect(res.body.exportedAt).toBeDefined();

    // The signed URL actually serves the file.
    const dl = await fetch(res.body.certificates[0].downloadUrl);
    expect(dl.status).toBe(200);

    // Isolation: president's export contains none of the participant's artifacts.
    const presRes = await request(app.getHttpServer()).get('/me/export')
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(presRes.body.registrations).toEqual([]);
    expect(presRes.body.certificates).toEqual([]);
    expect(presRes.body.memberships).toHaveLength(1); // own org presidency only
  });

  it('export is audited as pdpa.export', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { organizationId: null, actorUserId: partUserId, action: 'pdpa.export' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].targetType).toBe('User');
    expect(rows[0].targetId).toBe(partUserId);
  });

  it('requires auth (401)', async () => {
    await request(app.getHttpServer()).get('/me/export').expect(401);
    await request(app.getHttpServer()).get('/me/consents').expect(401);
  });
});
```

Note: the `prisma.auditLog.findMany` above filters `organizationId: null` explicitly — the tenant middleware requires the key to be *present*; `null` is still rejected by the current middleware (`=== null` check). So query it with a workaround: use `prisma.auditLog.findMany({ where: { organizationId: { equals: null }, ... } })` — the middleware checks `where.organizationId === undefined || === null`; a `{ equals: null }` object passes the check while still filtering for null. Use exactly:

```ts
const rows = await prisma.auditLog.findMany({
  where: { organizationId: { equals: null }, actorUserId: partUserId, action: 'pdpa.export' },
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:e2e -- pdpa`
Expected: signup-consent block still passes; new block fails with 404 on `/me/consents` and `/me/export` (no controller yet).

- [ ] **Step 3: Implement the service**

Create `backend/src/pdpa/pdpa.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';

const SIGNED_URL_TTL_SECONDS = 300;

@Injectable()
export class PdpaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  consents(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { grantedAt: 'desc' },
      select: { id: true, purpose: true, policyVersion: true, grantedAt: true },
    });
  }

  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: { include: { organization: { select: { name: true } } } },
        registrations: {
          include: {
            event: { select: { title: true, organization: { select: { name: true } } } },
            attendance: true,
          },
        },
        consentRecords: true,
        certificates: { include: { event: { select: { title: true } } } },
      },
    });
    if (!user) throw new NotFoundException(); // unreachable for an authenticated token; guards the type

    const certificates = await Promise.all(
      user.certificates.map(async (c) => ({
        eventTitle: c.event.title,
        fileSizeBytes: c.fileSizeBytes,
        createdAt: c.createdAt,
        downloadUrl: await this.storage.getSignedDownloadUrl(c.storageKey, SIGNED_URL_TTL_SECONDS),
      })),
    );

    await this.audit.record({
      actorUserId: userId,
      action: 'pdpa.export',
      targetType: 'User',
      targetId: userId,
    });

    return {
      profile: { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt },
      memberships: user.memberships.map((m) => ({
        organizationName: m.organization.name,
        role: m.role,
        status: m.status,
        studentId: m.studentId,
        faculty: m.faculty,
        programme: m.programme,
        intake: m.intake,
        phone: m.phone,
        joinedAt: m.joinedAt,
      })),
      registrations: user.registrations.map((r) => ({
        eventTitle: r.event.title,
        organizationName: r.event.organization.name,
        status: r.status,
        answers: r.answers,
        createdAt: r.createdAt,
      })),
      attendance: user.registrations
        .filter((r) => r.attendance)
        .map((r) => ({
          eventTitle: r.event.title,
          status: r.attendance!.status,
          scannedAt: r.attendance!.scannedAt,
        })),
      consents: user.consentRecords.map((c) => ({
        purpose: c.purpose,
        policyVersion: c.policyVersion,
        grantedAt: c.grantedAt,
      })),
      certificates,
      exportedAt: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 4: Implement controller + module, wire into app**

Create `backend/src/pdpa/pdpa.controller.ts`:

```ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PdpaService } from './pdpa.service';

// User-level PDPA routes: cross-org by design, so no TenantGuard/RolesGuard.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class PdpaController {
  constructor(private readonly pdpa: PdpaService) {}

  @Get('consents')
  consents(@CurrentUser() user: { userId: string }) {
    return this.pdpa.consents(user.userId);
  }

  @Get('export')
  export(@CurrentUser() user: { userId: string }) {
    return this.pdpa.export(user.userId);
  }
}
```

Create `backend/src/pdpa/pdpa.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PdpaController } from './pdpa.controller';
import { PdpaService } from './pdpa.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [PdpaController],
  providers: [PdpaService],
})
export class PdpaModule {}
```

(Check `backend/src/storage/storage.module.ts` first: if `StorageModule` is `@Global()`, drop the `imports: [StorageModule]` line to match how other modules consume it — mirror whatever `certificates.module.ts` does.)

In `backend/src/app.module.ts`, add `import { PdpaModule } from './pdpa/pdpa.module';` and append `PdpaModule` to the `imports` array after `DashboardModule`.

- [ ] **Step 5: Run pdpa suite**

Run: `npm run test:e2e -- pdpa`
Expected: all pass (3 consent + 4 new = 7).

- [ ] **Step 6: Run full suites**

Run: `npm test` → 40/40. Run: `npm run test:e2e` → 175 committed (Task 1 ended at 171; this task adds 4; the user's untracked probe still failing by design, untouched).

- [ ] **Step 7: Commit**

```bash
git add backend/src/pdpa backend/src/app.module.ts backend/test/pdpa.e2e-spec.ts
git commit -m "feat: PDPA consents and data-export endpoints"
```

---

### Task 3: DELETE /me — immediate anonymize

**Files:**
- Modify: `backend/src/pdpa/pdpa.service.ts` (add `deleteAccount`)
- Modify: `backend/src/pdpa/pdpa.controller.ts` (add `@Delete()`)
- Modify: `backend/test/pdpa.e2e-spec.ts` (append describe-block)

**Interfaces:**
- Consumes: `PdpaService`/`PdpaController` from Task 2; `StorageService.deleteObject(key)`; `AuditService.record(entry, tx)` (transaction-aware overload — existing signature `record(entry: AuditEntry, tx?: Prisma.TransactionClient)`); memberships role-change endpoint `PATCH /organizations/:orgId/members/:membershipId/role` body `{ role: 'PRESIDENT' }` (test only).
- Produces: `deleteAccount(userId): Promise<void>`; `DELETE /me` → 204.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/pdpa.e2e-spec.ts`:

```ts
describe('DELETE /me (anonymize)', () => {
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();

  it('blocks a sole president with 409 naming the org', async () => {
    const email = `pdpa-solo-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${token}`)
      .send({ name: 'SoloOrg', slug: `soloorg-${Date.now()}` }).expect(201);

    const res = await request(app.getHttpServer()).delete('/me')
      .set('Authorization', `Bearer ${token}`).expect(409);
    expect(res.body.message).toContain('SoloOrg');
  });

  it('succeeds after presidency transfer, and for plain users', async () => {
    // President A + org
    const emailA = `pdpa-presa-${Date.now()}@test.io`;
    const tokenA = await registerAndLogin(emailA);
    const org = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'HandoverOrg', slug: `handover-${Date.now()}` })).body;

    // Member B, promoted to PRESIDENT
    const emailB = `pdpa-presb-${Date.now()}@test.io`;
    await registerAndLogin(emailB);
    const memberB = (await request(app.getHttpServer()).post(`/organizations/${org.id}/members`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: emailB, role: 'COMMITTEE' }).expect(201)).body;
    await request(app.getHttpServer()).patch(`/organizations/${org.id}/members/${memberB.id}/role`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ role: 'PRESIDENT' }).expect(200);

    // Now A can delete
    await request(app.getHttpServer()).delete('/me')
      .set('Authorization', `Bearer ${tokenA}`).expect(204);
  });

  it('anonymizes everything and preserves org statistics', async () => {
    // Full-fixture participant: registration with answers, certificate, refresh token.
    const presEmail = `pdpa-dpres-${Date.now()}@test.io`;
    const presToken = await registerAndLogin(presEmail);
    const orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'DelOrg', slug: `delorg-${Date.now()}` })).body.id;
    const eventId = (await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Del Event', startAt: future(5), endAt: future(6) })).body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const email = `pdpa-del-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'Delete Me', consent: true }).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' }).expect(201);
    const token = login.body.accessToken;
    const refreshToken = login.body.refreshToken;
    const userId = (await prisma.user.findUnique({ where: { email } }))!.id;

    // Membership with PII + registration with answers
    await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ email, role: 'VOLUNTEER', studentId: 'S12345', phone: '0123456789' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({ answers: { allergy: 'peanuts' } }).expect(201);

    // Seeded certificate (row + object)
    const { StorageService } = await import('../src/storage/storage.service');
    const storage = app.get(StorageService);
    const key = `certificates/${orgId}/${eventId}/${userId}.pdf`;
    await storage.putObject(key, Buffer.from('%PDF-1.4\ndel cert\n'), 'application/pdf');
    await prisma.certificate.create({
      data: { eventId, organizationId: orgId, userId, storageKey: key, fileSizeBytes: 18, uploadedByUserId: userId },
    });
    const signedBefore = await storage.getSignedDownloadUrl(key, 60);

    const regCountBefore = await prisma.registration.count({ where: { organizationId: orgId, eventId } });

    await request(app.getHttpServer()).delete('/me')
      .set('Authorization', `Bearer ${token}`).expect(204);

    // Login dead, refresh dead
    await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' }).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken }).expect(401);

    // User anonymized
    const user = (await prisma.user.findUnique({ where: { id: userId } }))!;
    expect(user.email).not.toBe(email);
    expect(user.email).toMatch(/@anonymized\.invalid$/);
    expect(user.fullName).toBe('Deleted User');
    expect(user.deletedAt).not.toBeNull();

    // Membership PII gone, row + role/status intact
    const membership = (await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    }))!;
    expect(membership.studentId).toBeNull();
    expect(membership.phone).toBeNull();
    expect(membership.role).toBe('VOLUNTEER');
    expect(membership.status).toBe('ACTIVE');

    // Registration kept, answers gone; org count unchanged
    const regCountAfter = await prisma.registration.count({ where: { organizationId: orgId, eventId } });
    expect(regCountAfter).toBe(regCountBefore);
    const reg = await prisma.registration.findUnique({ where: { eventId_userId: { eventId, userId } } });
    expect(reg!.answers).toBeNull();

    // ConsentRecords retained
    const consents = await prisma.consentRecord.findMany({ where: { userId } });
    expect(consents.length).toBeGreaterThanOrEqual(2);

    // Certificate row + object gone
    const certs = await prisma.certificate.findMany({ where: { organizationId: orgId, userId } });
    expect(certs).toHaveLength(0);
    const dl = await fetch(signedBefore);
    expect(dl.status).toBe(404);

    // pdpa.delete audited in the org
    const auditRows = await prisma.auditLog.findMany({
      where: { organizationId: orgId, actorUserId: userId, action: 'pdpa.delete' },
    });
    expect(auditRows).toHaveLength(1);

    // Second DELETE within the token window: idempotent 204
    await request(app.getHttpServer()).delete('/me')
      .set('Authorization', `Bearer ${token}`).expect(204);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:e2e -- pdpa`
Expected: prior blocks pass; new block fails — `DELETE /me` is 404 (no handler).

- [ ] **Step 3: Implement deleteAccount**

In `backend/src/pdpa/pdpa.service.ts`, extend the imports:

```ts
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
```

(match the argon2 import style used in `auth.service.ts`), add a logger field to the class:

```ts
private readonly logger = new Logger(PdpaService.name);
```

and add the method:

```ts
async deleteAccount(userId: string): Promise<void> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: { include: { organization: { select: { name: true } } } },
      registrations: { select: { id: true } },
      certificates: { select: { id: true, storageKey: true } },
    },
  });
  if (!user || user.deletedAt) return; // idempotent within the access-token window

  // Sole-president guard: an org must never be left headless.
  const headless: string[] = [];
  for (const m of user.memberships) {
    if (m.role !== 'PRESIDENT' || m.status !== 'ACTIVE') continue;
    const others = await this.prisma.membership.count({
      where: { organizationId: m.organizationId, role: 'PRESIDENT', status: 'ACTIVE', NOT: { id: m.id } },
    });
    if (others === 0) headless.push(m.organization.name);
  }
  if (headless.length > 0) {
    throw new ConflictException(
      `Transfer presidency in ${headless.join(', ')} before deleting your account`,
    );
  }

  const anonPasswordHash = await argon2.hash(randomUUID());

  await this.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted-${randomUUID()}@anonymized.invalid`,
        fullName: 'Deleted User',
        passwordHash: anonPasswordHash,
        mfaSecret: null,
        deletedAt: new Date(),
      },
    });
    for (const m of user.memberships) {
      // update-by-unique-id: exempt from the tenant middleware by design.
      await tx.membership.update({
        where: { id: m.id },
        data: { studentId: null, faculty: null, programme: null, intake: null, phone: null, committeeHistory: Prisma.DbNull },
      });
    }
    for (const r of user.registrations) {
      await tx.registration.update({ where: { id: r.id }, data: { answers: Prisma.DbNull } });
    }
    for (const c of user.certificates) {
      await tx.certificate.delete({ where: { id: c.id } });
    }
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    for (const m of user.memberships) {
      await this.audit.record({
        organizationId: m.organizationId,
        actorUserId: userId,
        action: 'pdpa.delete',
        targetType: 'Membership',
        targetId: m.id,
      }, tx);
    }
  });

  // Best-effort storage cleanup after commit: a failure leaves an orphaned
  // object in a private bucket with no DB pointer — log, don't fail the request.
  for (const c of user.certificates) {
    try {
      await this.storage.deleteObject(c.storageKey);
    } catch {
      this.logger.warn(`orphaned storage object after account deletion: ${c.storageKey}`);
    }
  }
}
```

- [ ] **Step 4: Add the controller handler**

In `backend/src/pdpa/pdpa.controller.ts`, extend the `@nestjs/common` import with `Delete, HttpCode` and add:

```ts
@Delete()
@HttpCode(204)
deleteAccount(@CurrentUser() user: { userId: string }) {
  return this.pdpa.deleteAccount(user.userId);
}
```

- [ ] **Step 5: Run pdpa suite**

Run: `npm run test:e2e -- pdpa`
Expected: all pass (7 + 3 new = 10).

- [ ] **Step 6: Run full suites**

Run: `npm test` → 40/40. Run: `npm run test:e2e` → 178 committed (175 + 3; probe still failing by design, untouched).

- [ ] **Step 7: Commit**

```bash
git add backend/src/pdpa backend/test/pdpa.e2e-spec.ts
git commit -m "feat: PDPA account deletion (immediate anonymize)"
```

---

### Task 4: Docs sync (security.md)

**Files:**
- Modify: `docs/security.md`

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–3 (verify every fact against the code before writing it).
- Produces: an "As built — PDPA (shipped)" section.

- [ ] **Step 1: Read the current doc and the shipped code**

Read `docs/security.md` in full. Locate the "As built — audit logs (shipped)" section (after the dashboard block, before `## 3. Multi-Tenant Isolation`). Read `backend/src/pdpa/*.ts`, `backend/src/auth/dto/register.dto.ts`, and the register method in `backend/src/auth/auth.service.ts` to verify facts.

- [ ] **Step 2: Add the new section**

Insert immediately after the "As built — audit logs (shipped)" section, matching its prose style and density, a `### As built — PDPA (shipped)` section covering exactly:

- Signup consent: `RegisterDto.consent` `@Equals(true)` (missing/false → 400); ConsentRecord `{ purpose: 'account', policyVersion: 'v1' }` written atomically via nested create; `CURRENT_POLICY_VERSION` single-sourced in `backend/src/pdpa/policy-version.ts` (also stamped on event-registration consents).
- Routes: `GET /me/consents`, `GET /me/export`, `DELETE /me` — `JwtAuthGuard` only; user-level cross-org by design (first non-auth user-level routes); no TenantGuard/RolesGuard, which is why export reads through a single `user.findUnique` include tree (User is not tenant-scoped; the middleware's per-model assertions don't fire on nested includes) and anonymize writes per-row by unique id (`update`/`delete` are exempt actions by design). No middleware change, no bypass flag.
- Consents response excludes `ipAddress` (collected as evidence, not for display).
- Export: all sections (profile, memberships incl. org names, registrations incl. answers, attendance, consents, certificates with 300s signed URLs), audited `pdpa.export` (targetType User, organizationId null).
- Deletion: sole-president 409 guard ("Transfer presidency in <orgs>…"); the anonymize transaction — user fields (email → `deleted-<uuid>@anonymized.invalid`, fullName 'Deleted User', random argon2 passwordHash, mfaSecret null, deletedAt), membership PII nulled (studentId/faculty/programme/intake/phone/committeeHistory) with row/role/status retained for org statistics, registration answers nulled with rows retained, certificates hard-deleted (rows + storage objects, storage best-effort post-commit), refresh tokens revoked; ConsentRecords and Attendance untouched (consent records are compliance evidence). Audited `pdpa.delete` per org membership. Outstanding access JWTs valid ≤ TTL — accepted, login/refresh both dead.
- Idempotency: second `DELETE /me` in the token window → 204 no-op via `deletedAt` early-return.
- Update the "Audit actions captured" list in the audit-logs section: add `pdpa.export` and `pdpa.delete` (keep the list exhaustive — it was reviewed for exhaustiveness last phase).

- [ ] **Step 3: Verify and commit**

Re-read the inserted section against the code one more time (every route, value, and field name). Then:

```bash
git add docs/security.md
git commit -m "docs: sync security docs for PDPA"
```

---

## Self-review (done at plan time)

- Spec coverage: consent capture → T1; /me/consents + /me/export + export audit → T2; DELETE /me + 409 guard + idempotency → T3; docs → T4. Out-of-scope list requires no tasks. ✔
- Placeholders: none — every code step carries full code. ✔
- Type consistency: `PdpaService.consents/export/deleteAccount`, `PdpaController` handlers, `CURRENT_POLICY_VERSION` consistent across tasks. ✔
- Known live risk flagged to the implementer: the middleware-vs-`organizationId: null` audit query in T2 Step 1 uses `{ equals: null }` deliberately; if Prisma/middleware behavior differs at runtime, fall back to filtering by `actorUserId` + `action` only and asserting `organizationId` is null on the returned rows.
