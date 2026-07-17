# Consent-Versioned Re-Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `CURRENT_POLICY_VERSION` is bumped, hard-block any authenticated request from a user whose stored account consent is stale, except for a small exempt set of PDPA routes, until they explicitly re-consent.

**Architecture:** `JwtAuthGuard` (already applied on every authenticated controller) gains an overridden `canActivate()` that checks account-consent staleness via a small shared helper, skippable per-route/per-controller via a new `@SkipConsentCheck()` metadata decorator (same `Reflector` mechanism `RolesGuard` already uses). `PdpaController` is exempt wholesale and gains a new `POST /me/consent` endpoint to re-consent. `AuthService.issueTokens()` (shared by login/refresh) proactively reports staleness in its response.

**Tech Stack:** NestJS, Prisma/PostgreSQL, Jest + Supertest e2e.

## Global Constraints

- No new Prisma model or column — `ConsentRecord` already carries everything needed.
- `ConsentRecord` is user-scoped, not org-scoped; not in `TENANT_SCOPED_MODELS`, and this feature doesn't change that.
- `CURRENT_POLICY_VERSION` (`backend/src/pdpa/policy-version.ts`) stays a plain exported constant — no admin endpoint to change it, no DI wrapper.
- One commit per task. Full unit (`npm test`) + e2e (`npm run test:e2e`) suite must pass before each commit; current baseline is 101/101 unit, 321/321 e2e (verified 2026-07-17, `docker compose up -d` first if the stack has stopped).
- Tests simulate a "stale" user by directly backdating `ConsentRecord.policyVersion` via Prisma in the test — there's no way to change the real exported constant per-test, and this is the same idiom already used for storage-quota and feedback-window-expiry edge cases.
- New e2e coverage extends the existing `backend/test/pdpa.e2e-spec.ts` (new `describe` block) rather than a new file — this feature modifies existing PDPA-domain behavior (the same `ConsentRecord`/`CURRENT_POLICY_VERSION` that file's `signup consent` block already asserts on), not a new self-contained feature area.

---

### Task 1: `@SkipConsentCheck()` + `JwtAuthGuard` staleness check, `PdpaController` exempt

**Files:**
- Create: `backend/src/pdpa/consent-status.util.ts`
- Create: `backend/src/auth/decorators/skip-consent-check.decorator.ts`
- Modify: `backend/src/auth/guards/jwt-auth.guard.ts`
- Modify: `backend/src/pdpa/pdpa.controller.ts`
- Modify: `backend/test/pdpa.e2e-spec.ts`

**Interfaces:**
- Produces: `isAccountConsentStale(prisma: PrismaService, userId: string): Promise<boolean>` — Task 3's `AuthService` also calls this exact function. `SKIP_CONSENT_CHECK_KEY` / `SkipConsentCheck()` — usable on any future controller/handler.

- [ ] **Step 1: Write the failing e2e tests**

Add this `describe` block to the end of `backend/test/pdpa.e2e-spec.ts` (inside the existing top-level `describe('PDPA (e2e)', ...)`, as a sibling of `signup consent` and `consents and export` — it already has `app`, `prisma`, and `registerAndLogin` in scope):

```ts
  describe('consent-versioned re-prompt', () => {
    it('a freshly registered user is never blocked', async () => {
      const email = `pdpa-fresh-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(200);
    });

    it('blocks an authenticated request when the account consent is stale', async () => {
      const email = `pdpa-stale-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('PdpaController routes stay reachable while blocked', async () => {
      const email = `pdpa-blocked-pdpa-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      await request(app.getHttpServer()).get('/me/consents')
        .set('Authorization', `Bearer ${token}`).expect(200);
      await request(app.getHttpServer()).get('/me/export')
        .set('Authorization', `Bearer ${token}`).expect(200);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: FAIL — `blocks an authenticated request when the account consent is stale` fails (currently gets `200`, expects `403`); the other two pass already (no enforcement exists yet, so they're trivially true) but that's fine — the middle test is the one proving red before green.

- [ ] **Step 3: Create the shared staleness helper**

Create `backend/src/pdpa/consent-status.util.ts`:

```ts
import { PrismaService } from '../prisma/prisma.service';
import { CURRENT_POLICY_VERSION } from './policy-version';

export async function isAccountConsentStale(prisma: PrismaService, userId: string): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, purpose: 'account' },
    orderBy: { grantedAt: 'desc' },
  });
  return !latest || latest.policyVersion !== CURRENT_POLICY_VERSION;
}
```

- [ ] **Step 4: Create the `@SkipConsentCheck()` decorator**

Create `backend/src/auth/decorators/skip-consent-check.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const SKIP_CONSENT_CHECK_KEY = 'skipConsentCheck';
export const SkipConsentCheck = () => SetMetadata(SKIP_CONSENT_CHECK_KEY, true);
```

- [ ] **Step 5: Extend `JwtAuthGuard`**

Replace the full contents of `backend/src/auth/guards/jwt-auth.guard.ts` with:

```ts
import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { isAccountConsentStale } from '../../pdpa/consent-status.util';
import { SKIP_CONSENT_CHECK_KEY } from '../decorators/skip-consent-check.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authorized = (await super.canActivate(context)) as boolean;
    if (!authorized) return false;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CONSENT_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest();
    const stale = await isAccountConsentStale(this.prisma, req.user.userId);
    if (stale) throw new ForbiddenException('Account consent must be renewed');
    return true;
  }
}
```

- [ ] **Step 6: Exempt `PdpaController`**

In `backend/src/pdpa/pdpa.controller.ts`, add the import and class-level decorator:

```ts
import { Controller, Delete, Get, HttpCode, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipConsentCheck } from '../auth/decorators/skip-consent-check.decorator';
import { PdpaService } from './pdpa.service';

// User-level PDPA routes: cross-org by design, so no TenantGuard/RolesGuard.
// Exempt from the consent-staleness check (SkipConsentCheck) — a user who
// doesn't want to accept a new policy must still be able to see their
// consent history, export their data, or delete their account and leave.
@Controller('me')
@UseGuards(JwtAuthGuard)
@SkipConsentCheck()
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

  @Delete()
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: { userId: string }) {
    return this.pdpa.deleteAccount(user.userId);
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: PASS, all tests in the file green (including the 3 new ones).

- [ ] **Step 8: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS. This step is the highest-risk point in this feature — `JwtAuthGuard` runs on every authenticated route in the app, so a mistake here would surface as failures scattered across many unrelated e2e files, not just `pdpa.e2e-spec.ts`. A fully green full-suite run is the real verification, not just the targeted one.

```bash
git add backend/src/pdpa/consent-status.util.ts backend/src/auth/decorators/skip-consent-check.decorator.ts backend/src/auth/guards/jwt-auth.guard.ts backend/src/pdpa/pdpa.controller.ts backend/test/pdpa.e2e-spec.ts
git commit -m "feat: hard-block stale account consent via JwtAuthGuard, PdpaController exempt"
```

---

### Task 2: `POST /me/consent` — re-consent endpoint

**Files:**
- Modify: `backend/src/pdpa/pdpa.service.ts`
- Modify: `backend/src/pdpa/pdpa.controller.ts`
- Modify: `backend/test/pdpa.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 directly (this task adds the *cure*; Task 1 added the block).
- Produces: `PdpaService.renewConsent(userId: string, ipAddress: string | undefined): Promise<{id, purpose, policyVersion, grantedAt}>` — matches the item shape `PdpaService.consents()` already returns.

- [ ] **Step 1: Write the failing e2e test**

Add this test inside the `consent-versioned re-prompt` describe block in `backend/test/pdpa.e2e-spec.ts` (after the three from Task 1):

```ts
    it('POST /me/consent unblocks a stale user and audits pdpa.consent.renew', async () => {
      const email = `pdpa-renew-${Date.now()}@test.io`;
      const token = await registerAndLogin(email);
      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });
      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(403);

      const res = await request(app.getHttpServer()).post('/me/consent')
        .set('Authorization', `Bearer ${token}`).expect(201);
      expect(res.body.purpose).toBe('account');
      expect(res.body.policyVersion).toBe('v1');

      await request(app.getHttpServer()).get('/organizations')
        .set('Authorization', `Bearer ${token}`).expect(200);

      const auditRows = await prisma.auditLog.findMany({
        where: { actorUserId: user!.id, action: 'pdpa.consent.renew' },
      });
      expect(auditRows).toHaveLength(1);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: FAIL — `POST /me/consent` doesn't exist yet (404).

- [ ] **Step 3: Add `renewConsent` to `PdpaService`**

In `backend/src/pdpa/pdpa.service.ts`, add the import and method:

```ts
import { CURRENT_POLICY_VERSION } from './policy-version';
```

```ts
  async renewConsent(userId: string, ipAddress: string | undefined) {
    const record = await this.prisma.consentRecord.create({
      data: { userId, purpose: 'account', policyVersion: CURRENT_POLICY_VERSION, ipAddress },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'pdpa.consent.renew',
      targetType: 'User',
      targetId: userId,
    });
    return { id: record.id, purpose: record.purpose, policyVersion: record.policyVersion, grantedAt: record.grantedAt };
  }
```

- [ ] **Step 4: Add the `POST /me/consent` route**

Replace the full contents of `backend/src/pdpa/pdpa.controller.ts` with:

```ts
import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkipConsentCheck } from '../auth/decorators/skip-consent-check.decorator';
import { PdpaService } from './pdpa.service';

// User-level PDPA routes: cross-org by design, so no TenantGuard/RolesGuard.
// Exempt from the consent-staleness check (SkipConsentCheck) — a user who
// doesn't want to accept a new policy must still be able to see their
// consent history, export their data, delete their account, or renew
// consent itself, without being trapped by the very check this endpoint cures.
@Controller('me')
@UseGuards(JwtAuthGuard)
@SkipConsentCheck()
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

  @Post('consent')
  renewConsent(@CurrentUser() user: { userId: string }, @Req() req: Request) {
    return this.pdpa.renewConsent(user.userId, req.ip);
  }

  @Delete()
  @HttpCode(204)
  deleteAccount(@CurrentUser() user: { userId: string }) {
    return this.pdpa.deleteAccount(user.userId);
  }
}
```

Note: `@Body()` import is unused by this controller currently, but harmless to leave out — this file has no route taking a body, so the import list above intentionally omits `Body`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add backend/src/pdpa/pdpa.service.ts backend/src/pdpa/pdpa.controller.ts backend/test/pdpa.e2e-spec.ts
git commit -m "feat: POST /me/consent — re-consent endpoint, audited"
```

---

### Task 3: `consentStale` flag on login/refresh

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/test/pdpa.e2e-spec.ts`

**Interfaces:**
- Consumes: `isAccountConsentStale(prisma, userId)` from Task 1.
- Produces: `AuthService.login()`/`AuthService.refresh()` return type gains `consentStale: boolean`.

- [ ] **Step 1: Write the failing e2e test**

Add this test inside the `consent-versioned re-prompt` describe block in `backend/test/pdpa.e2e-spec.ts` (after the Task 2 test):

```ts
    it('login and refresh responses reflect consentStale', async () => {
      const email = `pdpa-flag-${Date.now()}@test.io`;
      await request(app.getHttpServer()).post('/auth/register')
        .send({ email, password: 'password123', fullName: email, consent: true });
      const freshLogin = await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(201);
      expect(freshLogin.body.consentStale).toBe(false);

      const user = await prisma.user.findUnique({ where: { email } });
      await prisma.consentRecord.updateMany({
        where: { userId: user!.id, purpose: 'account' },
        data: { policyVersion: 'v0-old' },
      });

      const staleLogin = await request(app.getHttpServer()).post('/auth/login')
        .send({ email, password: 'password123' }).expect(201);
      expect(staleLogin.body.consentStale).toBe(true);

      const refreshRes = await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: staleLogin.body.refreshToken }).expect(201);
      expect(refreshRes.body.consentStale).toBe(true);
    });
```

(`CURRENT_POLICY_VERSION` is imported for potential future use in this describe block but not strictly required by this specific assertion — `toBe(true)`/`toBe(false)` are enough. Keep the import since Step 3's test in Task 2 already hardcodes `'v1'`, and importing the real constant here documents the connection for whoever edits this file next.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: FAIL — `consentStale` is `undefined` on both login responses (not yet added to the response shape).

- [ ] **Step 3: Add the flag to `AuthService`**

In `backend/src/auth/auth.service.ts`, add the import:

```ts
import { isAccountConsentStale } from '../pdpa/consent-status.util';
```

Change the three method signatures/bodies:

```ts
  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string; consentStale: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return this.issueTokens({ id: user.id, email: user.email });
  }

  private async issueTokens(user: { id: string; email: string }) {
    const payload = { sub: user.id, email: user.email };
    const accessTtl = this.config.get('JWT_ACCESS_TTL') ?? '900s';
    const refreshTtl = this.config.get('JWT_REFRESH_TTL') ?? '7d';
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: accessTtl,
    });
    // jti ensures uniqueness even if two tokens are signed for the same
    // user within the same second (iat has only second-level resolution).
    const refreshToken = await this.jwt.signAsync(
      { ...payload, jti: randomUUID() },
      { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: refreshTtl },
    );
    await this.refreshTokens.create(
      user.id,
      sha256(refreshToken),
      this.refreshExpiryDate(refreshTtl),
    );
    const consentStale = await isAccountConsentStale(this.prisma, user.id);
    return { accessToken, refreshToken, consentStale };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; consentStale: boolean }> {
    let payload: { sub: string; email: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const active = await this.refreshTokens.findActiveByHash(sha256(refreshToken));
    if (!active) throw new UnauthorizedException('Invalid refresh token');
    await this.refreshTokens.revoke(active.id); // rotate: kill the old one
    return this.issueTokens({ id: payload.sub, email: payload.email });
  }
```

(Only the `login`/`issueTokens`/`refresh` signatures and `issueTokens`'s final two lines change; `register`, `logout`, and `refreshExpiryDate` are untouched.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm run test:e2e -- pdpa`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS (101 unit unchanged; 321 + 5 new e2e = 326 e2e).

```bash
git add backend/src/auth/auth.service.ts backend/test/pdpa.e2e-spec.ts
git commit -m "feat: consentStale flag on login/refresh responses"
```

---

## Post-plan: roadmap note

Once merged, this is the tenth and final Phase 2 roadmap item shipped. No Phase 2 items remain on `docs/roadmap.md`.
