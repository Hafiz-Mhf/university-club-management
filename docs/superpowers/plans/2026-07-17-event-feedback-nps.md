# Event Feedback + NPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let PRESENT attendees submit one NPS + rating survey per event, feed it into analytics, and let organizers optionally gate certificate release on that feedback.

**Architecture:** New `backend/src/feedback/` module owns submission/summary. `CertificateGenerationService` gains an `onlyWithFeedback` filter and a delayed BullMQ "window close" job on the existing `certificates` queue. `EventsService.complete()` branches on a new `Event.requireFeedbackForCertificate` flag to either cert everyone immediately (unchanged) or cert only feedback-submitters plus schedule the delayed fallback. `AnalyticsController` gains two read endpoints.

**Tech Stack:** NestJS, Prisma/PostgreSQL, BullMQ (existing `certificates` queue), class-validator, Jest + Supertest e2e.

## Global Constraints

- Every tenant-owned Prisma model carries `organizationId` and is added to `TENANT_SCOPED_MODELS` in `backend/src/prisma/tenant-scope.middleware.ts`.
- RBAC via `@Roles()` + `RolesGuard`, using role groups from `backend/src/rbac/role-groups.ts` — no ad hoc role checks.
- Every mutation calls `AuditService.record({...}, tx?)` with a dot-namespaced action name. Reads are never audited.
- DTOs validated with `class-validator`; global `ValidationPipe({ whitelist: true, transform: true })` is already wired in `main.ts`/test bootstraps.
- Prisma ids are `@default(uuid())` in this schema (not `cuid()`).
- One commit per task. Full unit (`npm test`) + e2e (`npm run test:e2e`) suite must pass before each commit; current baseline is 86/86 unit, 301/301 e2e (verified 2026-07-17, `docker compose up -d` required first if the stack has stopped).
- Committee-facing feedback summary/analytics must never include `userId` or submitter identity — aggregates and bare comment text only.

---

### Task 1: Schema + FeedbackModule scaffold — submit + `/me`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/prisma/tenant-scope.middleware.ts`
- Create: `backend/src/feedback/feedback.constants.ts`
- Create: `backend/src/feedback/dto/submit-feedback.dto.ts`
- Create: `backend/src/feedback/feedback.service.ts`
- Create: `backend/src/feedback/feedback.controller.ts`
- Create: `backend/src/feedback/feedback.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/feedback-submit.e2e-spec.ts`

**Interfaces:**
- Produces: `FeedbackService.submit(organizationId, eventId, userId, dto: SubmitFeedbackDto): Promise<FeedbackResponse>`, `FeedbackService.findMine(organizationId, eventId, userId): Promise<FeedbackResponse | null>`, `FEEDBACK_WINDOW_MS` (number, ms) exported from `feedback.constants.ts` — later tasks (3, 4) import this constant and extend this service.

- [ ] **Step 1: Add the `FeedbackResponse` model and `Event.requireFeedbackForCertificate` field to the schema**

In `backend/prisma/schema.prisma`, find the `Event` model (starts `model Event {`) and change it from:

```prisma
model Event {
  id              String       @id @default(uuid())
  organizationId  String
  title           String
  description     String?
  venue           String?
  startAt         DateTime
  endAt           DateTime
  capacity        Int?
  bannerKey       String?
  status          EventStatus  @default(DRAFT)
  createdByUserId String?
  organization    Organization @relation(fields: [organizationId], references: [id])
  registrationForm RegistrationForm?
  registrations    Registration[]
  attendances      Attendance[]
  certificates    Certificate[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId])
  @@index([organizationId, status])
}
```

to:

```prisma
model Event {
  id              String       @id @default(uuid())
  organizationId  String
  title           String
  description     String?
  venue           String?
  startAt         DateTime
  endAt           DateTime
  capacity        Int?
  bannerKey       String?
  status          EventStatus  @default(DRAFT)
  requireFeedbackForCertificate Boolean @default(false)
  createdByUserId String?
  organization    Organization @relation(fields: [organizationId], references: [id])
  registrationForm RegistrationForm?
  registrations    Registration[]
  attendances      Attendance[]
  certificates    Certificate[]
  feedbackResponses FeedbackResponse[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId])
  @@index([organizationId, status])
}
```

Find the `User` model and change it from:

```prisma
model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  fullName     String
  mfaSecret    String?
  memberships  Membership[]
  refreshTokens RefreshToken[]
  registrations   Registration[]
  consentRecords  ConsentRecord[]
  certificates    Certificate[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  deletedAt    DateTime?
}
```

to:

```prisma
model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  fullName     String
  mfaSecret    String?
  memberships  Membership[]
  refreshTokens RefreshToken[]
  registrations   Registration[]
  consentRecords  ConsentRecord[]
  certificates    Certificate[]
  feedbackResponses FeedbackResponse[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  deletedAt    DateTime?
}
```

Then add the new model right after the `Certificate` model (which ends just before `model OrgFile {`):

```prisma
model FeedbackResponse {
  id                 String   @id @default(uuid())
  eventId            String
  event              Event    @relation(fields: [eventId], references: [id])
  organizationId     String
  userId             String
  user               User     @relation(fields: [userId], references: [id])
  npsScore           Int
  contentRating      Int
  organizationRating Int
  venueRating        Int
  comment            String?
  createdAt          DateTime @default(now())

  @@unique([eventId, userId])
  @@index([organizationId])
}
```

This mirrors `Certificate`'s exact shape: `event`/`user` are real relations, `organizationId` is a flat scalar with no `Organization` relation (same as `Certificate`), and there's a single `@@index([organizationId])`.

- [ ] **Step 2: Run the migration**

Run: `cd backend && npx prisma migrate dev --name add_feedback_response_model`
Expected: migration applies cleanly, `prisma generate` runs automatically, no errors. Confirm with:
Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: no type errors (this only exercises the regenerated Prisma client against existing code — the new model isn't referenced yet).

- [ ] **Step 3: Add `FeedbackResponse` to `TENANT_SCOPED_MODELS`**

In `backend/src/prisma/tenant-scope.middleware.ts`, change:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes', 'Asset', 'GalleryPhoto', 'Achievement'];
```

to:

```ts
export const TENANT_SCOPED_MODELS: Prisma.ModelName[] = ['Membership', 'AuditLog', 'Event', 'Registration', 'Attendance', 'Certificate', 'OrgFile', 'MeetingMinutes', 'Asset', 'GalleryPhoto', 'Achievement', 'FeedbackResponse'];
```

- [ ] **Step 4: Write the failing e2e test for submit + `/me`**

Create `backend/test/feedback-submit.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Feedback submission (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let presToken: string;
  let orgId: string;
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
    presToken = await registerAndLogin(`fbsub-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbSubOrg', slug: `fbsub-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  async function createPublishedEvent(title: string) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title, startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id;
  }

  async function presentParticipant(eventId: string) {
    const email = `fbsub-p-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    return token;
  }

  const validFeedback = { npsScore: 9, contentRating: 5, organizationRating: 4, venueRating: 3, comment: 'Great event!' };

  it('a PRESENT attendee can submit feedback, and it is audited', async () => {
    const eventId = await createPublishedEvent('Feedback Event');
    const token = await presentParticipant(eventId);

    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);
    expect(res.body.npsScore).toBe(9);

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'feedback.submit', pageSize: 100 });
    expect(auditRows.body.data.some((r: { targetId: string }) => r.targetId === res.body.id)).toBe(true);
  });

  it('/feedback/me returns null before submission and the row after', async () => {
    const eventId = await createPublishedEvent('Me Event');
    const token = await presentParticipant(eventId);

    const before = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(before.body).toBeNull();

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);

    const after = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.npsScore).toBe(9);
  });

  it('403s a registrant who was never marked PRESENT', async () => {
    const eventId = await createPublishedEvent('No Attendance Event');
    const email = `fbsub-np-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(403);
  });

  it('409s a second submission from the same attendee for the same event', async () => {
    const eventId = await createPublishedEvent('Duplicate Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(201);

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(409);
  });

  it('403s once the 14-day feedback window has closed', async () => {
    const eventId = await createPublishedEvent('Expired Window Event');
    const token = await presentParticipant(eventId);
    await prisma.event.update({
      where: { id: eventId },
      data: { endAt: new Date(Date.now() - 15 * 86400000) },
    });

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send(validFeedback).expect(403);
  });

  it('400s on an out-of-range npsScore', async () => {
    const eventId = await createPublishedEvent('Invalid Score Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ ...validFeedback, npsScore: 11 }).expect(400);
  });

  it("cross-org isolation: org B member cannot submit feedback against org A's event", async () => {
    const otherToken = await registerAndLogin(`fbsub-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'FbSubIsoOrg', slug: `fbsub-iso-${Date.now()}` }).expect(201);

    const eventId = await createPublishedEvent('Isolation Event');
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${otherToken}`).send(validFeedback).expect(403);
  });
});
```

- [ ] **Step 5: Run the e2e test to verify it fails**

Run: `cd backend && npm run test:e2e -- feedback-submit`
Expected: FAIL — routes don't exist yet (404s), module not registered.

- [ ] **Step 6: Create the feedback constants, DTO, service, controller, and module**

Create `backend/src/feedback/feedback.constants.ts`:

```ts
export const FEEDBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
```

Create `backend/src/feedback/dto/submit-feedback.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitFeedbackDto {
  @IsInt() @Min(0) @Max(10) npsScore!: number;
  @IsInt() @Min(1) @Max(5) contentRating!: number;
  @IsInt() @Min(1) @Max(5) organizationRating!: number;
  @IsInt() @Min(1) @Max(5) venueRating!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}
```

Create `backend/src/feedback/feedback.service.ts`:

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { FEEDBACK_WINDOW_MS } from './feedback.constants';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(organizationId: string, eventId: string, userId: string, dto: SubmitFeedbackDto) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const attendance = await this.prisma.attendance.findFirst({
      where: { eventId, organizationId, registration: { userId }, status: 'PRESENT' },
    });
    if (!attendance) throw new ForbiddenException('Only attendees marked present can submit feedback');

    const windowCloses = new Date(event.endAt.getTime() + FEEDBACK_WINDOW_MS);
    if (new Date() > windowCloses) throw new ForbiddenException('Feedback window has closed for this event');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.feedbackResponse.create({
          data: {
            organizationId, eventId, userId,
            npsScore: dto.npsScore,
            contentRating: dto.contentRating,
            organizationRating: dto.organizationRating,
            venueRating: dto.venueRating,
            comment: dto.comment,
          },
        });
        await this.audit.record({
          organizationId, actorUserId: userId, action: 'feedback.submit',
          targetType: 'FeedbackResponse', targetId: created.id,
          metadata: { eventId, feedbackId: created.id },
        }, tx);
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Feedback already submitted for this event');
      }
      throw error;
    }
  }

  findMine(organizationId: string, eventId: string, userId: string) {
    return this.prisma.feedbackResponse.findFirst({ where: { eventId, organizationId, userId } });
  }
}
```

Create `backend/src/feedback/feedback.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';

@Controller('organizations/:orgId/events/:eventId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Post()
  submit(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.feedback.submit(orgId, eventId, user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.feedback.findMine(orgId, eventId, user.userId);
  }
}
```

Create `backend/src/feedback/feedback.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
```

- [ ] **Step 7: Register `FeedbackModule` in `AppModule`**

In `backend/src/app.module.ts`, add the import:

```ts
import { FeedbackModule } from './feedback/feedback.module';
```

and add `FeedbackModule` to the `imports` array, right after `CertificatesModule,`:

```ts
    CertificatesModule,
    FeedbackModule,
```

- [ ] **Step 8: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- feedback-submit`
Expected: PASS, all 7 tests green.

- [ ] **Step 9: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS (86 unit + previous e2e count + 7 new e2e tests).

```bash
git add backend/prisma backend/src/prisma/tenant-scope.middleware.ts backend/src/feedback backend/src/app.module.ts backend/test/feedback-submit.e2e-spec.ts
git commit -m "feat: FeedbackResponse model, submission + /me endpoints"
```

---

### Task 2: Committee-facing summary endpoint

**Files:**
- Modify: `backend/src/feedback/feedback.service.ts`
- Modify: `backend/src/feedback/feedback.controller.ts`
- Create: `backend/test/feedback-summary.e2e-spec.ts`

**Interfaces:**
- Consumes: `FeedbackService` from Task 1 (extends it in place).
- Produces: `FeedbackService.summary(organizationId, eventId): Promise<{ responseCount, avgNpsScore, avgContentRating, avgOrganizationRating, avgVenueRating, comments: string[] }>` — anonymized, no `userId` anywhere in the return shape.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/feedback-summary.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Feedback summary (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
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
    presToken = await registerAndLogin(`fbsum-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbSumOrg', slug: `fbsum-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  async function createPublishedEvent(title: string) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title, startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id;
  }

  async function presentParticipant(eventId: string) {
    const email = `fbsum-p-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    return token;
  }

  it('aggregates NPS + ratings across responses, without exposing any submitter identity', async () => {
    const eventId = await createPublishedEvent('Summary Event');
    const tokenA = await presentParticipant(eventId);
    const tokenB = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`).send({ npsScore: 10, contentRating: 5, organizationRating: 5, venueRating: 5, comment: 'Loved it' }).expect(201);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenB}`).send({ npsScore: 6, contentRating: 3, organizationRating: 3, venueRating: 3 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.responseCount).toBe(2);
    expect(res.body.avgNpsScore).toBe(8);
    expect(res.body.avgContentRating).toBe(4);
    expect(res.body.comments).toEqual(['Loved it']);
    expect(JSON.stringify(res.body)).not.toMatch(/userId/i);
  });

  it('403s a non-committee member (plain participant)', async () => {
    const eventId = await createPublishedEvent('Forbidden Summary Event');
    const token = await presentParticipant(eventId);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('cross-org isolation: org B president cannot view org A summary', async () => {
    const otherPresToken = await registerAndLogin(`fbsum-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'FbSumIsoOrg', slug: `fbsum-iso-${Date.now()}` }).expect(201);

    const eventId = await createPublishedEvent('Isolation Summary Event');
    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/feedback/summary`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `cd backend && npm run test:e2e -- feedback-summary`
Expected: FAIL — `/summary` route doesn't exist (404).

- [ ] **Step 3: Add `summary` to `FeedbackService`**

In `backend/src/feedback/feedback.service.ts`, add this method to the `FeedbackService` class, after `findMine`:

```ts
  async summary(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const responses = await this.prisma.feedbackResponse.findMany({
      where: { organizationId, eventId },
      select: { npsScore: true, contentRating: true, organizationRating: true, venueRating: true, comment: true },
    });

    const count = responses.length;
    const average = (values: number[]) => (count === 0 ? null : values.reduce((sum, v) => sum + v, 0) / count);

    return {
      responseCount: count,
      avgNpsScore: average(responses.map((r) => r.npsScore)),
      avgContentRating: average(responses.map((r) => r.contentRating)),
      avgOrganizationRating: average(responses.map((r) => r.organizationRating)),
      avgVenueRating: average(responses.map((r) => r.venueRating)),
      comments: responses.map((r) => r.comment).filter((c): c is string => c !== null),
    };
  }
```

- [ ] **Step 4: Add the `/summary` route to `FeedbackController`**

Replace the full contents of `backend/src/feedback/feedback.controller.ts` with:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/events/:eventId/feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Post()
  submit(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.feedback.submit(orgId, eventId, user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, TenantGuard)
  @Get('me')
  mine(@OrgId() orgId: string, @Param('eventId') eventId: string, @CurrentUser() user: { userId: string }) {
    return this.feedback.findMine(orgId, eventId, user.userId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('summary')
  summary(@OrgId() orgId: string, @Param('eventId') eventId: string) {
    return this.feedback.summary(orgId, eventId);
  }
}
```

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- feedback-summary`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add backend/src/feedback backend/test/feedback-summary.e2e-spec.ts
git commit -m "feat: anonymized committee feedback summary endpoint"
```

---

### Task 3: Certificate generation — `onlyWithFeedback` filter + delayed window-close job

**Files:**
- Modify: `backend/src/certificates/generation/certificate-generation.types.ts`
- Modify: `backend/src/certificates/generation/certificate-generation.service.ts`
- Modify: `backend/src/certificates/generation/certificate-generation.service.spec.ts`
- Modify: `backend/src/certificates/generation/certificate-generation.processor.ts`
- Modify: `backend/src/certificates/generation/certificate-generation.processor.spec.ts`

**Interfaces:**
- Consumes: `FEEDBACK_WINDOW_MS` from `backend/src/feedback/feedback.constants.ts` (Task 1).
- Produces: `CertificateGenerationService.enqueueBatchForEvent(organizationId, eventId, actorUserId, opts?: { onlyWithFeedback?: boolean }): Promise<void>` (extended signature — third positional arg unchanged, `opts` new and optional), `CertificateGenerationService.scheduleFeedbackWindowClose(organizationId, eventId, endAt: Date): Promise<Job>` — Task 4 (`EventsService.complete()`) and Task 1's `FeedbackService.submit()` (extended in Task 4) call these.

- [ ] **Step 1: Write the failing unit tests**

Replace the full contents of `backend/src/certificates/generation/certificate-generation.service.spec.ts` with:

```ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CertificateGenerationService } from './certificate-generation.service';
import { CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB, CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE, feedbackWindowCloseJobId } from './certificate-generation.types';

describe('CertificateGenerationService', () => {
  let service: CertificateGenerationService;
  let queue: { add: jest.Mock };
  let prisma: {
    attendance: { findMany: jest.Mock };
    certificate: { findMany: jest.Mock };
    feedbackResponse: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      certificate: { findMany: jest.fn().mockResolvedValue([]) },
      feedbackResponse: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificateGenerationService,
        { provide: getQueueToken(CERTIFICATE_QUEUE), useValue: queue },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(CertificateGenerationService);
  });

  it('enqueues one job per PRESENT attendee with no existing certificate', async () => {
    prisma.attendance.findMany.mockResolvedValue([
      { registration: { userId: 'u1' } },
      { registration: { userId: 'u2' } },
    ]);
    prisma.certificate.findMany.mockResolvedValue([]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u1', actorUserId: 'actor1' });
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u2', actorUserId: 'actor1' });
  });

  it('skips attendees who already have a certificate', async () => {
    prisma.attendance.findMany.mockResolvedValue([
      { registration: { userId: 'u1' } },
      { registration: { userId: 'u2' } },
    ]);
    prisma.certificate.findMany.mockResolvedValue([{ userId: 'u1' }]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u2', actorUserId: 'actor1' });
  });

  it('enqueues nothing when there are no PRESENT attendees', async () => {
    prisma.attendance.findMany.mockResolvedValue([]);
    await service.enqueueBatchForEvent('org1', 'event1', 'actor1');
    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.certificate.findMany).not.toHaveBeenCalled();
  });

  it('onlyWithFeedback: only enqueues attendees who also have a FeedbackResponse', async () => {
    prisma.attendance.findMany.mockResolvedValue([
      { registration: { userId: 'u1' } },
      { registration: { userId: 'u2' } },
    ]);
    prisma.feedbackResponse.findMany.mockResolvedValue([{ userId: 'u1' }]);
    prisma.certificate.findMany.mockResolvedValue([]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1', { onlyWithFeedback: true });

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(CERTIFICATE_GENERATE_JOB, { organizationId: 'org1', eventId: 'event1', userId: 'u1', actorUserId: 'actor1' });
  });

  it('onlyWithFeedback: enqueues nothing when no attendee has feedback yet', async () => {
    prisma.attendance.findMany.mockResolvedValue([{ registration: { userId: 'u1' } }]);
    prisma.feedbackResponse.findMany.mockResolvedValue([]);

    await service.enqueueBatchForEvent('org1', 'event1', 'actor1', { onlyWithFeedback: true });

    expect(queue.add).not.toHaveBeenCalled();
    expect(prisma.certificate.findMany).not.toHaveBeenCalled();
  });

  it('scheduleFeedbackWindowClose adds a delayed job keyed by event id', async () => {
    const endAt = new Date(Date.now() + 2 * 86400000);
    await service.scheduleFeedbackWindowClose('org1', 'event1', endAt);

    const call = queue.add.mock.calls[0];
    expect(call[0]).toBe(CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB);
    expect(call[1]).toEqual({ organizationId: 'org1', eventId: 'event1' });
    expect(call[2].jobId).toBe(feedbackWindowCloseJobId('event1'));
    expect(call[2].delay).toBeGreaterThan(0);
  });

  it('scheduleFeedbackWindowClose clamps delay to 0 when endAt + window is already in the past', async () => {
    const endAt = new Date(Date.now() - 20 * 86400000);
    await service.scheduleFeedbackWindowClose('org1', 'event1', endAt);

    const call = queue.add.mock.calls[0];
    expect(call[2].delay).toBe(0);
  });
});
```

Replace the full contents of `backend/src/certificates/generation/certificate-generation.processor.spec.ts` with:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateGenerationService } from './certificate-generation.service';
import { CertificateGenerationProcessor } from './certificate-generation.processor';
import { CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB, CERTIFICATE_GENERATE_JOB } from './certificate-generation.types';

function fakeJob(name: string, data: unknown) {
  return { id: 'job1', name, data } as any;
}

describe('CertificateGenerationProcessor', () => {
  let processor: CertificateGenerationProcessor;
  let prisma: {
    certificate: { findFirst: jest.Mock; aggregate: jest.Mock; create: jest.Mock };
    event: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let storage: { getObject: jest.Mock; putObject: jest.Mock };
  let pdf: { render: jest.Mock };
  let audit: { record: jest.Mock };
  let notifications: { enqueueCertificateReady: jest.Mock };
  let certificateGeneration: { enqueueBatchForEvent: jest.Mock };

  const jobPayload = { organizationId: 'org1', eventId: 'event1', userId: 'user1', actorUserId: 'actor1' };

  beforeEach(async () => {
    prisma = {
      certificate: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { fileSizeBytes: 0 } }),
        create: jest.fn().mockResolvedValue({ id: 'cert1' }),
      },
      event: { findUnique: jest.fn().mockResolvedValue({ title: 'Tech Talk', startAt: new Date() }) },
      organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Coding Club', logoKey: null, primaryColor: '#2563eb', storageQuotaMb: 1024 }) },
      user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'Alex Tan' }) },
      $transaction: jest.fn((cb) => cb(prisma)),
    };
    storage = { getObject: jest.fn(), putObject: jest.fn().mockResolvedValue(undefined) };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake%')) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { enqueueCertificateReady: jest.fn().mockResolvedValue(undefined) };
    certificateGeneration = { enqueueBatchForEvent: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificateGenerationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: CertificatePdfService, useValue: pdf },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
        { provide: CertificateGenerationService, useValue: certificateGeneration },
      ],
    }).compile();
    processor = moduleRef.get(CertificateGenerationProcessor);
  });

  it('renders, stores, creates the Certificate row, audits, and notifies', async () => {
    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ participantFullName: 'Alex Tan', eventTitle: 'Tech Talk' }));
    expect(storage.putObject).toHaveBeenCalledWith('certificates/org1/event1/user1.pdf', expect.any(Buffer), 'application/pdf');
    expect(prisma.certificate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventId: 'event1', organizationId: 'org1', userId: 'user1', uploadedByUserId: 'actor1' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'certificate.generate', targetType: 'Certificate', targetId: 'cert1',
    }), expect.anything());
    expect(notifications.enqueueCertificateReady).toHaveBeenCalledWith('org1', 'cert1');
  });

  it('skips silently when a Certificate already exists for this event+user (race guard)', async () => {
    prisma.certificate.findFirst.mockResolvedValue({ id: 'existing' });
    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));
    expect(pdf.render).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('falls back to no logo when the logo fetch fails, and still generates the certificate', async () => {
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: 'logos/org1.png', primaryColor: '#2563eb', storageQuotaMb: 1024 });
    storage.getObject.mockRejectedValue(new Error('not found'));

    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ orgLogoBytes: null }));
    expect(prisma.certificate.create).toHaveBeenCalled();
  });

  it('skips (no create, no audit, no notify) when generating would exceed the storage quota', async () => {
    prisma.certificate.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: 1024 * 1024 * 1024 } });
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: null, primaryColor: '#2563eb', storageQuotaMb: 1 });

    await processor.process(fakeJob(CERTIFICATE_GENERATE_JOB, jobPayload));

    expect(prisma.certificate.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.enqueueCertificateReady).not.toHaveBeenCalled();
  });

  it('a feedback-window-close job re-runs the ungated batch enqueue for that event, and touches nothing else', async () => {
    await processor.process(fakeJob(CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB, { organizationId: 'org1', eventId: 'event1' }));

    expect(certificateGeneration.enqueueBatchForEvent).toHaveBeenCalledWith('org1', 'event1', undefined);
    expect(pdf.render).not.toHaveBeenCalled();
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('ignores an unrecognized job name', async () => {
    await processor.process(fakeJob('some.other.job', {}));
    expect(pdf.render).not.toHaveBeenCalled();
    expect(certificateGeneration.enqueueBatchForEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the unit tests to verify they fail**

Run: `cd backend && npm test -- certificate-generation`
Expected: FAIL — `feedbackResponse` not on the mocked prisma type, `onlyWithFeedback`/`scheduleFeedbackWindowClose`/`CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB`/`feedbackWindowCloseJobId` don't exist yet.

- [ ] **Step 3: Extend `certificate-generation.types.ts`**

Replace the full contents of `backend/src/certificates/generation/certificate-generation.types.ts` with:

```ts
export const CERTIFICATE_QUEUE = 'certificates';

export const CERTIFICATE_GENERATE_JOB = 'certificate.generate';
export const CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB = 'certificate.feedback-window-close';

export interface CertificateGenerateJobPayload {
  organizationId: string;
  eventId: string;
  userId: string;
  actorUserId?: string;
}

export interface FeedbackWindowCloseJobPayload {
  organizationId: string;
  eventId: string;
}

// BullMQ rejects custom job ids containing ':' (its Redis key separator),
// same reason notifications.types.ts uses a hyphen for reminderJobId.
export function feedbackWindowCloseJobId(eventId: string): string {
  return `feedback-window-close-${eventId}`;
}
```

- [ ] **Step 4: Extend `certificate-generation.service.ts`**

Replace the full contents of `backend/src/certificates/generation/certificate-generation.service.ts` with:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { FEEDBACK_WINDOW_MS } from '../../feedback/feedback.constants';
import {
  CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB,
  CERTIFICATE_GENERATE_JOB,
  CERTIFICATE_QUEUE,
  feedbackWindowCloseJobId,
} from './certificate-generation.types';

export interface EnqueueBatchOpts {
  onlyWithFeedback?: boolean;
}

@Injectable()
export class CertificateGenerationService {
  constructor(
    @InjectQueue(CERTIFICATE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueBatchForEvent(
    organizationId: string,
    eventId: string,
    actorUserId: string | undefined,
    opts?: EnqueueBatchOpts,
  ): Promise<void> {
    const attendees = await this.prisma.attendance.findMany({
      where: { eventId, organizationId, status: 'PRESENT' },
      select: { registration: { select: { userId: true } } },
    });
    let userIds = attendees.map((a) => a.registration.userId);
    if (userIds.length === 0) return;

    if (opts?.onlyWithFeedback) {
      const withFeedback = await this.prisma.feedbackResponse.findMany({
        where: { organizationId, eventId, userId: { in: userIds } },
        select: { userId: true },
      });
      const feedbackUserIds = new Set(withFeedback.map((f) => f.userId));
      userIds = userIds.filter((id) => feedbackUserIds.has(id));
      if (userIds.length === 0) return;
    }

    const existing = await this.prisma.certificate.findMany({
      where: { eventId, organizationId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingUserIds = new Set(existing.map((c) => c.userId));
    const pending = userIds.filter((id) => !existingUserIds.has(id));

    await Promise.all(
      pending.map((userId) =>
        this.queue.add(CERTIFICATE_GENERATE_JOB, { organizationId, eventId, userId, actorUserId }),
      ),
    );
  }

  // Delayed fallback for a gated event: whoever still has no certificate
  // once the feedback window closes gets one anyway, regardless of
  // feedback. Idempotent — enqueueBatchForEvent always skips existing
  // certificates, so this is safe even if some already went out earlier
  // (e.g. via the immediate-unlock path in FeedbackService.submit).
  scheduleFeedbackWindowClose(organizationId: string, eventId: string, endAt: Date) {
    const delay = Math.max(0, endAt.getTime() + FEEDBACK_WINDOW_MS - Date.now());
    return this.queue.add(
      CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB,
      { organizationId, eventId },
      { jobId: feedbackWindowCloseJobId(eventId), delay },
    );
  }
}
```

- [ ] **Step 5: Extend `certificate-generation.processor.ts`**

Replace the full contents of `backend/src/certificates/generation/certificate-generation.processor.ts` with:

```ts
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateGenerationService } from './certificate-generation.service';
import {
  CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB,
  CERTIFICATE_GENERATE_JOB,
  CERTIFICATE_QUEUE,
  CertificateGenerateJobPayload,
  FeedbackWindowCloseJobPayload,
} from './certificate-generation.types';

@Processor(CERTIFICATE_QUEUE)
export class CertificateGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificateGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: CertificatePdfService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly certificateGeneration: CertificateGenerationService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === CERTIFICATE_FEEDBACK_WINDOW_CLOSE_JOB) {
      const { organizationId, eventId } = job.data as FeedbackWindowCloseJobPayload;
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, undefined);
      return;
    }
    if (job.name !== CERTIFICATE_GENERATE_JOB) return;
    const { organizationId, eventId, userId, actorUserId } = job.data as CertificateGenerateJobPayload;

    // Race guard: a manual upload (or a duplicate job) could have created
    // the certificate between enqueue and now.
    const alreadyExists = await this.prisma.certificate.findFirst({ where: { eventId, organizationId, userId } });
    if (alreadyExists) return;

    const [event, organization, user] = await Promise.all([
      this.prisma.event.findUnique({ where: { id: eventId } }),
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!event || !organization || !user) return;

    let orgLogoBytes: Buffer | null = null;
    if (organization.logoKey) {
      try {
        orgLogoBytes = await this.storage.getObject(organization.logoKey);
      } catch (error) {
        this.logger.warn(`Failed to fetch org logo (key=${organization.logoKey}): ${error}`);
      }
    }

    const buffer = await this.pdf.render({
      participantFullName: user.fullName,
      eventTitle: event.title,
      eventDate: event.startAt,
      orgName: organization.name,
      orgPrimaryColor: organization.primaryColor,
      orgLogoBytes,
    });

    // Same quota check as CertificatesService.upload() — sums only
    // Certificate.fileSizeBytes for this org, matching upload()'s existing
    // (not cross-model) quota query exactly.
    const usage = await this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } });
    const usedBytes = usage._sum.fileSizeBytes ?? 0;
    const quotaBytes = organization.storageQuotaMb * 1024 * 1024;
    if (usedBytes + buffer.length > quotaBytes) {
      this.logger.warn(`Skipping certificate generation for user=${userId} event=${eventId}: storage quota exceeded`);
      return;
    }

    const storageKey = `certificates/${organizationId}/${eventId}/${userId}.pdf`;
    await this.storage.putObject(storageKey, buffer, 'application/pdf');

    const certificate = await this.prisma.$transaction(async (tx) => {
      const created = await tx.certificate.create({
        data: {
          eventId, organizationId, userId, storageKey,
          fileSizeBytes: buffer.length, uploadedByUserId: actorUserId ?? userId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'certificate.generate',
        targetType: 'Certificate', targetId: created.id,
        metadata: { certificateId: created.id, eventId, userId },
      }, tx);
      return created;
    });

    await this.notifications.enqueueCertificateReady(organizationId, certificate.id);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Certificate generation job ${job.id} failed: ${error.message}`);
  }
}
```

- [ ] **Step 6: Run the unit tests to verify they pass**

Run: `cd backend && npm test -- certificate-generation`
Expected: PASS — 8 tests in `certificate-generation.service.spec.ts`, 6 in `certificate-generation.processor.spec.ts`.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS (existing `certificate-generation.e2e-spec.ts` must be unaffected — `enqueueBatchForEvent`'s 3-arg call sites are untouched).

```bash
git add backend/src/certificates/generation
git commit -m "feat: onlyWithFeedback cert filter + delayed feedback-window-close job"
```

---

### Task 4: Wire gating into `EventsService` and unlock feedback submission

**Files:**
- Modify: `backend/src/events/dto/update-event.dto.ts`
- Modify: `backend/src/events/events.service.ts`
- Modify: `backend/src/feedback/feedback.service.ts`
- Modify: `backend/src/feedback/feedback.module.ts`
- Create: `backend/test/feedback-cert-gating.e2e-spec.ts`

**Interfaces:**
- Consumes: `CertificateGenerationService.enqueueBatchForEvent(..., opts)` and `.scheduleFeedbackWindowClose(...)` from Task 3.
- Produces: `Event.requireFeedbackForCertificate` is now settable via `PATCH /events/:eventId`; `FeedbackService.submit()` now triggers immediate cert-unlock for already-`COMPLETED` gated events.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/feedback-cert-gating.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CERTIFICATE_QUEUE, feedbackWindowCloseJobId } from '../src/certificates/generation/certificate-generation.types';

describe('Certificate release gating on Event Feedback + NPS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: Queue;
  let presToken: string;
  let orgId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    queue = moduleRef.get<Queue>(getQueueToken(CERTIFICATE_QUEUE));
    presToken = await registerAndLogin(`fbgate-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'FbGateOrg', slug: `fbgate-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  async function createPublishedEvent(title: string) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title, startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id;
  }

  async function presentParticipant(eventId: string) {
    const email = `fbgate-p-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    const user = await prisma.user.findUnique({ where: { email } });
    return { token, userId: user!.id };
  }

  const validFeedback = { npsScore: 9, contentRating: 5, organizationRating: 5, venueRating: 5 };

  async function waitForCertificates(eventId: string, count: number, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
      const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
      if (certs.length >= count) return certs;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${count} certificate(s), have ${certs.length}`);
      await wait(200);
    }
  }

  it('a non-gated event still certs every PRESENT attendee immediately on complete (regression)', async () => {
    const eventId = await createPublishedEvent('Ungated Event');
    const { userId } = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const certs = await waitForCertificates(eventId, 1);
    expect(certs[0].userId).toBe(userId);
    expect(await queue.getJob(feedbackWindowCloseJobId(eventId))).toBeUndefined();
  });

  it('a gated event certs only attendees with feedback on complete, schedules a delayed catch-up job, and unlocks the rest on submit', async () => {
    const eventId = await createPublishedEvent('Gated Event');
    const { token: tokenA, userId: userA } = await presentParticipant(eventId);
    const { token: tokenB, userId: userB } = await presentParticipant(eventId);

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ requireFeedbackForCertificate: true }).expect(200);

    // userA submits feedback before the event is completed.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenA}`).send(validFeedback).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Only userA (who already gave feedback) gets a certificate immediately.
    const certsAfterComplete = await waitForCertificates(eventId, 1);
    expect(certsAfterComplete.map((c) => c.userId)).toEqual([userA]);

    const windowJob = await queue.getJob(feedbackWindowCloseJobId(eventId));
    expect(windowJob).toBeDefined();
    expect(windowJob!.opts.delay).toBeGreaterThan(0);

    // userB submits feedback after completion — unlocked immediately, no 14-day wait.
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${tokenB}`).send(validFeedback).expect(201);

    const certsAfterUnlock = await waitForCertificates(eventId, 2);
    expect(certsAfterUnlock.map((c) => c.userId).sort()).toEqual([userA, userB].sort());
  });

  it('409s toggling requireFeedbackForCertificate once the event is COMPLETED', async () => {
    const eventId = await createPublishedEvent('Locked Toggle Event');
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${eventId}`)
      .set('Authorization', `Bearer ${presToken}`).send({ requireFeedbackForCertificate: true }).expect(409);
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `cd backend && npm run test:e2e -- feedback-cert-gating`
Expected: FAIL — `requireFeedbackForCertificate` is stripped by the DTO whitelist (not yet a recognized field), so the gated path never activates and the "only userA" assertion fails.

- [ ] **Step 3: Add the toggle field to `UpdateEventDto`**

Replace the full contents of `backend/src/events/dto/update-event.dto.ts` with:

```ts
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class UpdateEventDto {
  @ValidateIf((o) => o.title !== undefined) @IsString() @MinLength(2) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() venue?: string;
  @IsOptional() @IsISO8601() startAt?: string;
  @IsOptional() @IsISO8601() endAt?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsBoolean() requireFeedbackForCertificate?: boolean;
}
```

- [ ] **Step 4: Wire gating into `EventsService.update()` and `.complete()`**

Replace the full contents of `backend/src/events/events.service.ts` with:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CertificateGenerationService } from '../certificates/generation/certificate-generation.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly certificateGeneration: CertificateGenerationService,
  ) {}

  async create(organizationId: string, dto: CreateEventDto, actorUserId?: string) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');

    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          organizationId,
          title: dto.title,
          description: dto.description,
          venue: dto.venue,
          startAt,
          endAt,
          capacity: dto.capacity,
          createdByUserId: actorUserId,
        },
      });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.create',
        targetType: 'Event', targetId: event.id,
        metadata: { eventId: event.id, title: event.title },
      }, tx);
      return event;
    });
  }

  list(organizationId: string, actorRole: Role) {
    const canManage = MANAGE_EVENTS.includes(actorRole);
    return this.prisma.event.findMany({
      where: { organizationId, ...(canManage ? {} : { status: { not: 'DRAFT' } }) },
      orderBy: { startAt: 'desc' },
    });
  }

  listPublicUpcoming(organizationId: string) {
    return this.prisma.event.findMany({
      where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
      orderBy: { startAt: 'asc' },
      select: { id: true, title: true, startAt: true, endAt: true, venue: true },
    });
  }

  async findOne(organizationId: string, eventId: string, actorRole: Role) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');
    if (event.status === 'DRAFT' && !MANAGE_EVENTS.includes(actorRole)) {
      throw new NotFoundException('Event not found in this organization');
    }
    return event;
  }

  async update(organizationId: string, eventId: string, dto: UpdateEventDto, actorUserId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
      if (!current) throw new NotFoundException('Event not found in this organization');
      if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
        throw new ConflictException('Completed or cancelled events cannot be edited');
      }

      const startAt = dto.startAt ? new Date(dto.startAt) : current.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : current.endAt;
      if (endAt <= startAt) throw new BadRequestException('endAt must be after startAt');

      const data: Prisma.EventUpdateInput = {
        title: dto.title,
        description: dto.description,
        venue: dto.venue,
        capacity: dto.capacity,
        startAt: dto.startAt ? startAt : undefined,
        endAt: dto.endAt ? endAt : undefined,
        requireFeedbackForCertificate: dto.requireFeedbackForCertificate,
      };
      const fields = Object.keys(data).filter((k) => (data as Record<string, unknown>)[k] !== undefined);

      const updated = await tx.event.update({ where: { id: eventId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.update',
        targetType: 'Event', targetId: eventId, metadata: { eventId, fields },
      }, tx);
      return updated;
    });

    // Reschedules even if the new startAt equals the old one — a harmless
    // no-op recompute, not worth a deep-equality check.
    if (dto.startAt && result.status === 'PUBLISHED') {
      await this.notifications.cancelEventReminder(eventId);
      await this.notifications.scheduleEventReminder(organizationId, eventId, result.startAt);
    }

    return result;
  }

  private async transition(
    organizationId: string,
    eventId: string,
    action: 'event.publish' | 'event.complete' | 'event.cancel',
    to: 'PUBLISHED' | 'COMPLETED' | 'CANCELLED',
    canTransition: (status: EventStatus) => boolean,
    actorUserId?: string,
    extraGuard?: (event: { endAt: Date }) => void,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
      if (!current) throw new NotFoundException('Event not found in this organization');
      if (!canTransition(current.status)) {
        const verb = action.split('.')[1];
        throw new ConflictException(`Cannot ${verb} an event in ${current.status}`);
      }
      if (extraGuard) extraGuard(current);

      // Compare-and-swap: only update if the status is still the one we validated,
      // so a concurrent transition loses with P2025 (and never writes an audit row)
      // instead of blindly overwriting the winner's state.
      let updated;
      try {
        updated = await tx.event.update({
          where: { id: eventId, organizationId, status: current.status },
          data: { status: to },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new ConflictException('Event was modified concurrently — please retry');
        }
        throw error;
      }
      await this.audit.record({
        organizationId, actorUserId, action,
        targetType: 'Event', targetId: eventId,
        metadata: { eventId, from: current.status, to },
      }, tx);
      return updated;
    });
  }

  async publish(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.publish', 'PUBLISHED',
      (s) => s === 'DRAFT', actorUserId,
      (e) => { if (e.endAt <= new Date()) throw new ConflictException('Cannot publish a past event'); },
    );
    await this.notifications.scheduleEventReminder(organizationId, eventId, updated.startAt);
    return updated;
  }

  async complete(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.complete', 'COMPLETED',
      (s) => s === 'PUBLISHED', actorUserId,
    );
    await this.notifications.cancelEventReminder(eventId);
    if (updated.requireFeedbackForCertificate) {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, actorUserId, { onlyWithFeedback: true });
      await this.certificateGeneration.scheduleFeedbackWindowClose(organizationId, eventId, updated.endAt);
    } else {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, actorUserId);
    }
    return updated;
  }

  async cancel(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.cancel', 'CANCELLED',
      (s) => s === 'DRAFT' || s === 'PUBLISHED', actorUserId,
    );
    await this.notifications.cancelEventReminder(eventId);
    return updated;
  }

  async remove(organizationId: string, eventId: string, actorUserId?: string): Promise<{ removed: true }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.event.findFirst({ where: { id: eventId, organizationId } });
        if (!current) throw new NotFoundException('Event not found in this organization');
        await tx.event.delete({ where: { id: eventId, organizationId } });
        await this.audit.record({
          organizationId, actorUserId, action: 'event.delete',
          targetType: 'Event', targetId: eventId,
          metadata: { eventId, title: current.title },
        }, tx);
        return { removed: true as const };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Event not found in this organization');
      }
      throw error;
    }
  }
}
```

- [ ] **Step 5: Add the immediate-unlock call to `FeedbackService.submit()`**

Replace the full contents of `backend/src/feedback/feedback.service.ts` with:

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CertificateGenerationService } from '../certificates/generation/certificate-generation.service';
import { SubmitFeedbackDto } from './dto/submit-feedback.dto';
import { FEEDBACK_WINDOW_MS } from './feedback.constants';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly certificateGeneration: CertificateGenerationService,
  ) {}

  async submit(organizationId: string, eventId: string, userId: string, dto: SubmitFeedbackDto) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const attendance = await this.prisma.attendance.findFirst({
      where: { eventId, organizationId, registration: { userId }, status: 'PRESENT' },
    });
    if (!attendance) throw new ForbiddenException('Only attendees marked present can submit feedback');

    const windowCloses = new Date(event.endAt.getTime() + FEEDBACK_WINDOW_MS);
    if (new Date() > windowCloses) throw new ForbiddenException('Feedback window has closed for this event');

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.feedbackResponse.create({
          data: {
            organizationId, eventId, userId,
            npsScore: dto.npsScore,
            contentRating: dto.contentRating,
            organizationRating: dto.organizationRating,
            venueRating: dto.venueRating,
            comment: dto.comment,
          },
        });
        await this.audit.record({
          organizationId, actorUserId: userId, action: 'feedback.submit',
          targetType: 'FeedbackResponse', targetId: row.id,
          metadata: { eventId, feedbackId: row.id },
        }, tx);
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Feedback already submitted for this event');
      }
      throw error;
    }

    // Immediate-unlock: if this event already completed with the gate on,
    // don't make this person wait for the 14-day fallback job — re-run the
    // gated batch enqueue right away. Idempotent (skips existing certs), so
    // cheap to call on every submission at this event scale.
    if (event.status === 'COMPLETED' && event.requireFeedbackForCertificate) {
      await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, undefined, { onlyWithFeedback: true });
    }

    return created;
  }

  findMine(organizationId: string, eventId: string, userId: string) {
    return this.prisma.feedbackResponse.findFirst({ where: { eventId, organizationId, userId } });
  }

  async summary(organizationId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({ where: { id: eventId, organizationId } });
    if (!event) throw new NotFoundException('Event not found in this organization');

    const responses = await this.prisma.feedbackResponse.findMany({
      where: { organizationId, eventId },
      select: { npsScore: true, contentRating: true, organizationRating: true, venueRating: true, comment: true },
    });

    const count = responses.length;
    const average = (values: number[]) => (count === 0 ? null : values.reduce((sum, v) => sum + v, 0) / count);

    return {
      responseCount: count,
      avgNpsScore: average(responses.map((r) => r.npsScore)),
      avgContentRating: average(responses.map((r) => r.contentRating)),
      avgOrganizationRating: average(responses.map((r) => r.organizationRating)),
      avgVenueRating: average(responses.map((r) => r.venueRating)),
      comments: responses.map((r) => r.comment).filter((c): c is string => c !== null),
    };
  }
}
```

- [ ] **Step 6: Give `FeedbackModule` access to `CertificateGenerationService`**

Replace the full contents of `backend/src/feedback/feedback.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { CertificatesModule } from '../certificates/certificates.module';

@Module({
  imports: [CertificatesModule],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- feedback-cert-gating`
Expected: PASS, all 3 tests green.

- [ ] **Step 8: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS — in particular, all 4 pre-existing tests in `certificate-generation.e2e-spec.ts` still pass unmodified (non-gated path untouched).

```bash
git add backend/src/events backend/src/feedback backend/test/feedback-cert-gating.e2e-spec.ts
git commit -m "feat: gate certificate release on Event Feedback + NPS"
```

---

### Task 5: Analytics — per-event and org-wide feedback trends

**Files:**
- Modify: `backend/src/analytics/analytics.service.ts`
- Modify: `backend/src/analytics/analytics.controller.ts`
- Create: `backend/test/analytics-feedback.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /organizations/:orgId/analytics/feedback` → `{ data: { eventId, responseCount, avgNpsScore, avgContentRating, avgOrganizationRating, avgVenueRating }[] }`; `GET /organizations/:orgId/analytics/feedback-trends?days=` → `{ trend: { date, responseCount, avgNpsScore, avgContentRating, avgOrganizationRating, avgVenueRating }[] }`.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/analytics-feedback.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Analytics feedback (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
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
    presToken = await registerAndLogin(`anfb-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'AnFbOrg', slug: `anfb-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  async function createPublishedEvent(title: string) {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title, startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    return event.body.id;
  }

  async function presentParticipant(eventId: string) {
    const email = `anfb-p-${Date.now()}-${Math.random()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const mine = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/attendance/me`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/attendance/scan`)
      .set('Authorization', `Bearer ${presToken}`).send({ token: mine.body.token }).expect(200);
    return token;
  }

  it('getFeedback reports one entry per event with averages', async () => {
    const eventId = await createPublishedEvent('Analytics Feedback Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ npsScore: 8, contentRating: 4, organizationRating: 4, venueRating: 4 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const entry = res.body.data.find((d: { eventId: string }) => d.eventId === eventId);
    expect(entry).toBeDefined();
    expect(entry.responseCount).toBe(1);
    expect(entry.avgNpsScore).toBe(8);
  });

  it('getFeedbackTrends zero-fills the window and buckets by submission day', async () => {
    const eventId = await createPublishedEvent('Analytics Trend Event');
    const token = await presentParticipant(eventId);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/feedback`)
      .set('Authorization', `Bearer ${token}`).send({ npsScore: 10, contentRating: 5, organizationRating: 5, venueRating: 5 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback-trends?days=7`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(res.body.trend).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    const todayBucket = res.body.trend.find((t: { date: string }) => t.date === today);
    expect(todayBucket.responseCount).toBe(1);
    expect(todayBucket.avgNpsScore).toBe(10);
    const emptyBucket = res.body.trend.find((t: { responseCount: number }) => t.responseCount === 0);
    expect(emptyBucket.avgNpsScore).toBeNull();
  });

  it('cross-org isolation: org B president cannot view org A feedback analytics', async () => {
    const otherPresToken = await registerAndLogin(`anfb-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'AnFbIsoOrg', slug: `anfb-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/analytics/feedback`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `cd backend && npm run test:e2e -- analytics-feedback`
Expected: FAIL — `/analytics/feedback` and `/analytics/feedback-trends` routes don't exist (404).

- [ ] **Step 3: Add `getFeedback` and `getFeedbackTrends` to `AnalyticsService`**

In `backend/src/analytics/analytics.service.ts`, add these two methods to the `AnalyticsService` class, after `getCommitteeActivity`:

```ts
  async getFeedback(organizationId: string) {
    const responses = await this.prisma.feedbackResponse.findMany({
      where: { organizationId },
      select: { eventId: true, npsScore: true, contentRating: true, organizationRating: true, venueRating: true },
    });

    const byEvent = new Map<string, typeof responses>();
    for (const r of responses) {
      const list = byEvent.get(r.eventId) ?? [];
      list.push(r);
      byEvent.set(r.eventId, list);
    }

    const data = Array.from(byEvent.entries()).map(([eventId, rows]) => {
      const count = rows.length;
      const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / count;
      return {
        eventId,
        responseCount: count,
        avgNpsScore: average(rows.map((r) => r.npsScore)),
        avgContentRating: average(rows.map((r) => r.contentRating)),
        avgOrganizationRating: average(rows.map((r) => r.organizationRating)),
        avgVenueRating: average(rows.map((r) => r.venueRating)),
      };
    });

    return { data };
  }

  async getFeedbackTrends(organizationId: string, days: number) {
    const buckets = dayRange(days);
    const start = windowStart(days);

    const responses = await this.prisma.feedbackResponse.findMany({
      where: { organizationId, createdAt: { gte: start } },
      select: { createdAt: true, npsScore: true, contentRating: true, organizationRating: true, venueRating: true },
    });

    const byDay = new Map(buckets.map((d) => [d, [] as typeof responses]));
    for (const r of responses) {
      const key = dateKey(r.createdAt);
      if (byDay.has(key)) byDay.get(key)!.push(r);
    }

    const trend = buckets.map((date) => {
      const rows = byDay.get(date)!;
      const count = rows.length;
      const average = (values: number[]) => (count === 0 ? null : values.reduce((sum, v) => sum + v, 0) / count);
      return {
        date,
        responseCount: count,
        avgNpsScore: average(rows.map((r) => r.npsScore)),
        avgContentRating: average(rows.map((r) => r.contentRating)),
        avgOrganizationRating: average(rows.map((r) => r.organizationRating)),
        avgVenueRating: average(rows.map((r) => r.venueRating)),
      };
    });

    return { trend };
  }
```

- [ ] **Step 4: Add the two routes to `AnalyticsController`**

In `backend/src/analytics/analytics.controller.ts`, add these two methods to the `AnalyticsController` class, after `getCommitteeActivity`:

```ts
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('feedback')
  getFeedback(@OrgId() orgId: string) {
    return this.analytics.getFeedback(orgId);
  }

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Get('feedback-trends')
  getFeedbackTrends(@OrgId() orgId: string, @Query('days') daysRaw?: string) {
    return this.analytics.getFeedbackTrends(orgId, parseDaysParam(daysRaw));
  }
```

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- analytics-feedback`
Expected: PASS, all 3 tests green.

- [ ] **Step 6: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add backend/src/analytics backend/test/analytics-feedback.e2e-spec.ts
git commit -m "feat: feedback analytics (per-event + org-wide trend)"
```

---

## Post-plan: roadmap note

Once merged, five Phase 2 items remain shipped (Analytics, File Repository, Meeting Minutes, Asset Management, Public Club Page, Email Notifications, Certificate Generator, Branding & Themes) plus this one — Event Feedback + NPS. Two Phase 2 roadmap items remain, no fixed dependency order: Committee Handover Pack, Consent-versioned re-prompt.
