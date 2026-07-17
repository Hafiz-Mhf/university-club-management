# Committee Handover Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let committee-tier members generate an on-demand PDF summarizing the org's committee roster, recent meeting minutes, asset inventory, key SOP/report files, and upcoming events — for handover on committee rotation.

**Architecture:** New `backend/src/handover/` module. `HandoverPdfService` (pure pdf-lib renderer, no Prisma dependency) renders a multi-page portrait report. `HandoverService` gathers all five sections via direct Prisma queries — same cross-cutting-read pattern as `AnalyticsService`, no other feature module imported — then calls the renderer and audits. `HandoverController` streams the result back as `application/pdf` via `StreamableFile`. Nothing is persisted: no new Prisma model, no queue, no storage object.

**Tech Stack:** NestJS, Prisma/PostgreSQL, pdf-lib (existing dependency), Jest + Supertest e2e.

## Global Constraints

- Every tenant-owned Prisma model carries `organizationId`; this feature adds no new model, so `TENANT_SCOPED_MODELS` is unchanged.
- RBAC via `@Roles()` + `RolesGuard`, `MANAGE_EVENTS` role group (`backend/src/rbac/role-groups.ts`).
- `handover.generate` is audited (`AuditService.record`) — a deliberate exception to "reads are never audited," per the approved spec.
- Prisma ids are `@default(uuid())`, no change here (no new model).
- One commit per task. Full unit (`npm test`) + e2e (`npm run test:e2e`) suite must pass before each commit; current baseline is 92/92 unit, 317/317 e2e (verified 2026-07-17, `docker compose up -d` first if the stack has stopped).
- pdf-lib cannot extract rendered text back out of a PDF — every prior PDF test in this codebase (`certificate-pdf.service.spec.ts`) verifies structure (`getPageCount()`), never rendered text. Content-correctness for this feature is verified at the `HandoverService` layer (mocked Prisma, asserting the exact object passed to `render()`), not by parsing PDF bytes.

---

### Task 1: `HandoverPdfService` — pure PDF renderer

**Files:**
- Create: `backend/src/handover/handover-pdf.service.ts`
- Create: `backend/src/handover/handover-pdf.service.spec.ts`

**Interfaces:**
- Produces: `HandoverPdfService.render(data: HandoverPdfData): Promise<Buffer>`, and the `HandoverPdfData`/`HandoverRosterEntry`/`HandoverMinutesEntry`/`HandoverAssetEntry`/`HandoverFileEntry`/`HandoverEventEntry` interfaces — Task 2's `HandoverService` imports these exact shapes and constructs this exact object.

- [ ] **Step 1: Write the failing unit tests**

Create `backend/src/handover/handover-pdf.service.spec.ts`:

```ts
import { PDFDocument } from 'pdf-lib';
import { HandoverPdfService, HandoverPdfData } from './handover-pdf.service';

describe('HandoverPdfService', () => {
  const service = new HandoverPdfService();

  const emptyData: HandoverPdfData = {
    organizationName: 'Coding Club',
    generatedAt: new Date('2026-07-17T00:00:00.000Z'),
    roster: [],
    minutes: [],
    assets: [],
    files: [],
    upcomingEvents: [],
  };

  it('renders a valid PDF with at least one page when every section is empty', async () => {
    const buffer = await service.render(emptyData);
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('renders a valid PDF with populated sections', async () => {
    const buffer = await service.render({
      ...emptyData,
      roster: [
        { fullName: 'Alex Tan', role: 'PRESIDENT', history: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }] },
        { fullName: 'Sam Lee', role: 'SECRETARY', history: [] },
      ],
      minutes: [{ title: 'Weekly Sync', meetingDate: new Date('2026-07-01T00:00:00.000Z') }],
      assets: [{ name: 'Projector', quantity: 2, condition: 'GOOD', location: 'Storage Room' }],
      files: [{ title: 'Onboarding SOP', category: 'SOP', originalFilename: 'onboarding.pdf' }],
      upcomingEvents: [{ title: 'Tech Talk', startAt: new Date('2026-08-01T00:00:00.000Z'), venue: 'Hall A' }],
    });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('breaks onto additional pages when a section has many entries', async () => {
    const roster = Array.from({ length: 120 }, (_, i) => ({
      fullName: `Member ${i}`,
      role: 'COMMITTEE',
      history: [],
    }));
    const buffer = await service.render({ ...emptyData, roster });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('does not throw when an asset has a null location', async () => {
    const buffer = await service.render({
      ...emptyData,
      assets: [{ name: 'Ladder', quantity: 1, condition: 'DAMAGED', location: null }],
    });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- handover-pdf`
Expected: FAIL — `handover-pdf.service.ts` doesn't exist yet.

- [ ] **Step 3: Implement `HandoverPdfService`**

Create `backend/src/handover/handover-pdf.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from 'pdf-lib';

export interface HandoverRosterEntry {
  fullName: string;
  role: string;
  history: { role: string; until: string }[];
}

export interface HandoverMinutesEntry {
  title: string;
  meetingDate: Date;
}

export interface HandoverAssetEntry {
  name: string;
  quantity: number;
  condition: string;
  location: string | null;
}

export interface HandoverFileEntry {
  title: string;
  category: string;
  originalFilename: string;
}

export interface HandoverEventEntry {
  title: string;
  startAt: Date;
  venue: string | null;
}

export interface HandoverPdfData {
  organizationName: string;
  generatedAt: Date;
  roster: HandoverRosterEntry[];
  minutes: HandoverMinutesEntry[];
  assets: HandoverAssetEntry[];
  files: HandoverFileEntry[];
  upcomingEvents: HandoverEventEntry[];
}

const PAGE_WIDTH = 595; // A4 portrait, points
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LINE_HEIGHT = 16;

@Injectable()
export class HandoverPdfService {
  async render(data: HandoverPdfData): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const heading = await doc.embedFont(StandardFonts.HelveticaBold);
    const body = await doc.embedFont(StandardFonts.Helvetica);

    const cursor: { page: PDFPage; y: number } = {
      page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
      y: PAGE_HEIGHT - MARGIN,
    };

    const newPage = () => {
      cursor.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      cursor.y = PAGE_HEIGHT - MARGIN;
    };

    const drawLine = (text: string, font: PDFFont, size: number) => {
      if (cursor.y < MARGIN) newPage();
      cursor.page.drawText(text, { x: MARGIN, y: cursor.y, size, font });
      cursor.y -= LINE_HEIGHT;
    };

    const drawSection = (title: string, lines: string[]) => {
      cursor.y -= LINE_HEIGHT / 2;
      drawLine(title, heading, 14);
      const rows = lines.length > 0 ? lines : ['None'];
      for (const line of rows) drawLine(line, body, 10);
    };

    drawLine(`Committee Handover Pack — ${data.organizationName}`, heading, 18);
    drawLine(`Generated ${data.generatedAt.toISOString().slice(0, 10)}`, body, 10);

    drawSection(
      'Committee Roster',
      data.roster.map((m) => {
        const past = m.history.map((h) => h.role).join(', ');
        return past ? `${m.fullName} — ${m.role} (previously: ${past})` : `${m.fullName} — ${m.role}`;
      }),
    );

    drawSection(
      'Recent Meeting Minutes',
      data.minutes.map((m) => `${m.title} — ${m.meetingDate.toISOString().slice(0, 10)}`),
    );

    drawSection(
      'Asset Inventory',
      data.assets.map((a) => `${a.name} (x${a.quantity}, ${a.condition}${a.location ? `, ${a.location}` : ''})`),
    );

    drawSection(
      'Key Files (SOP / Reports)',
      data.files.map((f) => `${f.title} [${f.category}] — ${f.originalFilename}`),
    );

    drawSection(
      'Upcoming Events',
      data.upcomingEvents.map((e) => `${e.title} — ${e.startAt.toISOString().slice(0, 10)}${e.venue ? ` @ ${e.venue}` : ''}`),
    );

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test -- handover-pdf`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add backend/src/handover/handover-pdf.service.ts backend/src/handover/handover-pdf.service.spec.ts
git commit -m "feat: HandoverPdfService — multi-section PDF renderer with page-break"
```

---

### Task 2: `HandoverService` — data gathering + audit

**Files:**
- Create: `backend/src/handover/handover.service.ts`
- Create: `backend/src/handover/handover.service.spec.ts`

**Interfaces:**
- Consumes: `HandoverPdfService.render(data)` and its data types from Task 1.
- Produces: `HandoverService.generate(organizationId: string, actorUserId: string | undefined): Promise<Buffer>` — Task 3's `HandoverController` calls this directly.

- [ ] **Step 1: Write the failing unit tests**

Create `backend/src/handover/handover.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HandoverPdfService } from './handover-pdf.service';
import { HandoverService } from './handover.service';

describe('HandoverService', () => {
  let service: HandoverService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    membership: { findMany: jest.Mock };
    meetingMinutes: { findMany: jest.Mock };
    asset: { findMany: jest.Mock };
    orgFile: { findMany: jest.Mock };
    event: { findMany: jest.Mock };
  };
  let audit: { record: jest.Mock };
  let pdf: { render: jest.Mock };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org1', name: 'Coding Club' }) },
      membership: { findMany: jest.fn().mockResolvedValue([]) },
      meetingMinutes: { findMany: jest.fn().mockResolvedValue([]) },
      asset: { findMany: jest.fn().mockResolvedValue([]) },
      orgFile: { findMany: jest.fn().mockResolvedValue([]) },
      event: { findMany: jest.fn().mockResolvedValue([]) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake%')) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HandoverService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: HandoverPdfService, useValue: pdf },
      ],
    }).compile();
    service = moduleRef.get(HandoverService);
  });

  it('throws when the organization does not exist', async () => {
    prisma.organization.findUnique.mockResolvedValue(null);
    await expect(service.generate('org1', 'actor1')).rejects.toThrow(NotFoundException);
  });

  it('scopes every query to organizationId', async () => {
    await service.generate('org1', 'actor1');

    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1', status: 'ACTIVE' },
    }));
    expect(prisma.meetingMinutes.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1' },
      orderBy: { meetingDate: 'desc' },
      take: 10,
    }));
    expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1' },
      orderBy: { name: 'asc' },
    }));
    expect(prisma.orgFile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org1', category: { in: ['SOP', 'REPORT'] } },
    }));
    expect(prisma.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org1', status: 'PUBLISHED' }),
    }));
  });

  it('maps membership rows into roster entries, parsing committeeHistory safely', async () => {
    prisma.membership.findMany.mockResolvedValue([
      { role: 'PRESIDENT', committeeHistory: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }], user: { fullName: 'Alex Tan' } },
      { role: 'SECRETARY', committeeHistory: null, user: { fullName: 'Sam Lee' } },
    ]);

    await service.generate('org1', 'actor1');

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({
      organizationName: 'Coding Club',
      roster: [
        { fullName: 'Alex Tan', role: 'PRESIDENT', history: [{ role: 'COMMITTEE', until: '2026-01-01T00:00:00.000Z' }] },
        { fullName: 'Sam Lee', role: 'SECRETARY', history: [] },
      ],
    }));
  });

  it('audits handover.generate with the organization and actor', async () => {
    await service.generate('org1', 'actor1');

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org1', actorUserId: 'actor1', action: 'handover.generate',
      targetType: 'Organization', targetId: 'org1',
    }));
  });

  it('returns the buffer produced by the PDF renderer', async () => {
    const result = await service.generate('org1', 'actor1');
    expect(result).toEqual(Buffer.from('%PDF-fake%'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- handover.service`
Expected: FAIL — `handover.service.ts` doesn't exist yet.

- [ ] **Step 3: Implement `HandoverService`**

Create `backend/src/handover/handover.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { FileCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { HandoverPdfService } from './handover-pdf.service';

const RECENT_MINUTES_LIMIT = 10;

@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: HandoverPdfService,
  ) {}

  async generate(organizationId: string, actorUserId: string | undefined): Promise<Buffer> {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organization not found');

    const [memberships, minutes, assets, files, upcomingEvents] = await Promise.all([
      this.prisma.membership.findMany({
        where: { organizationId, status: 'ACTIVE' },
        include: { user: { select: { fullName: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.meetingMinutes.findMany({
        where: { organizationId },
        orderBy: { meetingDate: 'desc' },
        take: RECENT_MINUTES_LIMIT,
        select: { title: true, meetingDate: true },
      }),
      this.prisma.asset.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { name: true, quantity: true, condition: true, location: true },
      }),
      this.prisma.orgFile.findMany({
        where: { organizationId, category: { in: [FileCategory.SOP, FileCategory.REPORT] } },
        orderBy: { createdAt: 'desc' },
        select: { title: true, category: true, originalFilename: true },
      }),
      this.prisma.event.findMany({
        where: { organizationId, status: 'PUBLISHED', startAt: { gte: new Date() } },
        orderBy: { startAt: 'asc' },
        select: { title: true, startAt: true, venue: true },
      }),
    ]);

    const buffer = await this.pdf.render({
      organizationName: organization.name,
      generatedAt: new Date(),
      roster: memberships.map((m) => ({
        fullName: m.user.fullName,
        role: m.role,
        history: Array.isArray(m.committeeHistory) ? (m.committeeHistory as { role: string; until: string }[]) : [],
      })),
      minutes,
      assets,
      files,
      upcomingEvents,
    });

    await this.audit.record({
      organizationId, actorUserId, action: 'handover.generate',
      targetType: 'Organization', targetId: organizationId,
      metadata: {},
    });

    return buffer;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test -- handover.service`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS.

```bash
git add backend/src/handover/handover.service.ts backend/src/handover/handover.service.spec.ts
git commit -m "feat: HandoverService — aggregate roster/minutes/assets/files/events, audited"
```

---

### Task 3: `HandoverController` + module wiring + e2e

**Files:**
- Create: `backend/src/handover/handover.controller.ts`
- Create: `backend/src/handover/handover.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/handover-pack.e2e-spec.ts`

**Interfaces:**
- Consumes: `HandoverService.generate(organizationId, actorUserId)` from Task 2.
- Produces: `GET /organizations/:orgId/handover` → `application/pdf` byte stream.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/handover-pack.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Committee Handover Pack (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  const pres = `handover-pres-${Date.now()}@test.io`;

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
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'HandoverOrg', slug: `handover-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('a committee member generates a valid PDF containing roster/minutes/asset/file/event data, and it is audited', async () => {
    // Populate every section this org has data for.
    const secondEmail = `handover-sec-${Date.now()}@test.io`;
    await registerAndLogin(secondEmail);
    const addRes = await request(app.getHttpServer()).post(`/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${presToken}`).send({ email: secondEmail, role: 'COMMITTEE' }).expect(201);
    await request(app.getHttpServer()).patch(`/organizations/${orgId}/members/${addRes.body.id}/role`)
      .set('Authorization', `Bearer ${presToken}`).send({ role: 'SECRETARY' }).expect(200);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/minutes`)
      .set('Authorization', `Bearer ${presToken}`)
      .send({ title: 'Handover Sync', meetingDate: '2026-07-10T00:00:00.000Z', attendeeMembershipIds: [], agendaItems: [], actionItems: [] })
      .expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/assets`)
      .set('Authorization', `Bearer ${presToken}`).send({ name: 'Projector', quantity: 2 }).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/files`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('title', 'Onboarding SOP').field('category', 'SOP')
      .attach('file', Buffer.from('%PDF-1.4\n%mock\n'), { filename: 'onboarding.pdf', contentType: 'application/pdf' })
      .expect(201);

    const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Upcoming Talk', startAt: future(5), endAt: future(6) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${presToken}`)
      .buffer(true).parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'handover.generate', pageSize: 10 });
    expect(auditRows.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('403s a non-committee member', async () => {
    const email = `handover-part-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    // A registrant gets auto-enrolled as PARTICIPANT — reuse that path to get a non-committee membership cheaply.
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Part Event', startAt: new Date(Date.now() + 5 * 86400000).toISOString(), endAt: new Date(Date.now() + 6 * 86400000).toISOString() });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('empty-org case: still returns a valid PDF with no data', async () => {
    const otherPresToken = await registerAndLogin(`handover-empty-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'EmptyHandoverOrg', slug: `handover-empty-${Date.now()}` })).body.id;

    const res = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/handover`)
      .set('Authorization', `Bearer ${otherPresToken}`)
      .buffer(true).parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const doc = await PDFDocument.load(res.body as Buffer);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("cross-org isolation: org B president cannot generate org A's handover pack (403)", async () => {
    const otherPresToken = await registerAndLogin(`handover-iso-${Date.now()}@test.io`);
    await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'HandoverIsoOrg', slug: `handover-iso-${Date.now()}` }).expect(201);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/handover`)
      .set('Authorization', `Bearer ${otherPresToken}`).expect(403);
  });
});
```

- [ ] **Step 2: Run the e2e test to verify it fails**

Run: `cd backend && npm run test:e2e -- handover-pack`
Expected: FAIL — route doesn't exist yet (404s).

- [ ] **Step 3: Create `HandoverController`**

Create `backend/src/handover/handover.controller.ts`:

```ts
import { Controller, Get, Header, StreamableFile, UseGuards } from '@nestjs/common';
import { HandoverService } from './handover.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../tenancy/tenant.guard';
import { RolesGuard } from '../rbac/roles.guard';
import { Roles } from '../rbac/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrgId } from '../tenancy/org-id.decorator';
import { MANAGE_EVENTS } from '../rbac/role-groups';

@Controller('organizations/:orgId/handover')
export class HandoverController {
  constructor(private readonly handover: HandoverService) {}

  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(...MANAGE_EVENTS)
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="handover-pack.pdf"')
  @Get()
  async generate(@OrgId() orgId: string, @CurrentUser() user: { userId: string }) {
    const buffer = await this.handover.generate(orgId, user.userId);
    return new StreamableFile(buffer);
  }
}
```

- [ ] **Step 4: Create `HandoverModule`**

Create `backend/src/handover/handover.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HandoverController } from './handover.controller';
import { HandoverService } from './handover.service';
import { HandoverPdfService } from './handover-pdf.service';

@Module({
  controllers: [HandoverController],
  providers: [HandoverService, HandoverPdfService],
})
export class HandoverModule {}
```

- [ ] **Step 5: Register `HandoverModule` in `AppModule`**

In `backend/src/app.module.ts`, add the import:

```ts
import { HandoverModule } from './handover/handover.module';
```

and add `HandoverModule` to the `imports` array, right after `AchievementsModule,`:

```ts
    AchievementsModule,
    HandoverModule,
```

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- handover-pack`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Run the full suite and commit**

Run: `cd backend && npm test && npm run test:e2e`
Expected: PASS (92 unit + 10 new from Tasks 1-2 = 102 unit; 317 + 4 new e2e = 321 e2e).

```bash
git add backend/src/handover/handover.controller.ts backend/src/handover/handover.module.ts backend/src/app.module.ts backend/test/handover-pack.e2e-spec.ts
git commit -m "feat: Committee Handover Pack endpoint (GET /organizations/:orgId/handover)"
```

---

## Post-plan: roadmap note

Once merged, this is the ninth Phase 2 item shipped. One Phase 2 roadmap item remains: Consent-versioned re-prompt.
