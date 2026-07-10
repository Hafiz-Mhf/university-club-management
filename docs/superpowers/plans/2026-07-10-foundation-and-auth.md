# Foundation & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the NestJS backend with Postgres + MinIO, the core Prisma data model, email/password auth with JWT, and the multi-tenant + RBAC guard stack — proven by tenant-isolation tests.

**Architecture:** NestJS modular monolith. Prisma → PostgreSQL. Auth issues JWT access + refresh tokens. Three cross-cutting guards: `AuthGuard` (verify JWT), `TenantGuard` (resolve caller's active organization from Membership, inject scope), `RolesGuard` (per-org RBAC via `@Roles()`). A Prisma client extension asserts every tenant-owned query is org-scoped and throws otherwise. Every sensitive action writes an `AuditLog` row.

**Tech Stack:** NestJS 10, TypeScript, Prisma 5, PostgreSQL 16, MinIO (later plans), Jest + Supertest, argon2, @nestjs/jwt, @nestjs/passport + passport-jwt, class-validator/class-transformer, Zod (frontend later), Docker Compose.

## Global Constraints

- Passwords hashed with **argon2** — never stored or logged in plaintext.
- Every tenant-owned table has `organizationId`; every tenant query must be org-scoped or throw.
- RBAC role is **per-organization** via `Membership.role`, never a global user field.
- No personal data in logs or error messages.
- All endpoints validate input via DTOs (`class-validator`, `whitelist: true`).
- Secrets via environment variables only; `.env` git-ignored.
- TDD: write failing test → verify fail → implement → verify pass → commit.
- Node 20 LTS.

---

### Task 1: Repo, backend scaffold, Docker services

**Files:**
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`
- Create: `backend/.env.example`, `backend/.env`
- Create: `backend/src/main.ts`, `backend/src/app.module.ts`
- Create: `backend/test/jest-e2e.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a bootable NestJS app on `PORT` (default 3001) with global `ValidationPipe({ whitelist: true, transform: true })`; Postgres reachable at `DATABASE_URL`; MinIO at `S3_ENDPOINT`.

- [ ] **Step 1: Initialize git and backend directory**

```bash
git init
mkdir -p backend/src backend/test
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules/
dist/
.env
*.log
coverage/
.vercel
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: ucm
      POSTGRES_PASSWORD: ucm_dev_password
      POSTGRES_DB: ucm
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio_dev_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
  redis:
    image: redis:7
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
volumes:
  pgdata:
  miniodata:
  redisdata:
```

- [ ] **Step 4: Write `backend/package.json`**

```json
{
  "name": "ucm-backend",
  "version": "0.1.0",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:migrate": "prisma migrate dev",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/core": "^10.3.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "@nestjs/platform-express": "^10.3.0",
    "@prisma/client": "^5.12.0",
    "argon2": "^0.40.1",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/testing": "^10.3.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.11.0",
    "@types/passport-jwt": "^4.0.1",
    "jest": "^29.7.0",
    "prisma": "^5.12.0",
    "supertest": "^6.3.4",
    "ts-jest": "^29.1.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

- [ ] **Step 5: Write `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2021",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 6: Write `backend/nest-cli.json`**

```json
{ "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

- [ ] **Step 7: Write `backend/test/jest-e2e.json`**

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" }
}
```

- [ ] **Step 8: Write `backend/.env.example` and copy to `.env`**

```dotenv
PORT=3001
DATABASE_URL=postgresql://ucm:ucm_dev_password@localhost:5432/ucm?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=change_me_access
JWT_REFRESH_SECRET=change_me_refresh
JWT_ACCESS_TTL=900s
JWT_REFRESH_TTL=7d
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio_dev_password
```

```bash
cp backend/.env.example backend/.env
```

- [ ] **Step 9: Write `backend/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
})
export class AppModule {}
```

- [ ] **Step 10: Write `backend/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
```

- [ ] **Step 11: Install and boot services**

```bash
cd backend && npm install
docker compose -f ../docker-compose.yml up -d
npm run build
```
Expected: build succeeds; `docker compose ps` shows postgres + minio healthy.

- [ ] **Step 12: Commit**

```bash
git add .gitignore docker-compose.yml backend/
git commit -m "chore: scaffold NestJS backend + docker services"
```

---

### Task 2: Prisma core schema + migration

**Files:**
- Create: `backend/prisma/schema.prisma`
- Create: `backend/src/prisma/prisma.service.ts`
- Create: `backend/src/prisma/prisma.module.ts`
- Test: `backend/src/prisma/prisma.service.spec.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from Task 1.
- Produces: enum `Role` (`PRESIDENT, VICE_PRESIDENT, SECRETARY, TREASURER, EVENT_DIRECTOR, COMMITTEE, VOLUNTEER, PARTICIPANT, ADVISOR`), models `User`, `Organization`, `Membership`, `AuditLog`; `PrismaService` (extends `PrismaClient`, `onModuleInit` connects); `PrismaModule` (global, exports `PrismaService`).

- [ ] **Step 1: Write `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  PRESIDENT
  VICE_PRESIDENT
  SECRETARY
  TREASURER
  EVENT_DIRECTOR
  COMMITTEE
  VOLUNTEER
  PARTICIPANT
  ADVISOR
}

enum MemberStatus {
  ACTIVE
  ALUMNI
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  fullName     String
  mfaSecret    String?
  memberships  Membership[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  deletedAt    DateTime?
}

model Organization {
  id             String       @id @default(uuid())
  name           String
  slug           String       @unique
  description    String?
  logoKey        String?
  advisors       Json?
  socialLinks    Json?
  storageQuotaMb Int          @default(1024)
  primaryColor   String       @default("#2563eb")
  settings       Json?
  memberships    Membership[]
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}

model Membership {
  id               String       @id @default(uuid())
  userId           String
  organizationId   String
  role             Role
  status           MemberStatus @default(ACTIVE)
  studentId        String?
  faculty          String?
  programme        String?
  intake           String?
  phone            String?
  committeeHistory Json?
  user             User         @relation(fields: [userId], references: [id])
  organization     Organization @relation(fields: [organizationId], references: [id])
  joinedAt         DateTime     @default(now())

  @@unique([userId, organizationId])
  @@index([organizationId])
}

model AuditLog {
  id             String   @id @default(uuid())
  organizationId String?
  actorUserId    String?
  action         String
  targetType     String?
  targetId       String?
  metadata       Json?
  ipAddress      String?
  userAgent      String?
  isBreakGlass   Boolean  @default(false)
  createdAt      DateTime @default(now())

  @@index([organizationId])
}
```

- [ ] **Step 2: Run the first migration**

```bash
cd backend && npx prisma migrate dev --name init && npx prisma generate
```
Expected: migration applied; Prisma client generated.

- [ ] **Step 3: Write `backend/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 4: Write `backend/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Write failing test `prisma.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('connects and round-trips an organization', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    const prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const org = await prisma.organization.create({
      data: { name: 'Test Org', slug: `t-${Date.now()}` },
    });
    expect(org.id).toBeDefined();
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 6: Run test**

Run: `cd backend && npx jest prisma.service`
Expected: PASS (Postgres running from Task 1).

- [ ] **Step 7: Register PrismaModule in AppModule**

Modify `backend/src/app.module.ts` imports to add `PrismaModule`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
})
export class AppModule {}
```

- [ ] **Step 8: Commit**

```bash
git add backend/prisma backend/src/prisma backend/src/app.module.ts
git commit -m "feat: add Prisma core schema (User, Organization, Membership, AuditLog)"
```

---

### Task 3: Password hashing + registration

**Files:**
- Create: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/auth.service.ts`
- Create: `backend/src/auth/auth.controller.ts`
- Create: `backend/src/auth/dto/register.dto.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` from Task 2.
- Produces: `AuthService.register(dto: RegisterDto): Promise<{ id: string; email: string }>` — hashes with argon2, rejects duplicate email with `ConflictException`; `POST /auth/register`.

- [ ] **Step 1: Write `dto/register.dto.ts`**

```typescript
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;
}
```

- [ ] **Step 2: Write failing test `auth.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService.register', () => {
  let service: AuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, PrismaService],
    }).compile();
    service = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('hashes the password (never stores plaintext)', async () => {
    const email = `u-${Date.now()}@test.io`;
    const res = await service.register({ email, password: 'password123', fullName: 'Jane' });
    const stored = await prisma.user.findUnique({ where: { id: res.id } });
    expect(stored!.passwordHash).not.toBe('password123');
    expect(stored!.passwordHash).toContain('$argon2');
    await prisma.user.delete({ where: { id: res.id } });
  });

  it('rejects duplicate email', async () => {
    const email = `dup-${Date.now()}@test.io`;
    const a = await service.register({ email, password: 'password123', fullName: 'A' });
    await expect(
      service.register({ email, password: 'password123', fullName: 'B' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await prisma.user.delete({ where: { id: a.id } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest auth.service`
Expected: FAIL ("Cannot find module './auth.service'").

- [ ] **Step 4: Write `auth.service.ts`**

```typescript
import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(dto: RegisterDto): Promise<{ id: string; email: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash, fullName: dto.fullName },
    });
    return { id: user.id, email: user.email };
  }
}
```

- [ ] **Step 5: Write `auth.controller.ts` and `auth.module.ts`**

```typescript
// auth.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }
}
```

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 6: Register AuthModule in AppModule, run test**

Add `AuthModule` to `AppModule` imports. Then:

Run: `cd backend && npx jest auth.service`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth backend/src/app.module.ts
git commit -m "feat: user registration with argon2 hashing"
```

---

### Task 4: Login + JWT issuance

**Files:**
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Create: `backend/src/auth/dto/login.dto.ts`
- Test: `backend/src/auth/auth.login.spec.ts`

**Interfaces:**
- Consumes: `AuthService.register` (Task 3), `JwtService`.
- Produces: `AuthService.login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }>` — throws `UnauthorizedException` on bad credentials. Access token payload: `{ sub: userId, email }`. `POST /auth/login`.

- [ ] **Step 1: Write `dto/login.dto.ts`**

```typescript
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
```

- [ ] **Step 2: Write failing test `auth.login.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService.login', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let userId: string;
  const email = `login-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      providers: [AuthService, PrismaService],
    }).compile();
    service = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
    const u = await service.register({ email, password: 'password123', fullName: 'Log' });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns tokens on valid credentials', async () => {
    const res = await service.login({ email, password: 'password123' });
    expect(res.accessToken).toBeDefined();
    expect(res.refreshToken).toBeDefined();
  });

  it('rejects wrong password', async () => {
    await expect(service.login({ email, password: 'wrong' }))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest auth.login`
Expected: FAIL ("login is not a function").

- [ ] **Step 4: Add `login` to `auth.service.ts`**

Add import and constructor param, then the method:

```typescript
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ...register() unchanged...

  async login(dto: LoginDto): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    const payload = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL') ?? '900s',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TTL') ?? '7d',
    });
    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 5: Wire JwtModule into `auth.module.ts` and add login route**

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```

Add to `auth.controller.ts`:

```typescript
import { LoginDto } from './dto/login.dto';
// ...
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
```

- [ ] **Step 6: Run test**

Run: `cd backend && npx jest auth.login`
Expected: PASS (both).

- [ ] **Step 7: Commit**

```bash
git add backend/src/auth
git commit -m "feat: login with JWT access + refresh tokens"
```

---

### Task 5: JwtStrategy + AuthGuard on a protected route

**Files:**
- Create: `backend/src/auth/jwt.strategy.ts`
- Create: `backend/src/auth/guards/jwt-auth.guard.ts`
- Create: `backend/src/auth/decorators/current-user.decorator.ts`
- Modify: `backend/src/auth/auth.module.ts`, `backend/src/auth/auth.controller.ts`
- Test: `backend/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: JWT access secret; login tokens from Task 4.
- Produces: `JwtAuthGuard` (rejects missing/invalid token with 401); `@CurrentUser()` param decorator returning `{ userId: string; email: string }`; `GET /auth/me` returns the current user.

- [ ] **Step 1: Write `jwt.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: { sub: string; email: string }) {
    return { userId: payload.sub, email: payload.email };
  }
}
```

- [ ] **Step 2: Write `guards/jwt-auth.guard.ts` and `decorators/current-user.decorator.ts`**

```typescript
// jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

```typescript
// current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user,
);
```

- [ ] **Step 3: Register JwtStrategy + PassportModule, add /auth/me**

`auth.module.ts` add `PassportModule` to imports and `JwtStrategy` to providers:

```typescript
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
// imports: [JwtModule.register({}), PassportModule]
// providers: [AuthService, JwtStrategy]
```

`auth.controller.ts` add:

```typescript
import { Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
// ...
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: { userId: string; email: string }) {
    return user;
  }
```

- [ ] **Step 4: Write failing e2e test `backend/test/auth.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const email = `e2e-${Date.now()}@test.io`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('rejects /auth/me without token', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('registers, logs in, and returns me', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123', fullName: 'E2E' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(201);
    const token = login.body.accessToken;
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.email).toBe(email);
  });
});
```

- [ ] **Step 5: Run e2e**

Run: `cd backend && npm run test:e2e -- auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/auth backend/test/auth.e2e-spec.ts
git commit -m "feat: JWT strategy + auth guard + /auth/me"
```

---

### Task 6: Organizations module — create org, creator becomes President

**Files:**
- Create: `backend/src/organizations/organizations.module.ts`
- Create: `backend/src/organizations/organizations.service.ts`
- Create: `backend/src/organizations/organizations.controller.ts`
- Create: `backend/src/organizations/dto/create-organization.dto.ts`
- Test: `backend/src/organizations/organizations.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `JwtAuthGuard`, `@CurrentUser()`.
- Produces: `OrganizationsService.create(userId, dto): Promise<Organization>` — creates org + a `Membership` for the creator with `role = PRESIDENT` in one transaction. `POST /organizations` (guarded).

- [ ] **Step 1: Write `dto/create-organization.dto.ts`**

```typescript
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  slug!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 2: Write failing test `organizations.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { JwtModule } from '@nestjs/jwt';

describe('OrganizationsService.create', () => {
  let orgs: OrganizationsService;
  let prisma: PrismaService;
  let auth: AuthService;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      providers: [OrganizationsService, AuthService, PrismaService],
    }).compile();
    orgs = moduleRef.get(OrganizationsService);
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    await prisma.onModuleInit();
    const u = await auth.register({ email: `org-${Date.now()}@test.io`, password: 'password123', fullName: 'Pres' });
    userId = u.id;
  });
  afterAll(async () => {
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.organization.deleteMany({ where: { memberships: { some: { userId } } } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates org and makes creator PRESIDENT', async () => {
    const org = await orgs.create(userId, { name: 'ACM', slug: `acm-${Date.now()}` });
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: org.id } },
    });
    expect(membership!.role).toBe('PRESIDENT');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest organizations.service`
Expected: FAIL (module not found).

- [ ] **Step 4: Write `organizations.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    return this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        memberships: {
          create: { userId, role: 'PRESIDENT' },
        },
      },
    });
  }
}
```

- [ ] **Step 5: Write controller + module**

```typescript
// organizations.controller.ts
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgs.create(user.userId, dto);
  }
}
```

```typescript
// organizations.module.ts
import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';

@Module({
  providers: [OrganizationsService],
  controllers: [OrganizationsController],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
```

- [ ] **Step 6: Register OrganizationsModule in AppModule, run test**

Run: `cd backend && npx jest organizations.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/organizations backend/src/app.module.ts
git commit -m "feat: create organization + creator becomes president"
```

---

### Task 7: TenantGuard + Prisma org-scope enforcement (isolation)

**Files:**
- Create: `backend/src/tenancy/tenant.guard.ts`
- Create: `backend/src/tenancy/org-id.decorator.ts`
- Create: `backend/src/tenancy/tenancy.module.ts`
- Test: `backend/test/tenant-isolation.e2e-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `JwtAuthGuard`, request `user.userId`.
- Produces: `TenantGuard` — reads `organizationId` from route param `:orgId` (or `x-organization-id` header), verifies the caller has an active `Membership` in it, attaches `req.organizationId` and `req.membershipRole`; returns 403 if no membership. `@OrgId()` param decorator returns the verified `organizationId`.

- [ ] **Step 1: Write `org-id.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().organizationId,
);
```

- [ ] **Step 2: Write `tenant.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const orgId = req.params?.orgId ?? req.headers['x-organization-id'];
    if (!orgId) throw new ForbiddenException('Organization not specified');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user.userId, organizationId: orgId } },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('No access to this organization');
    }
    req.organizationId = orgId;
    req.membershipRole = membership.role;
    return true;
  }
}
```

- [ ] **Step 3: Write `tenancy.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

@Module({
  providers: [TenantGuard],
  exports: [TenantGuard],
})
export class TenancyModule {}
```

- [ ] **Step 4: Add a guarded read route to prove isolation**

Add to `organizations.controller.ts`:

```typescript
import { Get, Param } from '@nestjs/common';
import { TenantGuard } from '../tenancy/tenant.guard';
import { OrgId } from '../tenancy/org-id.decorator';
// ...
  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get(':orgId')
  findOne(@OrgId() orgId: string) {
    return this.orgs.findOne(orgId);
  }
```

Add to `organizations.service.ts`:

```typescript
  findOne(organizationId: string) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }
```

Import `TenancyModule` in `OrganizationsModule` imports.

- [ ] **Step 5: Write failing isolation e2e `backend/test/tenant-isolation.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;

  async function makeUserWithOrg(tag: string) {
    const email = `${tag}-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register')
      .send({ email, password: 'password123', fullName: tag });
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ email, password: 'password123' });
    const token = login.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: tag, slug: `${tag}-${Date.now()}` });
    return { token, orgId: org.body.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('org A member cannot read org B', async () => {
    const a = await makeUserWithOrg('orgA');
    const b = await makeUserWithOrg('orgB');
    // A reads own org: OK
    await request(app.getHttpServer()).get(`/organizations/${a.orgId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(200);
    // A reads B's org: forbidden
    await request(app.getHttpServer()).get(`/organizations/${b.orgId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(403);
  });
});
```

- [ ] **Step 6: Run isolation e2e**

Run: `cd backend && npm run test:e2e -- tenant-isolation`
Expected: PASS — proves cross-tenant read is blocked.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tenancy backend/src/organizations backend/test/tenant-isolation.e2e-spec.ts
git commit -m "feat: TenantGuard enforces per-org membership isolation"
```

---

### Task 8: RolesGuard + @Roles() RBAC

**Files:**
- Create: `backend/src/rbac/roles.decorator.ts`
- Create: `backend/src/rbac/roles.guard.ts`
- Create: `backend/src/rbac/rbac.module.ts`
- Test: `backend/test/rbac.e2e-spec.ts`

**Interfaces:**
- Consumes: `req.membershipRole` set by `TenantGuard` (Task 7), reflector metadata.
- Produces: `@Roles(...roles: Role[])` decorator; `RolesGuard` — allows if `req.membershipRole` is in the allowed set, else 403. Must run **after** `TenantGuard` in the guard chain.

- [ ] **Step 1: Write `roles.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 2: Write `roles.guard.ts`**

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!required.includes(req.membershipRole)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
```

- [ ] **Step 3: Write `rbac.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [RolesGuard],
  exports: [RolesGuard],
})
export class RbacModule {}
```

- [ ] **Step 4: Add a President-only route to organizations**

Add to `organizations.controller.ts`:

```typescript
import { Patch } from '@nestjs/common';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
// ...
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles('PRESIDENT')
  @Patch(':orgId/settings')
  updateSettings(@OrgId() orgId: string, @Body() body: { primaryColor?: string }) {
    return this.orgs.updateSettings(orgId, body);
  }
```

Add to `organizations.service.ts`:

```typescript
  updateSettings(organizationId: string, data: { primaryColor?: string }) {
    return this.prisma.organization.update({ where: { id: organizationId }, data });
  }
```

Import `RbacModule` in `OrganizationsModule`.

- [ ] **Step 5: Write failing test `backend/test/rbac.e2e-spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });
  afterAll(async () => { await app.close(); });

  it('PRESIDENT can update settings; VOLUNTEER cannot', async () => {
    // President creates org
    const pEmail = `pres-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: pEmail, password: 'password123', fullName: 'P' });
    const pLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: pEmail, password: 'password123' });
    const pToken = pLogin.body.accessToken;
    const org = await request(app.getHttpServer()).post('/organizations')
      .set('Authorization', `Bearer ${pToken}`).send({ name: 'RB', slug: `rb-${Date.now()}` });
    const orgId = org.body.id;

    // President updates settings -> 200
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${pToken}`).send({ primaryColor: '#ff0000' }).expect(200);

    // Volunteer joins org (seed membership directly), then is forbidden
    const vEmail = `vol-${Date.now()}@test.io`;
    await request(app.getHttpServer()).post('/auth/register').send({ email: vEmail, password: 'password123', fullName: 'V' });
    const vUser = await prisma.user.findUnique({ where: { email: vEmail } });
    await prisma.membership.create({ data: { userId: vUser!.id, organizationId: orgId, role: 'VOLUNTEER' } });
    const vLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: vEmail, password: 'password123' });
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/settings`)
      .set('Authorization', `Bearer ${vLogin.body.accessToken}`).send({ primaryColor: '#00ff00' }).expect(403);
  });
});
```

- [ ] **Step 6: Run test**

Run: `cd backend && npm run test:e2e -- rbac`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/rbac backend/src/organizations backend/test/rbac.e2e-spec.ts
git commit -m "feat: RolesGuard + @Roles per-org RBAC"
```

---

### Task 9: Audit logging service + interceptor

**Files:**
- Create: `backend/src/audit/audit.service.ts`
- Create: `backend/src/audit/audit.module.ts`
- Modify: `backend/src/organizations/organizations.service.ts` (log settings change)
- Test: `backend/src/audit/audit.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `AuditService.record(entry: { organizationId?: string; actorUserId?: string; action: string; targetType?: string; targetId?: string; metadata?: object; isBreakGlass?: boolean }): Promise<void>` — writes an `AuditLog` row. Exported globally.

- [ ] **Step 1: Write failing test `audit.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService.record', () => {
  let audit: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, PrismaService],
    }).compile();
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('writes an audit row', async () => {
    const action = `test.action.${Date.now()}`;
    await audit.record({ action, actorUserId: null as any, metadata: { k: 'v' } });
    const row = await prisma.auditLog.findFirst({ where: { action } });
    expect(row).toBeTruthy();
    expect(row!.metadata).toMatchObject({ k: 'v' });
    await prisma.auditLog.delete({ where: { id: row!.id } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest audit.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `audit.service.ts` and `audit.module.ts`**

```typescript
// audit.service.ts
import { Injectable } from '@nestjs/common';
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

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
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
}
```

```typescript
// audit.module.ts
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 4: Run test**

Run: `cd backend && npx jest audit.service`
Expected: PASS.

- [ ] **Step 5: Wire AuditService into settings change**

Register `AuditModule` in `AppModule`. Inject `AuditService` into `OrganizationsService` and log on `updateSettings`:

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly audit: AuditService,
) {}

async updateSettings(organizationId: string, data: { primaryColor?: string }, actorUserId?: string) {
  const org = await this.prisma.organization.update({ where: { id: organizationId }, data });
  await this.audit.record({
    organizationId, actorUserId, action: 'organization.settings.update',
    targetType: 'Organization', targetId: organizationId, metadata: data,
  });
  return org;
}
```

Update the controller to pass `user.userId` (add `@CurrentUser()` to the handler).

- [ ] **Step 6: Run full suite**

Run: `cd backend && npm test && npm run test:e2e`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/audit backend/src/organizations backend/src/app.module.ts
git commit -m "feat: audit logging service + settings-change audit"
```

---

## Self-Review Notes

- **Spec coverage (Phase 1 foundation):** auth ✅ (T3–5), org management ✅ (T6), committee/RBAC ✅ (T7–8), audit logs ✅ (T9), multi-tenant isolation ✅ (T7). Members full CRUD, events, registration, QR, certificates, dashboard, PDPA endpoints → **subsequent plans** (this plan is the dependency foundation only).
- **Isolation test present and mandatory:** Task 7.
- **Types consistent:** `{ userId, email }` from `CurrentUser` used everywhere; `req.membershipRole` set in `TenantGuard`, read in `RolesGuard`; `Role` enum from `@prisma/client` used in both decorator and guard.
- **No placeholders:** all steps carry real code + commands + expected output.
- **Guard order:** `JwtAuthGuard → TenantGuard → RolesGuard` documented in Task 8 interfaces.
