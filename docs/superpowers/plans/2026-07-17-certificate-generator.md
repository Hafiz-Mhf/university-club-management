# Certificate Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a committee member completes an event, automatically generate a PDF certificate (via `pdf-lib`) for every `PRESENT` attendee who doesn't already have one, store/serve it through the existing Certificate infrastructure, and notify the recipient by email — while leaving Phase 1's manual-upload path untouched (it also gains the same notification).

**Architecture:** A new `certificates/generation/` subfolder adds a BullMQ queue (`certificates`) with a fan-out producer (`CertificateGenerationService`) and a `WorkerHost` processor that renders via a pure `CertificatePdfService`, stores at the exact key manual upload already uses, and creates the same `Certificate` row Phase 1 creates. `EventsService.complete()` triggers the fan-out after its transition commits. The Email Notifications module (shipped this session) gains one more job kind, `certificate.ready`, fired from both the new processor and the existing `upload()` path.

**Tech Stack:** NestJS, `pdf-lib` (new dep, pure JS PDF generation, no native/browser deps), existing BullMQ/`@nestjs/bullmq`/Prisma/S3 infra.

## Global Constraints

- No new endpoints, no new RBAC surface — `enqueueBatchForEvent` is an internal side effect of the already-guarded `complete()` action (`MANAGE_EVENTS`).
- No new Prisma models or columns. Generated certificates reuse the exact same `Certificate` row shape as manual uploads (`storageKey`, `fileSizeBytes`, `uploadedByUserId`) and the exact same storage key convention: `` certificates/${organizationId}/${eventId}/${userId}.pdf ``.
- One new audit action, `certificate.generate` — same shape as `certificate.upload` (`targetType: 'Certificate'`, metadata `{ certificateId, eventId, userId }`).
- `notification.email`'s `certificate.ready` kind targets `Certificate` (`targetType: 'Certificate'`) — every prior kind targeted `Registration`; this is the first exception, and it's intentional (there's no `Registration` involved in a certificate).
- `@nestjs/bullmq` processors extend `WorkerHost` with one `process(job)` method switching on `job.name` — no per-kind `@Process(kind)` decorator (established in Email Notifications, applies here too).
- Eligibility for generation is identical to manual upload's existing rule: `Attendance.status === 'PRESENT'` for that event+user. A `PRESENT` attendee who already has a `Certificate` row (from a prior manual upload) is skipped, not overwritten.
- Quota-exceeded during a generation job: log a warning and skip that attendee (no `Certificate` row, no audit row) — **not** a thrown exception. There's no HTTP response to throw into inside a background job, and retrying via BullMQ's backoff wouldn't help (the quota won't change on its own). This refines the spec's "throws BadRequestException-equivalent" language into what's actually implementable in a worker.
- Baseline verified before writing this plan: unit `63 passed`, e2e `285 passed` (commit `60c3556`).

---

### Task 1: `StorageService.getObject` + `CertificatePdfService`

**Files:**
- Modify: `backend/src/storage/storage.service.ts`
- Modify: `backend/src/storage/storage.service.spec.ts`
- Modify: `backend/package.json` (add `pdf-lib`)
- Create: `backend/src/certificates/generation/certificate-pdf.service.ts`
- Test: `backend/src/certificates/generation/certificate-pdf.service.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `StorageService.getObject(key: string): Promise<Buffer>`. `CertificatePdfService.render(data: CertificateRenderData): Promise<Buffer>` where `CertificateRenderData = { participantFullName: string; eventTitle: string; eventDate: Date; orgName: string; orgPrimaryColor: string; orgLogoBytes: Buffer | null }`. Task 3's processor imports and calls both.

- [ ] **Step 1: Install `pdf-lib`**

```bash
cd backend && npm install pdf-lib
```

Expected: `backend/package.json` gains `pdf-lib` under `dependencies`; `package-lock.json` updates. No `@types` package needed — `pdf-lib` ships its own TypeScript types.

- [ ] **Step 2: Write the failing `getObject` test**

In `backend/src/storage/storage.service.spec.ts`, add this test inside the existing `describe` block, after the `'round-trips an object through putObject + a signed download URL'` test:

```ts
  it('getObject returns the exact bytes previously written', async () => {
    const key = `test/${Date.now()}-${Math.random()}.txt`;
    const body = Buffer.from('hello getObject');
    await storage.putObject(key, body, 'text/plain');

    const fetched = await storage.getObject(key);
    expect(fetched.equals(body)).toBe(true);

    await storage.deleteObject(key);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/storage/storage.service.spec.ts
```

Expected: FAIL — `storage.getObject is not a function`. (This suite hits real MinIO, so `docker compose up -d` must already be running — same precedent as the rest of this file.)

- [ ] **Step 4: Implement `getObject`**

In `backend/src/storage/storage.service.ts`, add `Readable` to the imports (for the response body stream helper) and add the method after `putObject`:

```ts
import { Readable } from 'stream';
```

```ts
  async getObject(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = response.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npx jest src/storage/storage.service.spec.ts
```

Expected: PASS, 3 tests (2 existing + 1 new).

- [ ] **Step 6: Write the failing `CertificatePdfService` test**

Create `backend/src/certificates/generation/certificate-pdf.service.spec.ts`:

```ts
import { PDFDocument } from 'pdf-lib';
import { CertificatePdfService } from './certificate-pdf.service';

// A minimal valid 1x1 transparent PNG, widely used as a test fixture.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('CertificatePdfService', () => {
  const service = new CertificatePdfService();
  const baseData = {
    participantFullName: 'Alex Tan',
    eventTitle: 'Tech Talk',
    eventDate: new Date('2026-08-01T10:00:00.000Z'),
    orgName: 'Coding Club',
    orgPrimaryColor: '#2563eb',
  };

  it('renders a valid single-page PDF without a logo', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: null });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders a valid PDF with a logo embedded', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: TINY_PNG });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });

  it('falls back to no logo (does not throw) when logo bytes are not a valid image', async () => {
    const buffer = await service.render({ ...baseData, orgLogoBytes: Buffer.from('not an image') });
    const doc = await PDFDocument.load(buffer);
    expect(doc.getPageCount()).toBe(1);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd backend && npx jest src/certificates/generation/certificate-pdf.service.spec.ts
```

Expected: FAIL — `Cannot find module './certificate-pdf.service'`.

- [ ] **Step 8: Implement `CertificatePdfService`**

Create `backend/src/certificates/generation/certificate-pdf.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

export interface CertificateRenderData {
  participantFullName: string;
  eventTitle: string;
  eventDate: Date;
  orgName: string;
  orgPrimaryColor: string;
  orgLogoBytes: Buffer | null;
}

const PAGE_WIDTH = 842; // A4 landscape, points
const PAGE_HEIGHT = 595;

@Injectable()
export class CertificatePdfService {
  private readonly logger = new Logger(CertificatePdfService.name);

  async render(data: CertificateRenderData): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const heading = await doc.embedFont(StandardFonts.HelveticaBold);
    const body = await doc.embedFont(StandardFonts.Helvetica);
    const accent = hexToRgb(data.orgPrimaryColor);
    const centerX = (text: string, font: PDFFont, size: number) =>
      PAGE_WIDTH / 2 - font.widthOfTextAtSize(text, size) / 2;

    page.drawRectangle({
      x: 20, y: 20, width: PAGE_WIDTH - 40, height: PAGE_HEIGHT - 40,
      borderColor: accent, borderWidth: 4,
    });

    if (data.orgLogoBytes) {
      const image = await this.embedLogo(doc, data.orgLogoBytes);
      if (image) {
        const logoWidth = 80;
        const logoHeight = (image.height / image.width) * logoWidth;
        page.drawImage(image, {
          x: PAGE_WIDTH / 2 - logoWidth / 2, y: PAGE_HEIGHT - 110,
          width: logoWidth, height: logoHeight,
        });
      }
    }

    const title = 'Certificate of Participation';
    page.drawText(title, { x: centerX(title, heading, 28), y: PAGE_HEIGHT - 180, size: 28, font: heading, color: accent });

    page.drawText(data.orgName, { x: centerX(data.orgName, body, 14), y: PAGE_HEIGHT - 210, size: 14, font: body });

    const intro = 'This certifies that';
    page.drawText(intro, { x: centerX(intro, body, 12), y: PAGE_HEIGHT - 260, size: 12, font: body });

    page.drawText(data.participantFullName, {
      x: centerX(data.participantFullName, heading, 22), y: PAGE_HEIGHT - 300, size: 22, font: heading,
    });

    const participation = `participated in "${data.eventTitle}"`;
    page.drawText(participation, { x: centerX(participation, body, 14), y: PAGE_HEIGHT - 335, size: 14, font: body });

    const dateLine = `on ${data.eventDate.toISOString().slice(0, 10)}`;
    page.drawText(dateLine, { x: centerX(dateLine, body, 12), y: PAGE_HEIGHT - 360, size: 12, font: body });

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  // Tries PNG then JPEG; on failure of both, logs and returns null so the
  // certificate still renders without an image rather than failing the job.
  private async embedLogo(doc: PDFDocument, bytes: Buffer) {
    try {
      return await doc.embedPng(bytes);
    } catch {
      try {
        return await doc.embedJpg(bytes);
      } catch (error) {
        this.logger.warn(`Failed to embed org logo in certificate: ${error}`);
        return null;
      }
    }
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16) / 255;
  const g = parseInt(normalized.substring(2, 4), 16) / 255;
  const b = parseInt(normalized.substring(4, 6), 16) / 255;
  return rgb(r, g, b);
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd backend && npx jest src/certificates/generation/certificate-pdf.service.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 10: Run the full unit suite**

```bash
cd backend && npm test
```

Expected: `67 passed` (63 baseline + 1 `getObject` + 3 `CertificatePdfService`).

- [ ] **Step 11: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/storage/storage.service.ts backend/src/storage/storage.service.spec.ts backend/src/certificates/generation/certificate-pdf.service.ts backend/src/certificates/generation/certificate-pdf.service.spec.ts
git commit -m "feat: add pdf-lib, StorageService.getObject, CertificatePdfService"
```

---

### Task 2: `certificate.ready` notification + wire into manual upload

**Files:**
- Modify: `backend/src/notifications/notifications.types.ts`
- Modify: `backend/src/notifications/notifications.service.ts`
- Modify: `backend/src/notifications/notifications.service.spec.ts`
- Modify: `backend/src/notifications/templates.ts`
- Modify: `backend/src/notifications/notifications.processor.ts`
- Modify: `backend/src/notifications/notifications.processor.spec.ts`
- Modify: `backend/src/certificates/certificates.module.ts`
- Modify: `backend/src/certificates/certificates.service.ts`
- Modify: `backend/test/certificates-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: existing `NotificationsService`/`NotificationsProcessor`/`templates.ts` from the Email Notifications feature (unchanged method signatures, extended in place).
- Produces: `NotificationsService.enqueueCertificateReady(organizationId: string, certificateId: string): Promise<unknown>`. `CertificatesService.upload(...)` keeps its exact existing signature and return shape — it now also enqueues a notification after its transaction commits. Task 3's processor calls `enqueueCertificateReady` too.

- [ ] **Step 1: Write the failing `NotificationsService` test**

In `backend/src/notifications/notifications.service.spec.ts`, add this test after `'enqueueRegistrationPromoted adds a registration.promoted job'`:

```ts
  it('enqueueCertificateReady adds a certificate.ready job', async () => {
    await service.enqueueCertificateReady('org1', 'cert1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.CertificateReady, { organizationId: 'org1', certificateId: 'cert1' });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/notifications.service.spec.ts
```

Expected: FAIL — `service.enqueueCertificateReady is not a function` (and `NotificationJobName.CertificateReady` is `undefined`).

- [ ] **Step 3: Add the new job kind, payload type, and enqueue method**

In `backend/src/notifications/notifications.types.ts`, add `CertificateReady` to the enum and a new payload interface:

```ts
export enum NotificationJobName {
  RegistrationApproved = 'registration.approved',
  RegistrationWaitlisted = 'registration.waitlisted',
  RegistrationRejected = 'registration.rejected',
  RegistrationPromoted = 'registration.promoted',
  RegistrationNew = 'registration.new',
  EventReminder = 'event.reminder',
  CertificateReady = 'certificate.ready',
}
```

```ts
export interface CertificateJobPayload {
  organizationId: string;
  certificateId: string;
}
```

In `backend/src/notifications/notifications.service.ts`, add the method after `cancelEventReminder`:

```ts
  enqueueCertificateReady(organizationId: string, certificateId: string) {
    return this.queue.add(NotificationJobName.CertificateReady, { organizationId, certificateId });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/notifications.service.spec.ts
```

Expected: PASS, 10 tests (9 existing + 1 new).

- [ ] **Step 5: Write the failing `NotificationsProcessor` test**

In `backend/src/notifications/notifications.processor.spec.ts`, the `prisma` variable has an explicit type annotation as well as a runtime value built in `beforeEach` — both need the new `certificate` key, or `prisma.certificate.findUnique` won't compile. Change the type declaration from:

```ts
  let prisma: {
    registration: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    event: { findUnique: jest.Mock };
  };
```

to:

```ts
  let prisma: {
    registration: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    event: { findUnique: jest.Mock };
    certificate: { findUnique: jest.Mock };
  };
```

And in `beforeEach`, add `certificate: { findUnique: jest.fn() },` to the `prisma = {...}` object literal (alongside the existing `registration`/`user`/`event` keys). Then add this test after `'skips event.reminder entirely when the event is no longer PUBLISHED'`:

```ts
  it('sends a certificate.ready email and audits it against the Certificate', async () => {
    prisma.certificate.findUnique.mockResolvedValue({
      user: { email: 'p@test.io', fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
    });
    await processor.process(fakeJob(NotificationJobName.CertificateReady, { organizationId: 'org1', certificateId: 'cert1' }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.io' }));
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: 'org1', action: 'notification.email',
      targetType: 'Certificate', targetId: 'cert1',
      metadata: { kind: NotificationJobName.CertificateReady },
    });
  });
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/notifications.processor.spec.ts
```

Expected: FAIL — `prisma.certificate is undefined` (the mock's `certificate` key doesn't exist until you add it per Step 5) or, once the mock object is added, FAIL because `process()` never reaches `sendMail`/`audit.record` for this job name yet.

- [ ] **Step 7: Add the template and processor branch**

In `backend/src/notifications/templates.ts`, add after `eventReminderEmail`:

```ts
export interface CertificateReadyEmailData {
  fullName: string;
  eventTitle: string;
}

export function certificateReadyEmail(data: CertificateReadyEmailData): { subject: string; text: string } {
  return {
    subject: `Your certificate is ready: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYour certificate for "${data.eventTitle}" is ready to download.\n`,
  };
}
```

In `backend/src/notifications/notifications.processor.ts`, add `CertificateJobPayload` to the type-only import from `./notifications.types` and `certificateReadyEmail` to the import from `./templates`:

```ts
import {
  CertificateJobPayload,
  CommitteeNewRegistrationJobPayload,
  EventReminderJobPayload,
  NOTIFICATION_QUEUE,
  NotificationJobName,
  RegistrationJobPayload,
} from './notifications.types';
import {
  certificateReadyEmail,
  committeeNewRegistrationEmail,
  eventReminderEmail,
  registrationApprovedEmail,
  registrationPromotedEmail,
  registrationRejectedEmail,
  registrationWaitlistedEmail,
} from './templates';
```

Add one more branch to `process()`:

```ts
  async process(job: Job): Promise<void> {
    const templateFn = OUTCOME_TEMPLATES[job.name as NotificationJobName];
    if (templateFn) return this.sendRegistrationOutcomeEmail(job, templateFn);
    if (job.name === NotificationJobName.RegistrationNew) return this.sendCommitteeNewRegistrationEmail(job);
    if (job.name === NotificationJobName.EventReminder) return this.sendEventReminders(job);
    if (job.name === NotificationJobName.CertificateReady) return this.sendCertificateReadyEmail(job);
  }
```

Add the new private method, after `sendEventReminders`:

```ts
  private async sendCertificateReadyEmail(job: Job): Promise<void> {
    const { organizationId, certificateId } = job.data as CertificateJobPayload;
    const certificate = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { user: { select: { email: true, fullName: true } }, event: { select: { title: true } } },
    });
    if (!certificate) return;

    const { subject, text } = certificateReadyEmail({ fullName: certificate.user.fullName, eventTitle: certificate.event.title });
    await this.mailer.sendMail({ to: certificate.user.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Certificate', targetId: certificateId,
      metadata: { kind: job.name },
    });
  }
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/notifications.processor.spec.ts
```

Expected: PASS, 6 tests (5 existing + 1 new).

- [ ] **Step 9: Write the failing e2e assertion for manual upload's notification**

In `backend/test/certificates-upload.e2e-spec.ts`, add this test at the end of the `describe` block, after the `'409 on a duplicate upload...'` test:

```ts
  it('a successful upload also enqueues a certificate.ready notification (audited)', async () => {
    const { userId } = await presentParticipant();
    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', pdfBytes(), { filename: 'cert.pdf', contentType: 'application/pdf' })
      .expect(201);
    const certificateId = uploadRes.body.id;

    const deadline = Date.now() + 5000;
    for (;;) {
      const rows = await request(app.getHttpServer())
        .get(`/organizations/${orgId}/audit-logs`)
        .set('Authorization', `Bearer ${presToken}`)
        .query({ action: 'notification.email', pageSize: 100 });
      if (rows.body.data.some((r: { targetId: string }) => r.targetId === certificateId)) break;
      if (Date.now() > deadline) throw new Error('Timed out waiting for certificate.ready audit row');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });
```

- [ ] **Step 10: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificates-upload
```

Expected: FAIL — timeout, no `notification.email` row is ever written (`upload()` doesn't call `enqueueCertificateReady` yet).

- [ ] **Step 11: Wire `NotificationsModule` into `CertificatesModule` and `upload()`**

Replace the full contents of `backend/src/certificates/certificates.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [StorageModule, NotificationsModule],
  controllers: [CertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
```

In `backend/src/certificates/certificates.service.ts`, add the import:

```ts
import { NotificationsService } from '../notifications/notifications.service';
```

Update the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}
```

In `upload()`, the method currently ends with:

```ts
    try {
      // Create + audit are atomic, matching every other mutating service.
      // If the audit insert fails and rolls back the create, the storage
      // object is left at the deterministic key with no DB row — that is
      // self-healing: a retry passes the pre-check and overwrites it.
      return await this.prisma.$transaction(async (tx) => {
        const certificate = await tx.certificate.create({
          data: {
            eventId, organizationId, userId: targetUserId,
            storageKey, fileSizeBytes: file.size, uploadedByUserId: actorUserId,
          },
        });
        await this.audit.record({
          organizationId, actorUserId, action: 'certificate.upload',
          targetType: 'Certificate', targetId: certificate.id,
          metadata: { certificateId: certificate.id, eventId, userId: targetUserId },
        }, tx);
        return certificate;
      });
    } catch (error) {
      // Narrow residual race the pre-check above doesn't fully close (two
      // uploads for the same event+user landing within the same instant).
      // Do NOT delete the storage object here — the key is shared, and a
      // losing request can't tell its own bytes apart from the winner's.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A certificate already exists for this person and event');
      }
      throw error;
    }
  }
```

Change it to capture the result, enqueue after the transaction commits, then return:

```ts
    let certificate;
    try {
      // Create + audit are atomic, matching every other mutating service.
      // If the audit insert fails and rolls back the create, the storage
      // object is left at the deterministic key with no DB row — that is
      // self-healing: a retry passes the pre-check and overwrites it.
      certificate = await this.prisma.$transaction(async (tx) => {
        const created = await tx.certificate.create({
          data: {
            eventId, organizationId, userId: targetUserId,
            storageKey, fileSizeBytes: file.size, uploadedByUserId: actorUserId,
          },
        });
        await this.audit.record({
          organizationId, actorUserId, action: 'certificate.upload',
          targetType: 'Certificate', targetId: created.id,
          metadata: { certificateId: created.id, eventId, userId: targetUserId },
        }, tx);
        return created;
      });
    } catch (error) {
      // Narrow residual race the pre-check above doesn't fully close (two
      // uploads for the same event+user landing within the same instant).
      // Do NOT delete the storage object here — the key is shared, and a
      // losing request can't tell its own bytes apart from the winner's.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A certificate already exists for this person and event');
      }
      throw error;
    }

    await this.notifications.enqueueCertificateReady(organizationId, certificate.id);
    return certificate;
  }
```

(Only the `return await this.prisma.$transaction(...)` line changes to `certificate = await this.prisma.$transaction(...)`, declared via `let certificate;` above the `try`, plus the two new lines after the `catch` block. The transaction body's inner logic and the `catch` block's P2002 handling are otherwise untouched — the inner variable was renamed from `certificate` to `created` only to avoid shadowing the outer `certificate`.)

- [ ] **Step 12: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificates-upload
```

Expected: all 9 tests PASS (8 existing + 1 new).

- [ ] **Step 13: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `69 passed` (67 from Task 1 + 1 `NotificationsService` + 1 `NotificationsProcessor`); e2e `286 passed` (285 baseline + 1 new in `certificates-upload.e2e-spec.ts`).

- [ ] **Step 14: Commit**

```bash
git add backend/src/notifications/notifications.types.ts backend/src/notifications/notifications.service.ts backend/src/notifications/notifications.service.spec.ts backend/src/notifications/templates.ts backend/src/notifications/notifications.processor.ts backend/src/notifications/notifications.processor.spec.ts backend/src/certificates/certificates.module.ts backend/src/certificates/certificates.service.ts backend/test/certificates-upload.e2e-spec.ts
git commit -m "feat: add certificate.ready notification, wire into manual upload"
```

---

### Task 3: `CertificateGenerationService` + `CertificateGenerationProcessor`

**Files:**
- Create: `backend/src/certificates/generation/certificate-generation.types.ts`
- Create: `backend/src/certificates/generation/certificate-generation.service.ts`
- Test: `backend/src/certificates/generation/certificate-generation.service.spec.ts`
- Create: `backend/src/certificates/generation/certificate-generation.processor.ts`
- Test: `backend/src/certificates/generation/certificate-generation.processor.spec.ts`
- Modify: `backend/src/certificates/certificates.module.ts`

**Interfaces:**
- Consumes: `CertificatePdfService.render(...)` (Task 1), `NotificationsService.enqueueCertificateReady(...)` (Task 2), `PrismaService`/`AuditService`/`StorageService` (all pre-existing, `@Global()` or already imported).
- Produces: `CertificateGenerationService.enqueueBatchForEvent(organizationId: string, eventId: string, actorUserId: string | undefined): Promise<void>`. Task 4's `EventsService.complete()` calls this.

- [ ] **Step 1: Create the shared job types**

Create `backend/src/certificates/generation/certificate-generation.types.ts`:

```ts
export const CERTIFICATE_QUEUE = 'certificates';

export const CERTIFICATE_GENERATE_JOB = 'certificate.generate';

export interface CertificateGenerateJobPayload {
  organizationId: string;
  eventId: string;
  userId: string;
  actorUserId?: string;
}
```

- [ ] **Step 2: Write the failing `CertificateGenerationService` test**

Create `backend/src/certificates/generation/certificate-generation.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CertificateGenerationService } from './certificate-generation.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE } from './certificate-generation.types';

describe('CertificateGenerationService', () => {
  let service: CertificateGenerationService;
  let queue: { add: jest.Mock };
  let prisma: {
    attendance: { findMany: jest.Mock };
    certificate: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      certificate: { findMany: jest.fn().mockResolvedValue([]) },
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/certificates/generation/certificate-generation.service.spec.ts
```

Expected: FAIL — `Cannot find module './certificate-generation.service'`.

- [ ] **Step 4: Implement `CertificateGenerationService`**

Create `backend/src/certificates/generation/certificate-generation.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE } from './certificate-generation.types';

@Injectable()
export class CertificateGenerationService {
  constructor(
    @InjectQueue(CERTIFICATE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueBatchForEvent(organizationId: string, eventId: string, actorUserId: string | undefined): Promise<void> {
    const attendees = await this.prisma.attendance.findMany({
      where: { eventId, organizationId, status: 'PRESENT' },
      select: { registration: { select: { userId: true } } },
    });
    const userIds = attendees.map((a) => a.registration.userId);
    if (userIds.length === 0) return;

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
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npx jest src/certificates/generation/certificate-generation.service.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing `CertificateGenerationProcessor` test**

Create `backend/src/certificates/generation/certificate-generation.processor.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateGenerationProcessor } from './certificate-generation.processor';
import { CERTIFICATE_GENERATE_JOB } from './certificate-generation.types';

function fakeJob(data: unknown) {
  return { id: 'job1', name: CERTIFICATE_GENERATE_JOB, data } as any;
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

    const moduleRef = await Test.createTestingModule({
      providers: [
        CertificateGenerationProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: CertificatePdfService, useValue: pdf },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    processor = moduleRef.get(CertificateGenerationProcessor);
  });

  it('renders, stores, creates the Certificate row, audits, and notifies', async () => {
    await processor.process(fakeJob(jobPayload));

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
    await processor.process(fakeJob(jobPayload));
    expect(pdf.render).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.certificate.create).not.toHaveBeenCalled();
  });

  it('falls back to no logo when the logo fetch fails, and still generates the certificate', async () => {
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: 'logos/org1.png', primaryColor: '#2563eb', storageQuotaMb: 1024 });
    storage.getObject.mockRejectedValue(new Error('not found'));

    await processor.process(fakeJob(jobPayload));

    expect(pdf.render).toHaveBeenCalledWith(expect.objectContaining({ orgLogoBytes: null }));
    expect(prisma.certificate.create).toHaveBeenCalled();
  });

  it('skips (no create, no audit, no notify) when generating would exceed the storage quota', async () => {
    prisma.certificate.aggregate.mockResolvedValue({ _sum: { fileSizeBytes: 1024 * 1024 * 1024 } });
    prisma.organization.findUnique.mockResolvedValue({ name: 'Coding Club', logoKey: null, primaryColor: '#2563eb', storageQuotaMb: 1 });

    await processor.process(fakeJob(jobPayload));

    expect(prisma.certificate.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(notifications.enqueueCertificateReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd backend && npx jest src/certificates/generation/certificate-generation.processor.spec.ts
```

Expected: FAIL — `Cannot find module './certificate-generation.processor'`.

- [ ] **Step 8: Implement `CertificateGenerationProcessor`**

Create `backend/src/certificates/generation/certificate-generation.processor.ts`:

```ts
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CertificatePdfService } from './certificate-pdf.service';
import { CERTIFICATE_GENERATE_JOB, CERTIFICATE_QUEUE, CertificateGenerateJobPayload } from './certificate-generation.types';

@Processor(CERTIFICATE_QUEUE)
export class CertificateGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(CertificateGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: CertificatePdfService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
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

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd backend && npx jest src/certificates/generation/certificate-generation.processor.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 10: Wire the queue and new providers into `CertificatesModule`**

Replace the full contents of `backend/src/certificates/certificates.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CERTIFICATE_QUEUE } from './generation/certificate-generation.types';
import { CertificateGenerationService } from './generation/certificate-generation.service';
import { CertificateGenerationProcessor } from './generation/certificate-generation.processor';
import { CertificatePdfService } from './generation/certificate-pdf.service';

@Module({
  imports: [StorageModule, NotificationsModule, BullModule.registerQueue({ name: CERTIFICATE_QUEUE })],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateGenerationService, CertificateGenerationProcessor, CertificatePdfService],
  exports: [CertificatesService, CertificateGenerationService],
})
export class CertificatesModule {}
```

- [ ] **Step 11: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `76 passed` (69 from Task 2 + 3 `CertificateGenerationService` + 4 `CertificateGenerationProcessor`); e2e `286 passed` (unchanged — nothing calls `enqueueBatchForEvent` yet).

- [ ] **Step 12: Commit**

```bash
git add backend/src/certificates/generation/certificate-generation.types.ts backend/src/certificates/generation/certificate-generation.service.ts backend/src/certificates/generation/certificate-generation.service.spec.ts backend/src/certificates/generation/certificate-generation.processor.ts backend/src/certificates/generation/certificate-generation.processor.spec.ts backend/src/certificates/certificates.module.ts
git commit -m "feat: CertificateGenerationService, CertificateGenerationProcessor"
```

---

### Task 4: Wire `EventsService.complete()` to trigger generation

**Files:**
- Modify: `backend/src/events/events.module.ts`
- Modify: `backend/src/events/events.service.ts`
- Test: `backend/test/certificate-generation.e2e-spec.ts`

**Interfaces:**
- Consumes: `CertificateGenerationService.enqueueBatchForEvent(...)` from Task 3, now exported by `CertificatesModule`.
- Produces: no new public methods — `complete()` keeps its exact existing signature and return shape.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/certificate-generation.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Certificate auto-generation on event.complete (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    presToken = await registerAndLogin(`certgen-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'CertGenOrg', slug: `certgen-${Date.now()}` })).body.id;
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
    const email = `certgen-p-${Date.now()}-${Math.random()}@test.io`;
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

  async function waitForCertificates(eventId: string, count: number, timeoutMs = 8000) {
    const start = Date.now();
    for (;;) {
      const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
      if (certs.length >= count) return certs;
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${count} certificate(s), have ${certs.length}`);
      await wait(200);
    }
  }

  it('completing an event generates a certificate for each PRESENT attendee, audited', async () => {
    const eventId = await createPublishedEvent('Auto Cert Event');
    const { userId: userA } = await presentParticipant(eventId);
    const { userId: userB } = await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const certs = await waitForCertificates(eventId, 2);
    expect(certs.map((c) => c.userId).sort()).toEqual([userA, userB].sort());

    const auditRows = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'certificate.generate', pageSize: 100 });
    const generatedIds = auditRows.body.data.map((r: { targetId: string }) => r.targetId);
    expect(certs.every((c) => generatedIds.includes(c.id))).toBe(true);
  });

  it('an attendee with a pre-existing manual upload is skipped by generation, and stays downloadable', async () => {
    const eventId = await createPublishedEvent('Mixed Cert Event');
    const { userId } = await presentParticipant(eventId);

    const uploadRes = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/certificates`)
      .set('Authorization', `Bearer ${presToken}`)
      .field('userId', userId)
      .attach('file', Buffer.from('%PDF-1.4\n%manual\n'), { filename: 'manual.pdf', contentType: 'application/pdf' })
      .expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    // Give the (empty) generation queue a moment, then confirm exactly one
    // Certificate row exists — the manually-uploaded one, untouched.
    await wait(1000);
    const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
    expect(certs).toHaveLength(1);
    expect(certs[0].id).toBe(uploadRes.body.id);

    await request(app.getHttpServer())
      .get(`/organizations/${orgId}/events/${eventId}/certificates/${uploadRes.body.id}/download`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });

  it('a registrant who was never marked PRESENT gets no certificate', async () => {
    const eventId = await createPublishedEvent('No Attendance Event');
    const email = `certgen-np-${Date.now()}@test.io`;
    const token = await registerAndLogin(email);
    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await wait(1000);
    const certs = await prisma.certificate.findMany({ where: { eventId, organizationId: orgId } });
    expect(certs).toHaveLength(0);
  });

  it("tenant isolation: completing org A's event never generates a certificate referencing org B", async () => {
    const otherPresToken = await registerAndLogin(`certgen-iso-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'CertGenIsoOrg', slug: `certgen-iso-${Date.now()}` })).body.id;

    const eventId = await createPublishedEvent('Isolation Event');
    await presentParticipant(eventId);

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/complete`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    await waitForCertificates(eventId, 1);

    const otherOrgCerts = await prisma.certificate.findMany({ where: { organizationId: otherOrgId } });
    expect(otherOrgCerts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificate-generation
```

Expected: FAIL — `waitForCertificates` times out on the first test (nothing enqueues generation jobs yet, so `complete()` produces zero certificates).

- [ ] **Step 3: Wire `CertificatesModule` into `EventsModule`**

Replace the full contents of `backend/src/events/events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [NotificationsModule, CertificatesModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
```

- [ ] **Step 4: Inject `CertificateGenerationService` and call it from `complete()`**

In `backend/src/events/events.service.ts`, add the import:

```ts
import { CertificateGenerationService } from '../certificates/generation/certificate-generation.service';
```

Update the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly certificateGeneration: CertificateGenerationService,
  ) {}
```

Update `complete()`:

```ts
  async complete(organizationId: string, eventId: string, actorUserId?: string) {
    const updated = await this.transition(
      organizationId, eventId, 'event.complete', 'COMPLETED',
      (s) => s === 'PUBLISHED', actorUserId,
    );
    await this.notifications.cancelEventReminder(eventId);
    await this.certificateGeneration.enqueueBatchForEvent(organizationId, eventId, actorUserId);
    return updated;
  }
```

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json certificate-generation
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `76 passed` (unchanged — no new unit tests this task); e2e `290 passed` (286 from Task 2 + 4 new in `certificate-generation.e2e-spec.ts`). This full run also re-executes every pre-existing `events-*.e2e-spec.ts` and `certificates-*.e2e-spec.ts` file, confirming `complete()`'s change doesn't break anything else.

- [ ] **Step 7: Commit**

```bash
git add backend/src/events/events.module.ts backend/src/events/events.service.ts backend/test/certificate-generation.e2e-spec.ts
git commit -m "feat: wire certificate auto-generation into event.complete()"
```

---

### Task 5: Docs sync

**Files:**
- Modify: `docs/security.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — email notifications (shipped)` section (the most recent one), and add a new `### As built — certificate generator (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`):

```markdown
### As built — certificate generator (shipped)

No new endpoints — an internal side effect of `EventsService.complete()`, via a second BullMQ queue (`certificates`, alongside `notifications`) and a new `generation/` subfolder in the existing `backend/src/certificates/` module.

On `complete()`, one `certificate.generate` job is enqueued per `PRESENT` attendee who doesn't already have a `Certificate` row (same eligibility rule Phase 1's manual upload already enforces). Each job renders a landscape PDF via `pdf-lib` (`CertificatePdfService` — participant name, event title, event date, org name/logo/`primaryColor`, no verification code, no signature line), stores it at the exact key manual upload already uses (`certificates/<orgId>/<eventId>/<userId>.pdf`), and creates the same `Certificate` row shape Phase 1 creates (`uploadedByUserId` = the actor who called `complete()`). A `Certificate` row created first by either path (generate or manual upload) wins — the other is a no-op, enforced by `@@unique([eventId, userId])` plus a race-guard existence check inside the processor.

Storage quota exceeded during generation: logged and skipped (no `Certificate` row, no audit row) — not thrown, since there's no HTTP response to throw into inside a background job and BullMQ's retry wouldn't help (quota doesn't change on retry).

**Email Notifications extension:** one more job kind, `certificate.ready`, fired from both the new generation processor and the existing manual `upload()` path — participants get notified regardless of how their certificate was created. Reuses the exact same `notification.email` audit action; this is the first `notification.email` kind whose `targetType` is `Certificate` rather than `Registration`.

**Audit:** one new action, `certificate.generate` — same shape as `certificate.upload` (`targetType: 'Certificate'`, metadata `{ certificateId, eventId, userId }`).

No new Prisma models or columns. `TENANT_SCOPED_MODELS` unchanged.
```

- [ ] **Step 2: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `76 passed`; e2e `290 passed` (docs changes add no tests).

- [ ] **Step 3: Commit**

```bash
git add docs/security.md
git commit -m "docs: sync security.md for certificate generator"
```

---

## Post-plan: roadmap note

Certificate Generator (Phase 2 item 7) is now shippable end-to-end:
completing an event auto-generates a branded PDF certificate for every
`PRESENT` attendee without one, manual upload stays available and now also
notifies, and the Email Notifications module gained its second target type
(`Certificate`, alongside `Registration`). Four Phase 2 items remain, no
fixed dependency order: Branding & Themes, Event Feedback+NPS, Committee
Handover Pack, Consent-versioned re-prompt.
