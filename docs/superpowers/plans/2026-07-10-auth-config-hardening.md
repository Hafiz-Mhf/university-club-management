# Auth & Config Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deferred Phase-1 auth/config security debt — make the refresh token real (persisted, rotated, revocable) with `/auth/refresh` + `/auth/logout`, and fail fast at boot when required env vars (JWT secrets, DATABASE_URL) are missing or weak.

**Architecture:** Add a `RefreshToken` model storing only a SHA-256 hash of each issued refresh token (never the raw token). Login persists a refresh-token row and returns the raw JWT. `/auth/refresh` verifies the JWT refresh signature, matches its hash to a non-revoked non-expired row, then **rotates**: revokes the old row and issues a fresh access+refresh pair. `/auth/logout` revokes the presented refresh token. Config gets a Joi `validationSchema` so the app refuses to boot without valid secrets.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL, @nestjs/jwt, @nestjs/config + Joi, argon2 (already present), Node crypto (SHA-256), Jest + Supertest.

## Global Constraints

- Refresh tokens: store only `sha256(rawToken)` — never the raw token, never plaintext. Compare by hash.
- Rotation on every refresh: the old refresh token is revoked and a new pair issued (no reuse).
- A revoked or expired refresh token → `401 UnauthorizedException`, generic message.
- Reuse of an already-revoked token → 401 (do not issue new tokens).
- No personal data in logs or audit metadata.
- All endpoints validate input via DTOs (`class-validator`, global `ValidationPipe` already registered).
- Secrets via env only; app must fail fast at boot if `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, or `DATABASE_URL` is missing, and JWT secrets must be ≥ 16 chars.
- TDD: red → green → refactor. Node 20.
- Existing behavior preserved: `register`, `login` (still returns `{ accessToken, refreshToken }`), all guards, and the tenant/RBAC/audit tests must keep passing.

---

### Task 1: Fail-fast env validation (Joi schema)

**Files:**
- Modify: `backend/package.json` (add `joi`)
- Modify: `backend/src/app.module.ts`
- Create: `backend/src/config/env.validation.ts`
- Test: `backend/src/config/env.validation.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `envValidationSchema` (Joi `ObjectSchema`) requiring `DATABASE_URL` (string, required), `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (string, min 16, required), `JWT_ACCESS_TTL` (string, default `'900s'`), `JWT_REFRESH_TTL` (string, default `'7d'`), `PORT` (number, default 3001). Wired into `ConfigModule.forRoot({ validationSchema })` so boot throws on violation.

- [ ] **Step 1: Install joi**

Run: `cd backend && npm install joi`
Expected: joi added to dependencies.

- [ ] **Step 2: Write `src/config/env.validation.ts`**

```typescript
import * as Joi from 'joi';

// Fail-fast schema — ConfigModule throws at boot if these are missing/invalid.
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  PORT: Joi.number().default(3001),
}).unknown(true);
```

- [ ] **Step 3: Write failing test `src/config/env.validation.spec.ts`**

```typescript
import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'a'.repeat(16),
    JWT_REFRESH_SECRET: 'b'.repeat(16),
  };

  it('accepts a valid env and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid);
    expect(error).toBeUndefined();
    expect(value.JWT_ACCESS_TTL).toBe('900s');
    expect(value.PORT).toBe(3001);
  });

  it('rejects a missing JWT_ACCESS_SECRET', () => {
    const { error } = envValidationSchema.validate({
      ...valid,
      JWT_ACCESS_SECRET: undefined,
    });
    expect(error).toBeDefined();
  });

  it('rejects a too-short secret (< 16 chars)', () => {
    const { error } = envValidationSchema.validate({ ...valid, JWT_ACCESS_SECRET: 'short' });
    expect(error).toBeDefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npx jest env.validation`
Expected: FAIL ("Cannot find module './env.validation'").

- [ ] **Step 5: Wire schema into AppModule**

Modify `src/app.module.ts` — pass `validationSchema` to the existing `ConfigModule.forRoot`:

```typescript
import { envValidationSchema } from './config/env.validation';
// ...
ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: envValidationSchema,
}),
```

- [ ] **Step 6: Run test + full suite**

Run: `cd backend && npx jest env.validation && npx jest && npm run test:e2e`
Expected: env.validation 3/3 PASS; full unit + e2e still green (the live `.env` satisfies the schema — secrets are ≥16 chars).

- [ ] **Step 7: Commit**

```bash
git add backend/src/config backend/src/app.module.ts backend/package.json backend/package-lock.json
git commit -m "feat: fail-fast env validation for JWT secrets + DATABASE_URL"
```

---

### Task 2: RefreshToken model + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test: `backend/src/auth/refresh-token.repository.spec.ts`
- Create: `backend/src/auth/refresh-token.repository.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: Prisma model `RefreshToken { id, userId, tokenHash (unique), expiresAt, revokedAt?, createdAt }` with `@@index([userId])`; `RefreshTokenRepository` with `create(userId, tokenHash, expiresAt): Promise<void>`, `findActiveByHash(tokenHash): Promise<{ id, userId } | null>` (returns null if missing, revoked, or expired), `revoke(id): Promise<void>`, `revokeAllForUser(userId): Promise<void>`.

- [ ] **Step 1: Add the model to `schema.prisma`**

```prisma
model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  user      User      @relation(fields: [userId], references: [id])
  createdAt DateTime  @default(now())

  @@index([userId])
}
```

Add the back-relation to the `User` model:

```prisma
  refreshTokens RefreshToken[]
```

- [ ] **Step 2: Migrate**

Run: `cd backend && npx prisma migrate dev --name add_refresh_token && npx prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 3: Write failing test `refresh-token.repository.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { RefreshTokenRepository } from './refresh-token.repository';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';

describe('RefreshTokenRepository', () => {
  let repo: RefreshTokenRepository;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' }), ConfigModule.forRoot({ isGlobal: true })],
      providers: [RefreshTokenRepository, PrismaService, AuthService],
    }).compile();
    repo = moduleRef.get(RefreshTokenRepository);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `rt-${Date.now()}@test.io`, password: 'password123', fullName: 'RT' });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('finds an active token, and returns null once revoked', async () => {
    const hash = `hash-${Date.now()}`;
    await repo.create(userId, hash, new Date(Date.now() + 60000));
    const found = await repo.findActiveByHash(hash);
    expect(found?.userId).toBe(userId);
    await repo.revoke(found!.id);
    expect(await repo.findActiveByHash(hash)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const hash = `exp-${Date.now()}`;
    await repo.create(userId, hash, new Date(Date.now() - 1000));
    expect(await repo.findActiveByHash(hash)).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npx jest refresh-token.repository`
Expected: FAIL (module not found).

- [ ] **Step 5: Write `refresh-token.repository.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findActiveByHash(tokenHash: string): Promise<{ id: string; userId: string } | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now()) return null;
    return { id: row.id, userId: row.userId };
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
```

- [ ] **Step 6: Run test**

Run: `cd backend && npx jest refresh-token.repository`
Expected: PASS (both).

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/auth/refresh-token.repository.ts backend/src/auth/refresh-token.repository.spec.ts
git commit -m "feat: RefreshToken model + repository (hash-only, revocable)"
```

---

### Task 3: Persist refresh token on login (hash-only)

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/token.util.ts`
- Test: `backend/src/auth/auth.login-persist.spec.ts`

**Interfaces:**
- Consumes: `RefreshTokenRepository` (Task 2), `JwtService`, `ConfigService`.
- Produces: `sha256(value: string): string` in `token.util.ts`; `AuthService.login` now, after signing, persists `sha256(refreshToken)` via the repository with the refresh TTL as `expiresAt`. Return shape unchanged (`{ accessToken, refreshToken }`). A new private helper `issueTokens(user): Promise<{ accessToken, refreshToken }>` that signs both tokens AND persists the refresh hash — reused by Task 4.

- [ ] **Step 1: Write `token.util.ts`**

```typescript
import { createHash } from 'crypto';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
```

- [ ] **Step 2: Write failing test `auth.login-persist.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from './token.util';

describe('AuthService.login persists refresh hash', () => {
  let auth: AuthService;
  let prisma: PrismaService;
  let userId: string;
  const email = `lp-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({}), ConfigModule.forRoot({ isGlobal: true })],
      providers: [AuthService, RefreshTokenRepository, PrismaService],
    }).compile();
    auth = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const u = await auth.register({ email, password: 'password123', fullName: 'LP' });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('stores only the hash of the issued refresh token', async () => {
    const { refreshToken } = await auth.login({ email, password: 'password123' });
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(userId);
    // raw token must never be stored
    const raw = await prisma.refreshToken.findFirst({ where: { tokenHash: refreshToken } });
    expect(raw).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest auth.login-persist`
Expected: FAIL (no refresh row persisted yet — `row` is null).

- [ ] **Step 4: Refactor `auth.service.ts` — add `issueTokens`, persist on login**

Inject `RefreshTokenRepository`, add the helper, and call it from `login`. Parse the refresh TTL to an `expiresAt` with a small helper:

```typescript
import { RefreshTokenRepository } from './refresh-token.repository';
import { sha256 } from './token.util';
// constructor: add `private readonly refreshTokens: RefreshTokenRepository,`

private async issueTokens(user: { id: string; email: string }) {
  const payload = { sub: user.id, email: user.email };
  const accessTtl = this.config.get('JWT_ACCESS_TTL') ?? '900s';
  const refreshTtl = this.config.get('JWT_REFRESH_TTL') ?? '7d';
  const accessToken = await this.jwt.signAsync(payload, {
    secret: this.config.get('JWT_ACCESS_SECRET'),
    expiresIn: accessTtl,
  });
  const refreshToken = await this.jwt.signAsync(payload, {
    secret: this.config.get('JWT_REFRESH_SECRET'),
    expiresIn: refreshTtl,
  });
  await this.refreshTokens.create(
    user.id,
    sha256(refreshToken),
    this.refreshExpiryDate(refreshTtl),
  );
  return { accessToken, refreshToken };
}

// Converts a TTL like '7d' / '900s' / '30m' / '12h' to an absolute Date.
private refreshExpiryDate(ttl: string): Date {
  const m = /^(\d+)([smhd])$/.exec(ttl);
  const seconds = m
    ? parseInt(m[1], 10) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd']
    : 7 * 86400;
  return new Date(Date.now() + seconds * 1000);
}
```

Then change `login` to build tokens via the helper (keep the credential checks unchanged):

```typescript
async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
  if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
  const ok = await argon2.verify(user.passwordHash, dto.password);
  if (!ok) throw new UnauthorizedException('Invalid credentials');
  return this.issueTokens({ id: user.id, email: user.email });
}
```

- [ ] **Step 5: Register the repository as a provider**

In `auth.module.ts` add `RefreshTokenRepository` to `providers`.

- [ ] **Step 6: Run test + full suite**

Run: `cd backend && npx jest auth.login-persist && npx jest && npm run test:e2e`
Expected: new test PASS; existing auth/login/e2e tests still green (login return shape unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth
git commit -m "feat: persist hashed refresh token on login"
```

---

### Task 4: /auth/refresh (rotation) + /auth/logout (revocation)

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/dto/refresh.dto.ts`
- Test: `backend/test/auth-refresh.e2e-spec.ts`

**Interfaces:**
- Consumes: `issueTokens`, `RefreshTokenRepository`, `sha256`, `JwtService`, `ConfigService`.
- Produces: `AuthService.refresh(refreshToken): Promise<{ accessToken, refreshToken }>` — verifies the JWT refresh signature (`JWT_REFRESH_SECRET`), looks up `sha256(token)` as an active row, throws `UnauthorizedException` if invalid/expired/revoked, then revokes that row and issues a new pair (rotation). `AuthService.logout(refreshToken): Promise<void>` — revokes the matching active row (no error if already gone). `POST /auth/refresh` and `POST /auth/logout`, both taking `{ refreshToken }`.

- [ ] **Step 1: Write `dto/refresh.dto.ts`**

```typescript
import { IsString, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}
```

- [ ] **Step 2: Write failing e2e `backend/test/auth-refresh.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth refresh/logout (e2e)', () => {
  let app: INestApplication;
  const email = `rf-${Date.now()}@test.io`;

  async function login() {
    const res = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    return res.body.refreshToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: 'RF' });
  });
  afterAll(async () => { await app.close(); });

  it('rotates: refresh returns a new pair and old token stops working', async () => {
    const oldRt = await login();
    const refreshed = await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(201);
    expect(refreshed.body.accessToken).toBeDefined();
    expect(refreshed.body.refreshToken).toBeDefined();
    expect(refreshed.body.refreshToken).not.toBe(oldRt);
    // reuse of the rotated-away token is rejected
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: oldRt }).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const rt = await login();
    await request(app.getHttpServer()).post('/auth/logout')
      .send({ refreshToken: rt }).expect(201);
    await request(app.getHttpServer()).post('/auth/refresh')
      .send({ refreshToken: rt }).expect(401);
  });
});
```

- [ ] **Step 3: Run e2e to verify it fails**

Run: `cd backend && npm run test:e2e -- auth-refresh`
Expected: FAIL (404 on /auth/refresh — route not defined).

- [ ] **Step 4: Add `refresh` + `logout` to `auth.service.ts`**

```typescript
async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
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

async logout(refreshToken: string): Promise<void> {
  const active = await this.refreshTokens.findActiveByHash(sha256(refreshToken));
  if (active) await this.refreshTokens.revoke(active.id);
}
```

- [ ] **Step 5: Add routes to `auth.controller.ts`**

```typescript
import { HttpCode } from '@nestjs/common';
import { RefreshDto } from './dto/refresh.dto';
// ...
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(201)
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { success: true };
  }
```

- [ ] **Step 6: Run e2e + full suite**

Run: `cd backend && npm run test:e2e -- auth-refresh && npx jest && npm run test:e2e`
Expected: auth-refresh 2/2 PASS; whole suite green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth backend/test/auth-refresh.e2e-spec.ts
git commit -m "feat: /auth/refresh rotation + /auth/logout revocation"
```

---

## Self-Review Notes

- **Spec coverage:** deferred #4 (refresh rotation/revocation + endpoints) → Tasks 2-4; deferred #5 (env fail-fast validation) → Task 1. Both closed.
- **Hash-only storage:** enforced in `token.util.sha256` + repository; Task 3 test asserts the raw token is never stored.
- **Rotation + reuse rejection:** Task 4 e2e proves the old token 401s after refresh, and after logout.
- **No regressions:** every task runs the full unit + e2e suite before commit; login's return shape is unchanged so existing tests hold.
- **Types consistent:** `issueTokens(user: { id, email })`, `sha256(string): string`, `findActiveByHash → { id, userId } | null` used identically across Tasks 2-4.
- **Not overbuilt (YAGNI):** no device/session metadata, no refresh-token reuse-detection cascade (revoke-all-on-reuse) — noted as a future hardening option, not built now.
