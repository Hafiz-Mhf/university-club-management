# Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send transactional email — registration confirmation/waitlist/rejection/promotion, a committee "new registration" notice, and a 24h-before-event reminder — via a new BullMQ-backed `NotificationsModule`, with no new HTTP endpoints.

**Architecture:** A single BullMQ queue (`notifications`, backed by the already-provisioned `redis` container) holds one job per outbound email. `NotificationsService` exposes `enqueue*`/`scheduleEventReminder`/`cancelEventReminder` methods that `RegistrationsService` and `EventsService` call *after* their triggering `$transaction` commits. `NotificationsProcessor` (a `WorkerHost`) is the sole consumer: it re-fetches data via Prisma, builds a plain-text `{subject, text}` via `templates.ts`, sends via `MailerService` (nodemailer → a new `mailpit` dev container), and audits the send. No new Prisma models.

**Tech Stack:** NestJS, `bullmq` + `@nestjs/bullmq` (new), `nodemailer` (new), existing Prisma/AuditService/RBAC infra.

## Global Constraints

- No new HTTP endpoints, no new RBAC surface — every enqueue call is an internal side effect of an already-guarded action (`register`, `reject`, `publish`, `update`, `cancel`, `complete`).
- Job kinds (BullMQ job `name`, exact strings): `registration.approved`, `registration.waitlisted`, `registration.rejected`, `registration.promoted`, `registration.new`, `event.reminder`.
- Reminder lead time is fixed at 24h before `Event.startAt`, not configurable. Reminder job id is always the deterministic string `` `reminder:${eventId}` `` so it can be found/removed/replaced.
- `@nestjs/bullmq` processors extend `WorkerHost` and implement one `process(job)` method that switches on `job.name` — there is no per-kind `@Process(kind)` decorator (that belongs to the older `@nestjs/bull`/Bull API, not BullMQ).
- One new audit action: `notification.email`, always `targetType: 'Registration'`, `targetId: <registrationId>`, `metadata: { kind }` — never the recipient's email address or message body. Written only on successful send.
- No opt-out/unsubscribe, no HTML templates, no persistent delivery-log table, no outbox pattern — all explicitly out of scope per the spec. Enqueue calls happen after their triggering transaction commits, never inside the `tx` callback.
- **Deviation from the spec's "Unit additions to existing services" section:** `RegistrationsService` and `EventsService` have **no pre-existing unit-spec files** — every other CRUD-style service in this codebase (`MinutesService`, `AssetsService`, `FilesService`, `GalleryService`, `AchievementsService`) is e2e-only, with unit tests reserved for pure/isolated services (`AuditService`, `AttendanceTokenService`, etc). This plan follows that stronger precedent: the new enqueue call sites in `RegistrationsService`/`EventsService` are covered by e2e tests only (Tasks 4–5), not by new unit-test scaffolding for two previously-untested services. The new `notifications/` module itself (self-contained, no prior test debt) gets full unit coverage in Tasks 2–3.
- Every e2e file's `registerAndLogin` helper must send `consent: true` on `/auth/register` (required since the PDPA phase) or every registration in that file 400s.
- This repo has no CI pipeline yet — e2e tests run against the same local `redis` (existing) and `mailpit` (new, Task 1) docker-compose containers every other e2e suite already depends on for its own infra (e.g. `files-upload.e2e-spec.ts` against real MinIO). `docker compose up -d` must be running before `npm run test:e2e`.
- Baseline verified before writing this plan: unit `40 passed`, e2e `276 passed` (commit `e30a4f0`).

---

### Task 1: Dependencies, env config, docker-compose, BullMQ root wiring

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/.env.example`
- Modify: `backend/src/config/env.validation.ts`
- Modify: `backend/src/config/env.validation.spec.ts`
- Modify: `docker-compose.yml`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `envValidationSchema` now validates/defaults `REDIS_URL`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM`. `AppModule` registers `BullModule.forRootAsync(...)` app-wide, so any feature module can `BullModule.registerQueue({ name })` and inject queues/processors from Task 3 onward. A `mailpit` container is running locally (SMTP `:1025`, web UI `:8025`).

- [ ] **Step 1: Install the new dependencies**

```bash
cd backend && npm install bullmq @nestjs/bullmq nodemailer
npm install -D @types/nodemailer
```

Expected: `backend/package.json` gains `bullmq`, `@nestjs/bullmq`, `nodemailer` under `dependencies` and `@types/nodemailer` under `devDependencies`; `backend/package-lock.json` updates.

- [ ] **Step 2: Write the failing env-validation assertions**

Open `backend/src/config/env.validation.spec.ts`. In the `'accepts a valid env and applies defaults'` test, add these lines after the existing `expect(value.PORT).toBe(3001);`:

```ts
    expect(value.REDIS_URL).toBe('redis://localhost:6379');
    expect(value.MAIL_HOST).toBe('localhost');
    expect(value.MAIL_PORT).toBe(1025);
    expect(value.MAIL_USER).toBe('');
    expect(value.MAIL_PASS).toBe('');
    expect(value.MAIL_FROM).toBe('University Club Platform <no-reply@ucm.local>');
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/config/env.validation.spec.ts
```

Expected: FAIL — `value.REDIS_URL` etc. are `undefined` (schema has `.unknown(true)` so no error is thrown, but the new keys aren't defaulted yet).

- [ ] **Step 4: Add the new keys to the schema**

Replace the full contents of `backend/src/config/env.validation.ts`:

```ts
import * as Joi from 'joi';

// Fail-fast schema — ConfigModule throws at boot if these are missing/invalid.
export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required().invalid(Joi.ref('JWT_ACCESS_SECRET')),
  ATTENDANCE_TOKEN_SECRET: Joi.string().min(16).required(),
  JWT_ACCESS_TTL: Joi.string().default('900s'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  PORT: Joi.number().default(3001),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  MAIL_HOST: Joi.string().default('localhost'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_USER: Joi.string().allow('').default(''),
  MAIL_PASS: Joi.string().allow('').default(''),
  MAIL_FROM: Joi.string().default('University Club Platform <no-reply@ucm.local>'),
}).unknown(true);
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npx jest src/config/env.validation.spec.ts
```

Expected: PASS, all assertions including the new ones.

- [ ] **Step 6: Document the new env vars**

Append to `backend/.env.example`:

```text
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_USER=
MAIL_PASS=
MAIL_FROM="University Club Platform <no-reply@ucm.local>"
```

- [ ] **Step 7: Add the mailpit container**

In `docker-compose.yml`, add a new service (after `redis:`, before `volumes:`):

```yaml
  mailpit:
    image: axllent/mailpit
    ports:
      - "1025:1025"
      - "8025:8025"
```

- [ ] **Step 8: Bring up mailpit and verify it's running**

```bash
docker compose up -d mailpit
docker compose ps
```

Expected: `mailpit` service listed with status `Up`, ports `1025->1025` and `8025->8025`.

- [ ] **Step 9: Wire `BullModule.forRootAsync` into `AppModule`**

In `backend/src/app.module.ts`, add these two imports (after the `ConfigModule` import):

```ts
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
```

In the `imports` array, add `BullModule.forRootAsync(...)` directly after `ConfigModule.forRoot(...)`:

```ts
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            password: redisUrl.password || undefined,
          },
        };
      },
    }),
    PrismaModule,
```

- [ ] **Step 10: Run the full suite to confirm nothing broke**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `40 passed` (no new test cases this step, only new assertions inside an existing one); e2e `276 passed` (unchanged — `AppModule` now opens a Redis connection at boot, which must not break any existing test).

- [ ] **Step 11: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/.env.example backend/src/config/env.validation.ts backend/src/config/env.validation.spec.ts docker-compose.yml backend/src/app.module.ts
git commit -m "feat: add BullMQ + nodemailer deps, mail env config, mailpit container"
```

---

### Task 2: `MailerService` + email templates

**Files:**
- Create: `backend/src/notifications/templates.ts`
- Test: `backend/src/notifications/templates.spec.ts`
- Create: `backend/src/notifications/mailer.service.ts`
- Test: `backend/src/notifications/mailer.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService` (`MAIL_HOST`/`MAIL_PORT`/`MAIL_USER`/`MAIL_PASS`/`MAIL_FROM`, all defaulted by Task 1).
- Produces: six pure template functions — `registrationApprovedEmail`, `registrationWaitlistedEmail`, `registrationRejectedEmail`, `registrationPromotedEmail(data: { fullName: string; eventTitle: string }): { subject: string; text: string }`; `committeeNewRegistrationEmail(data: { eventTitle: string; registrantFullName: string; status: string }): { subject: string; text: string }`; `eventReminderEmail(data: { fullName: string; eventTitle: string; venue: string | null; startAt: Date }): { subject: string; text: string }`. `MailerService.sendMail(params: { to: string; subject: string; text: string }): Promise<void>`. Task 3's `NotificationsProcessor` imports both.

- [ ] **Step 1: Write the failing templates test**

Create `backend/src/notifications/templates.spec.ts`:

```ts
import {
  registrationApprovedEmail,
  registrationWaitlistedEmail,
  registrationRejectedEmail,
  registrationPromotedEmail,
  committeeNewRegistrationEmail,
  eventReminderEmail,
} from './templates';

describe('notification email templates', () => {
  const data = { fullName: 'Alex Tan', eventTitle: 'Tech Talk' };

  it('registrationApprovedEmail includes the event title and a confirmation subject', () => {
    const { subject, text } = registrationApprovedEmail(data);
    expect(subject).toContain('Tech Talk');
    expect(subject.toLowerCase()).toContain('confirmed');
    expect(text).toContain('Alex Tan');
    expect(text).toContain('Tech Talk');
  });

  it('registrationWaitlistedEmail mentions the waitlist', () => {
    const { subject, text } = registrationWaitlistedEmail(data);
    expect(subject.toLowerCase()).toContain('waitlist');
    expect(text.toLowerCase()).toContain('waitlist');
  });

  it('registrationRejectedEmail does not claim approval', () => {
    const { subject, text } = registrationRejectedEmail(data);
    expect(subject).toContain('Tech Talk');
    expect(text.toLowerCase()).toContain('not approved');
  });

  it('registrationPromotedEmail mentions moving off the waitlist to confirmed', () => {
    const { text } = registrationPromotedEmail(data);
    expect(text.toLowerCase()).toContain('waitlist');
    expect(text.toLowerCase()).toContain('confirmed');
  });

  it('committeeNewRegistrationEmail includes registrant name, event title, and status', () => {
    const { subject, text } = committeeNewRegistrationEmail({
      eventTitle: 'Tech Talk', registrantFullName: 'Alex Tan', status: 'APPROVED',
    });
    expect(subject).toContain('Tech Talk');
    expect(text).toContain('Alex Tan');
    expect(text).toContain('APPROVED');
  });

  it('eventReminderEmail includes the venue when provided', () => {
    const startAt = new Date('2026-08-01T10:00:00.000Z');
    const { subject, text } = eventReminderEmail({
      fullName: 'Alex Tan', eventTitle: 'Tech Talk', venue: 'Main Hall', startAt,
    });
    expect(subject).toContain('Tech Talk');
    expect(text).toContain('Main Hall');
    expect(text).toContain(startAt.toISOString());
  });

  it('eventReminderEmail omits the venue line when venue is null', () => {
    const startAt = new Date('2026-08-01T10:00:00.000Z');
    const { text } = eventReminderEmail({
      fullName: 'Alex Tan', eventTitle: 'Tech Talk', venue: null, startAt,
    });
    expect(text).not.toContain(' at null');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/templates.spec.ts
```

Expected: FAIL — `Cannot find module './templates'`.

- [ ] **Step 3: Implement the templates**

Create `backend/src/notifications/templates.ts`:

```ts
export interface RegistrationOutcomeEmailData {
  fullName: string;
  eventTitle: string;
}

export function registrationApprovedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're confirmed: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYour registration for "${data.eventTitle}" is confirmed. See you there!\n`,
  };
}

export function registrationWaitlistedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're on the waitlist: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYou're on the waitlist for "${data.eventTitle}". We'll email you if a spot opens up.\n`,
  };
}

export function registrationRejectedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `Registration update: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nYour registration for "${data.eventTitle}" was not approved this time.\n`,
  };
}

export function registrationPromotedEmail(data: RegistrationOutcomeEmailData): { subject: string; text: string } {
  return {
    subject: `You're in: ${data.eventTitle}`,
    text: `Hi ${data.fullName},\n\nA spot opened up — you've been moved from the waitlist to confirmed for "${data.eventTitle}".\n`,
  };
}

export interface CommitteeNewRegistrationEmailData {
  eventTitle: string;
  registrantFullName: string;
  status: string;
}

export function committeeNewRegistrationEmail(data: CommitteeNewRegistrationEmailData): { subject: string; text: string } {
  return {
    subject: `New registration: ${data.eventTitle}`,
    text: `${data.registrantFullName} just registered for "${data.eventTitle}" (status: ${data.status}).\n`,
  };
}

export interface EventReminderEmailData {
  fullName: string;
  eventTitle: string;
  venue: string | null;
  startAt: Date;
}

export function eventReminderEmail(data: EventReminderEmailData): { subject: string; text: string } {
  const venueLine = data.venue ? ` at ${data.venue}` : '';
  return {
    subject: `Reminder: ${data.eventTitle} is tomorrow`,
    text: `Hi ${data.fullName},\n\nThis is a reminder that "${data.eventTitle}" starts at ${data.startAt.toISOString()}${venueLine}.\n`,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/templates.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing MailerService test**

Create `backend/src/notifications/mailer.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailerService } from './mailer.service';

const sendMailMock = jest.fn().mockResolvedValue(undefined);
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: sendMailMock })),
}));

describe('MailerService', () => {
  let config: Record<string, unknown>;

  async function build(): Promise<MailerService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailerService,
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      ],
    }).compile();
    return moduleRef.get(MailerService);
  }

  beforeEach(() => {
    sendMailMock.mockClear();
    (nodemailer.createTransport as jest.Mock).mockClear();
    config = {
      MAIL_HOST: 'localhost',
      MAIL_PORT: 1025,
      MAIL_USER: '',
      MAIL_PASS: '',
      MAIL_FROM: 'no-reply@ucm.local',
    };
  });

  it('creates a transport with no auth when MAIL_USER is empty', async () => {
    await build();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'localhost', port: 1025, auth: undefined }),
    );
  });

  it('creates a transport with auth when MAIL_USER is set', async () => {
    config.MAIL_USER = 'smtpuser';
    config.MAIL_PASS = 'smtppass';
    await build();
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'smtpuser', pass: 'smtppass' } }),
    );
  });

  it('sendMail calls the transporter with from/to/subject/text', async () => {
    const service = await build();
    await service.sendMail({ to: 'a@b.com', subject: 'Hi', text: 'Body' });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@ucm.local', to: 'a@b.com', subject: 'Hi', text: 'Body',
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/mailer.service.spec.ts
```

Expected: FAIL — `Cannot find module './mailer.service'`.

- [ ] **Step 7: Implement `MailerService`**

Create `backend/src/notifications/mailer.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class MailerService {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER', '');
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST', 'localhost'),
      port: this.config.get<number>('MAIL_PORT', 1025),
      auth: user ? { user, pass: this.config.get<string>('MAIL_PASS', '') } : undefined,
    });
  }

  async sendMail(params: SendMailParams): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.get<string>('MAIL_FROM'),
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/mailer.service.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 9: Run the full unit suite**

```bash
cd backend && npm test
```

Expected: `50 passed` (40 baseline + 7 templates + 3 mailer).

- [ ] **Step 10: Commit**

```bash
git add backend/src/notifications/templates.ts backend/src/notifications/templates.spec.ts backend/src/notifications/mailer.service.ts backend/src/notifications/mailer.service.spec.ts
git commit -m "feat: notification email templates and MailerService"
```

---

### Task 3: `NotificationsService`, `NotificationsProcessor`, `NotificationsModule`

**Files:**
- Create: `backend/src/notifications/notifications.types.ts`
- Create: `backend/src/notifications/notifications.service.ts`
- Test: `backend/src/notifications/notifications.service.spec.ts`
- Create: `backend/src/notifications/notifications.processor.ts`
- Test: `backend/src/notifications/notifications.processor.spec.ts`
- Create: `backend/src/notifications/notifications.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `MailerService`/templates from Task 2; `PrismaService`, `AuditService` (both `@Global()`, no explicit import needed); `MANAGE_EVENTS` from `../rbac/role-groups`.
- Produces: `NotificationsService.enqueueRegistrationApproved/Waitlisted/Rejected/Promoted(organizationId: string, registrationId: string): Promise<unknown>`; `enqueueNewRegistrationForCommittee(organizationId: string, registrationId: string): Promise<void>`; `scheduleEventReminder(organizationId: string, eventId: string, startAt: Date): Promise<unknown>`; `cancelEventReminder(eventId: string): Promise<number>`. `NotificationsModule` exports `NotificationsService` only. Tasks 4–5 import `NotificationsModule` and inject `NotificationsService`.

- [ ] **Step 1: Create the shared job-name/payload types**

Create `backend/src/notifications/notifications.types.ts`:

```ts
export const NOTIFICATION_QUEUE = 'notifications';

export enum NotificationJobName {
  RegistrationApproved = 'registration.approved',
  RegistrationWaitlisted = 'registration.waitlisted',
  RegistrationRejected = 'registration.rejected',
  RegistrationPromoted = 'registration.promoted',
  RegistrationNew = 'registration.new',
  EventReminder = 'event.reminder',
}

export interface RegistrationJobPayload {
  organizationId: string;
  registrationId: string;
}

export interface CommitteeNewRegistrationJobPayload {
  organizationId: string;
  registrationId: string;
  committeeUserId: string;
}

export interface EventReminderJobPayload {
  organizationId: string;
  eventId: string;
}

export function reminderJobId(eventId: string): string {
  return `reminder:${eventId}`;
}
```

- [ ] **Step 2: Write the failing `NotificationsService` test**

Create `backend/src/notifications/notifications.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_QUEUE, NotificationJobName, reminderJobId } from './notifications.types';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock; remove: jest.Mock };
  let prisma: { membership: { findMany: jest.Mock } };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(1) };
    prisma = { membership: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: queue },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('enqueueRegistrationApproved adds a registration.approved job', async () => {
    await service.enqueueRegistrationApproved('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationApproved, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationWaitlisted adds a registration.waitlisted job', async () => {
    await service.enqueueRegistrationWaitlisted('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationWaitlisted, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationRejected adds a registration.rejected job', async () => {
    await service.enqueueRegistrationRejected('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationRejected, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueRegistrationPromoted adds a registration.promoted job', async () => {
    await service.enqueueRegistrationPromoted('org1', 'reg1');
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationPromoted, { organizationId: 'org1', registrationId: 'reg1' });
  });

  it('enqueueNewRegistrationForCommittee adds one job per ACTIVE committee-tier member', async () => {
    prisma.membership.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
    await service.enqueueNewRegistrationForCommittee('org1', 'reg1');
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org1', status: 'ACTIVE' }),
    }));
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationNew, { organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u1' });
    expect(queue.add).toHaveBeenCalledWith(NotificationJobName.RegistrationNew, { organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u2' });
  });

  it('scheduleEventReminder adds a delayed job when startAt - 24h is still in the future', async () => {
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await service.scheduleEventReminder('org1', 'event1', startAt);
    expect(queue.add).toHaveBeenCalledWith(
      NotificationJobName.EventReminder,
      { organizationId: 'org1', eventId: 'event1' },
      expect.objectContaining({ jobId: reminderJobId('event1') }),
    );
    const [, , opts] = queue.add.mock.calls[0];
    expect(opts.delay).toBeGreaterThan(0);
  });

  it('scheduleEventReminder does not add a job when startAt - 24h has already passed', async () => {
    const startAt = new Date(Date.now() + 1 * 60 * 60 * 1000);
    await service.scheduleEventReminder('org1', 'event1', startAt);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('cancelEventReminder removes the deterministic reminder job id', async () => {
    await service.cancelEventReminder('event1');
    expect(queue.remove).toHaveBeenCalledWith(reminderJobId('event1'));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/notifications.service.spec.ts
```

Expected: FAIL — `Cannot find module './notifications.service'`.

- [ ] **Step 4: Implement `NotificationsService`**

Create `backend/src/notifications/notifications.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MANAGE_EVENTS } from '../rbac/role-groups';
import { NOTIFICATION_QUEUE, NotificationJobName, reminderJobId } from './notifications.types';

const REMINDER_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  enqueueRegistrationApproved(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationApproved, { organizationId, registrationId });
  }

  enqueueRegistrationWaitlisted(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationWaitlisted, { organizationId, registrationId });
  }

  enqueueRegistrationRejected(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationRejected, { organizationId, registrationId });
  }

  enqueueRegistrationPromoted(organizationId: string, registrationId: string) {
    return this.queue.add(NotificationJobName.RegistrationPromoted, { organizationId, registrationId });
  }

  async enqueueNewRegistrationForCommittee(organizationId: string, registrationId: string): Promise<void> {
    const committee = await this.prisma.membership.findMany({
      where: { organizationId, role: { in: MANAGE_EVENTS }, status: 'ACTIVE' },
      select: { userId: true },
    });
    await Promise.all(
      committee.map((member) =>
        this.queue.add(NotificationJobName.RegistrationNew, {
          organizationId, registrationId, committeeUserId: member.userId,
        }),
      ),
    );
  }

  // No-op (no job added) when the 24h-before-start point has already passed —
  // e.g. an event published less than 24h before it starts. No immediate
  // reminder substitute; see spec's "Out of scope".
  scheduleEventReminder(organizationId: string, eventId: string, startAt: Date) {
    const delay = startAt.getTime() - REMINDER_LEAD_TIME_MS - Date.now();
    if (delay <= 0) return Promise.resolve(undefined);
    return this.queue.add(
      NotificationJobName.EventReminder,
      { organizationId, eventId },
      { jobId: reminderJobId(eventId), delay },
    );
  }

  cancelEventReminder(eventId: string) {
    return this.queue.remove(reminderJobId(eventId));
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/notifications.service.spec.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Write the failing `NotificationsProcessor` test**

Create `backend/src/notifications/notifications.processor.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationJobName } from './notifications.types';

function fakeJob(name: string, data: unknown) {
  return { id: 'job1', name, data } as any;
}

describe('NotificationsProcessor', () => {
  let processor: NotificationsProcessor;
  let prisma: {
    registration: { findUnique: jest.Mock; findMany: jest.Mock };
    user: { findUnique: jest.Mock };
    event: { findUnique: jest.Mock };
  };
  let mailer: { sendMail: jest.Mock };
  let audit: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      registration: { findUnique: jest.fn(), findMany: jest.fn() },
      user: { findUnique: jest.fn() },
      event: { findUnique: jest.fn() },
    };
    mailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    processor = moduleRef.get(NotificationsProcessor);
  });

  it('sends a registration.approved email and audits it', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      user: { email: 'p@test.io', fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
    });
    await processor.process(fakeJob(NotificationJobName.RegistrationApproved, { organizationId: 'org1', registrationId: 'reg1' }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'p@test.io' }));
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: 'org1', action: 'notification.email',
      targetType: 'Registration', targetId: 'reg1',
      metadata: { kind: NotificationJobName.RegistrationApproved },
    });
  });

  it('skips silently when the registration no longer exists', async () => {
    prisma.registration.findUnique.mockResolvedValue(null);
    await processor.process(fakeJob(NotificationJobName.RegistrationRejected, { organizationId: 'org1', registrationId: 'gone' }));
    expect(mailer.sendMail).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('sends a committee registration.new email to the committee member and audits it', async () => {
    prisma.registration.findUnique.mockResolvedValue({
      user: { fullName: 'Alex Tan' },
      event: { title: 'Tech Talk' },
      status: 'APPROVED',
    });
    prisma.user.findUnique.mockResolvedValue({ email: 'committee@test.io' });
    await processor.process(fakeJob(NotificationJobName.RegistrationNew, {
      organizationId: 'org1', registrationId: 'reg1', committeeUserId: 'u1',
    }));
    expect(mailer.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'committee@test.io' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'reg1' }));
  });

  it('sends event.reminder emails to every APPROVED registrant and audits each', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Tech Talk', venue: 'Hall A', startAt: new Date(), status: 'PUBLISHED' });
    prisma.registration.findMany.mockResolvedValue([
      { id: 'reg1', user: { email: 'a@test.io', fullName: 'A' } },
      { id: 'reg2', user: { email: 'b@test.io', fullName: 'B' } },
    ]);
    await processor.process(fakeJob(NotificationJobName.EventReminder, { organizationId: 'org1', eventId: 'event1' }));
    expect(mailer.sendMail).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledTimes(2);
  });

  it('skips event.reminder entirely when the event is no longer PUBLISHED', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Tech Talk', venue: null, startAt: new Date(), status: 'CANCELLED' });
    await processor.process(fakeJob(NotificationJobName.EventReminder, { organizationId: 'org1', eventId: 'event1' }));
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
    expect(mailer.sendMail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd backend && npx jest src/notifications/notifications.processor.spec.ts
```

Expected: FAIL — `Cannot find module './notifications.processor'`.

- [ ] **Step 8: Implement `NotificationsProcessor`**

Create `backend/src/notifications/notifications.processor.ts`:

```ts
import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from './mailer.service';
import {
  CommitteeNewRegistrationJobPayload,
  EventReminderJobPayload,
  NOTIFICATION_QUEUE,
  NotificationJobName,
  RegistrationJobPayload,
} from './notifications.types';
import {
  committeeNewRegistrationEmail,
  eventReminderEmail,
  registrationApprovedEmail,
  registrationPromotedEmail,
  registrationRejectedEmail,
  registrationWaitlistedEmail,
} from './templates';

type OutcomeTemplateFn = (data: { fullName: string; eventTitle: string }) => { subject: string; text: string };

const OUTCOME_TEMPLATES: Partial<Record<NotificationJobName, OutcomeTemplateFn>> = {
  [NotificationJobName.RegistrationApproved]: registrationApprovedEmail,
  [NotificationJobName.RegistrationWaitlisted]: registrationWaitlistedEmail,
  [NotificationJobName.RegistrationRejected]: registrationRejectedEmail,
  [NotificationJobName.RegistrationPromoted]: registrationPromotedEmail,
};

@Processor(NOTIFICATION_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const templateFn = OUTCOME_TEMPLATES[job.name as NotificationJobName];
    if (templateFn) return this.sendRegistrationOutcomeEmail(job, templateFn);
    if (job.name === NotificationJobName.RegistrationNew) return this.sendCommitteeNewRegistrationEmail(job);
    if (job.name === NotificationJobName.EventReminder) return this.sendEventReminders(job);
  }

  private async sendRegistrationOutcomeEmail(job: Job, templateFn: OutcomeTemplateFn): Promise<void> {
    const { organizationId, registrationId } = job.data as RegistrationJobPayload;
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { user: { select: { email: true, fullName: true } }, event: { select: { title: true } } },
    });
    if (!registration) return;

    const { subject, text } = templateFn({ fullName: registration.user.fullName, eventTitle: registration.event.title });
    await this.mailer.sendMail({ to: registration.user.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Registration', targetId: registrationId,
      metadata: { kind: job.name },
    });
  }

  private async sendCommitteeNewRegistrationEmail(job: Job): Promise<void> {
    const { organizationId, registrationId, committeeUserId } = job.data as CommitteeNewRegistrationJobPayload;
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { user: { select: { fullName: true } }, event: { select: { title: true } } },
    });
    if (!registration) return;
    const committeeUser = await this.prisma.user.findUnique({ where: { id: committeeUserId }, select: { email: true } });
    if (!committeeUser) return;

    const { subject, text } = committeeNewRegistrationEmail({
      eventTitle: registration.event.title,
      registrantFullName: registration.user.fullName,
      status: registration.status,
    });
    await this.mailer.sendMail({ to: committeeUser.email, subject, text });
    await this.audit.record({
      organizationId, action: 'notification.email',
      targetType: 'Registration', targetId: registrationId,
      metadata: { kind: job.name },
    });
  }

  private async sendEventReminders(job: Job): Promise<void> {
    const { organizationId, eventId } = job.data as EventReminderJobPayload;
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PUBLISHED') return;

    const registrations = await this.prisma.registration.findMany({
      where: { eventId, organizationId, status: 'APPROVED' },
      include: { user: { select: { email: true, fullName: true } } },
    });
    for (const registration of registrations) {
      const { subject, text } = eventReminderEmail({
        fullName: registration.user.fullName, eventTitle: event.title, venue: event.venue, startAt: event.startAt,
      });
      await this.mailer.sendMail({ to: registration.user.email, subject, text });
      await this.audit.record({
        organizationId, action: 'notification.email',
        targetType: 'Registration', targetId: registration.id,
        metadata: { kind: job.name },
      });
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Notification job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
cd backend && npx jest src/notifications/notifications.processor.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 10: Create `NotificationsModule`**

Create `backend/src/notifications/notifications.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { MailerService } from './mailer.service';
import { NOTIFICATION_QUEUE } from './notifications.types';

@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  providers: [NotificationsService, NotificationsProcessor, MailerService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 11: Register the module**

In `backend/src/app.module.ts`, add the import:

```ts
import { NotificationsModule } from './notifications/notifications.module';
```

Add `NotificationsModule` to the `imports` array, after `AchievementsModule` and before `PublicModule`:

```ts
    AchievementsModule,
    NotificationsModule,
    PublicModule,
```

- [ ] **Step 12: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `64 passed` (50 baseline from Task 2 + 9 `NotificationsService` + 5 `NotificationsProcessor`); e2e `276 passed` (unchanged — nothing calls the new module yet).

- [ ] **Step 13: Commit**

```bash
git add backend/src/notifications/notifications.types.ts backend/src/notifications/notifications.service.ts backend/src/notifications/notifications.service.spec.ts backend/src/notifications/notifications.processor.ts backend/src/notifications/notifications.processor.spec.ts backend/src/notifications/notifications.module.ts backend/src/app.module.ts
git commit -m "feat: NotificationsService, NotificationsProcessor, NotificationsModule"
```

---

### Task 4: Wire registration triggers

**Files:**
- Modify: `backend/src/registrations/registrations.module.ts`
- Modify: `backend/src/registrations/registrations.service.ts`
- Test: `backend/test/notifications-registrations.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService` from Task 3 (`enqueueRegistrationApproved/Waitlisted/Rejected/Promoted`, `enqueueNewRegistrationForCommittee`).
- Produces: no new public methods — `register()`, `cancel()`, `reject()` keep their exact existing signatures and return shapes; they now also enqueue notification jobs after their transaction commits.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/notifications-registrations.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Email notifications — registration triggers (e2e)', () => {
  let app: INestApplication;
  let presToken: string;
  let orgId: string;
  let eventId: string;
  const future = (d: number) => new Date(Date.now() + d * 86400000).toISOString();
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function registerAndLogin(email: string) {
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'password123', fullName: email, consent: true });
    return (await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'password123' })).body.accessToken;
  }

  async function auditRows() {
    const res = await request(app.getHttpServer())
      .get(`/organizations/${orgId}/audit-logs`)
      .set('Authorization', `Bearer ${presToken}`)
      .query({ action: 'notification.email', pageSize: 100 });
    return res.body.data as Array<{ targetId: string; metadata: { kind: string } }>;
  }

  async function waitForAuditRows(
    predicate: (rows: Array<{ targetId: string; metadata: { kind: string } }>) => boolean,
    timeoutMs = 5000,
  ) {
    const start = Date.now();
    for (;;) {
      const rows = await auditRows();
      if (predicate(rows)) return rows;
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for notification.email audit rows');
      await wait(200);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    presToken = await registerAndLogin(`notif-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'NotifOrg', slug: `notif-${Date.now()}` })).body.id;
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Notif Event', startAt: future(10), endAt: future(11), capacity: 1 });
    eventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
  });
  afterAll(async () => { await app.close(); });

  it('registering under capacity triggers a registration.approved email and a committee registration.new email', async () => {
    const token = await registerAndLogin(`notif-p1-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    const rows = await waitForAuditRows((rows) =>
      rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.approved') &&
      rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.new'),
    );
    expect(rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.new')).toBe(true);
  });

  it('registering over capacity (waitlisted) triggers a registration.waitlisted email instead', async () => {
    const token = await registerAndLogin(`notif-p2-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    expect(res.body.status).toBe('WAITLISTED');
    const registrationId = res.body.id;

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.waitlisted'));
  });

  it('committee rejecting a registration triggers a registration.rejected email', async () => {
    const token = await registerAndLogin(`notif-p3-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations/${registrationId}/reject`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId && r.metadata.kind === 'registration.rejected'));
  });

  it('cancelling an APPROVED registration promotes the oldest WAITLISTED one and emails the promoted registrant', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Promote Event', startAt: future(10), endAt: future(11), capacity: 1 });
    const promoEventId = event.body.id;
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${promoEventId}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const tokenA = await registerAndLogin(`notif-a-${Date.now()}@test.io`);
    const tokenB = await registerAndLogin(`notif-b-${Date.now()}@test.io`);
    const regA = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations`)
      .set('Authorization', `Bearer ${tokenA}`).send({}).expect(201);
    const regB = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations`)
      .set('Authorization', `Bearer ${tokenB}`).send({}).expect(201);
    expect(regB.body.status).toBe('WAITLISTED');

    await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${promoEventId}/registrations/${regA.body.id}/cancel`)
      .set('Authorization', `Bearer ${tokenA}`).expect(200);

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === regB.body.id && r.metadata.kind === 'registration.promoted'));
  });

  it("tenant isolation: org B's committee never receives a registration.new job for org A's registration", async () => {
    const otherPresToken = await registerAndLogin(`notif-iso-${Date.now()}@test.io`);
    const otherOrgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${otherPresToken}`)
      .send({ name: 'NotifIsoOrg', slug: `notif-iso-${Date.now()}` })).body.id;

    const token = await registerAndLogin(`notif-p4-${Date.now()}@test.io`);
    const res = await request(app.getHttpServer())
      .post(`/organizations/${orgId}/events/${eventId}/registrations`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(201);
    const registrationId = res.body.id;

    await waitForAuditRows((rows) => rows.some((r) => r.targetId === registrationId));

    const otherOrgRows = await request(app.getHttpServer())
      .get(`/organizations/${otherOrgId}/audit-logs`)
      .set('Authorization', `Bearer ${otherPresToken}`)
      .query({ action: 'notification.email', pageSize: 100 });
    expect(otherOrgRows.body.data.some((r: { targetId: string }) => r.targetId === registrationId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json notifications-registrations
```

Expected: FAIL — `waitForAuditRows` times out (no `notification.email` audit rows are ever written; nothing enqueues yet).

- [ ] **Step 3: Wire `NotificationsModule` into `RegistrationsModule`**

Replace the full contents of `backend/src/registrations/registrations.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RegistrationFormController } from './registration-form.controller';
import { RegistrationFormService } from './registration-form.service';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [AttendanceModule, NotificationsModule],
  controllers: [RegistrationFormController, RegistrationsController],
  providers: [RegistrationFormService, RegistrationsService],
  exports: [RegistrationFormService, RegistrationsService],
})
export class RegistrationsModule {}
```

- [ ] **Step 4: Inject `NotificationsService` into `RegistrationsService`**

In `backend/src/registrations/registrations.service.ts`, add the import:

```ts
import { NotificationsService } from '../notifications/notifications.service';
```

Update the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly notifications: NotificationsService,
  ) {}
```

- [ ] **Step 5: Enqueue on `register()`**

In `register()`, the existing code ends with:

```ts
    try {
      return await this.prisma.$transaction(async (tx) => {
        // ... unchanged transaction body ...
        return registration;
      });
    } catch (error) {
      // ... unchanged P2002 handling ...
      throw error;
    }
  }
```

Change it to capture the result, enqueue after the transaction commits, then return:

```ts
    let registration;
    try {
      registration = await this.prisma.$transaction(async (tx) => {
        // ... unchanged transaction body ...
        return registration;
      });
    } catch (error) {
      // ... unchanged P2002 handling ...
      throw error;
    }

    if (registration.status === 'APPROVED') {
      await this.notifications.enqueueRegistrationApproved(organizationId, registration.id);
    } else {
      await this.notifications.enqueueRegistrationWaitlisted(organizationId, registration.id);
    }
    await this.notifications.enqueueNewRegistrationForCommittee(organizationId, registration.id);

    return registration;
  }
```

(Only the `return await this.prisma.$transaction(...)` line changes to `registration = await this.prisma.$transaction(...)`, declared via a `let registration;` above the `try`; the transaction body itself, and the `catch` block's P2002 handling, are untouched.)

- [ ] **Step 6: Return the promoted candidate id from `resolve()`, and enqueue in `cancel()`/`reject()`**

In `resolve()`, add a variable to track the promoted candidate and change the return statement. Where the method currently declares `const attempted: string[] = [];` before the `for (;;)` loop, add a line above it:

```ts
        let promotedRegistrationId: string | null = null;
        const attempted: string[] = [];
```

Inside the loop, where it currently does (on a successful promotion):

```ts
            if (count === 1) {
              await this.attendance.createForRegistration(tx, {
                registrationId: candidate.id, eventId: current.eventId, organizationId,
              });
              await this.audit.record({
                organizationId, actorUserId, action: 'registration.promote',
                targetType: 'Registration', targetId: candidate.id,
                metadata: { registrationId: candidate.id, eventId: current.eventId },
              }, tx);
              break;
            }
```

Add one line to record the promoted id:

```ts
            if (count === 1) {
              promotedRegistrationId = candidate.id;
              await this.attendance.createForRegistration(tx, {
                registrationId: candidate.id, eventId: current.eventId, organizationId,
              });
              await this.audit.record({
                organizationId, actorUserId, action: 'registration.promote',
                targetType: 'Registration', targetId: candidate.id,
                metadata: { registrationId: candidate.id, eventId: current.eventId },
              }, tx);
              break;
            }
```

Change the transaction's final `return updated;` to:

```ts
        return { updated, promotedRegistrationId };
```

`resolve()` is `private`, called only by `cancel()` and `reject()` — both need updating to destructure the new shape and enqueue. Replace both methods:

```ts
  async cancel(organizationId: string, registrationId: string, actorUserId?: string) {
    const current = await this.prisma.registration.findFirst({ where: { id: registrationId, organizationId } });
    if (!current) throw new NotFoundException('Registration not found in this organization');
    if (current.userId !== actorUserId) {
      throw new ForbiddenException('You can only cancel your own registration');
    }
    const { updated, promotedRegistrationId } = await this.resolve(organizationId, registrationId, 'CANCELLED', 'registration.cancel', actorUserId);
    if (promotedRegistrationId) {
      await this.notifications.enqueueRegistrationPromoted(organizationId, promotedRegistrationId);
    }
    return updated;
  }

  async reject(organizationId: string, registrationId: string, actorUserId?: string) {
    const { updated, promotedRegistrationId } = await this.resolve(organizationId, registrationId, 'REJECTED', 'registration.reject', actorUserId);
    await this.notifications.enqueueRegistrationRejected(organizationId, registrationId);
    if (promotedRegistrationId) {
      await this.notifications.enqueueRegistrationPromoted(organizationId, promotedRegistrationId);
    }
    return updated;
  }
```

(`reject()` was previously a one-line `return this.resolve(...)`; it is now `async` with a body, per above.)

- [ ] **Step 7: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json notifications-registrations
```

Expected: all 5 tests PASS.

- [ ] **Step 8: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `64 passed` (unchanged — no new unit tests this task, per the Global Constraints deviation note); e2e `281 passed` (276 baseline + 5 new in `notifications-registrations.e2e-spec.ts`). This full run includes every pre-existing `registrations-*.e2e-spec.ts` file, confirming `register()`/`resolve()`'s restructuring didn't change their behavior or response shapes.

- [ ] **Step 9: Commit**

```bash
git add backend/src/registrations/registrations.module.ts backend/src/registrations/registrations.service.ts backend/test/notifications-registrations.e2e-spec.ts
git commit -m "feat: wire registration outcome, promotion, and committee notifications"
```

---

### Task 5: Wire event reminder scheduling

**Files:**
- Modify: `backend/src/events/events.module.ts`
- Modify: `backend/src/events/events.service.ts`
- Test: `backend/test/notifications-event-reminders.e2e-spec.ts`

**Interfaces:**
- Consumes: `NotificationsService.scheduleEventReminder/cancelEventReminder` from Task 3; `reminderJobId`/`NOTIFICATION_QUEUE` from `notifications.types` (test file only, to inspect BullMQ job state directly).
- Produces: no new public methods — `publish()`, `update()`, `complete()`, `cancel()` keep their exact existing signatures and return shapes.

- [ ] **Step 1: Write the failing e2e test**

Create `backend/test/notifications-event-reminders.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { NOTIFICATION_QUEUE, reminderJobId } from '../src/notifications/notifications.types';

describe('Email notifications — event reminders (e2e)', () => {
  let app: INestApplication;
  let queue: Queue;
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
    queue = moduleRef.get<Queue>(getQueueToken(NOTIFICATION_QUEUE));
    presToken = await registerAndLogin(`notifrem-pres-${Date.now()}@test.io`);
    orgId = (await request(app.getHttpServer()).post('/organizations').set('Authorization', `Bearer ${presToken}`)
      .send({ name: 'NotifRemOrg', slug: `notifrem-${Date.now()}` })).body.id;
  });
  afterAll(async () => { await app.close(); });

  it('publishing an event >24h out schedules a delayed event.reminder job', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Far Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const job = await queue.getJob(reminderJobId(event.body.id));
    expect(job).toBeDefined();
    expect(job!.opts.delay).toBeGreaterThan(0);
  });

  it('publishing an event <24h out does not schedule a reminder', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({
        title: 'Soon Event',
        startAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        endAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const job = await queue.getJob(reminderJobId(event.body.id));
    expect(job).toBeUndefined();
  });

  it("updating a PUBLISHED event's startAt reschedules the reminder job", async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Reschedule Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    const before = await queue.getJob(reminderJobId(event.body.id));
    const originalDelay = before!.opts.delay!;

    await request(app.getHttpServer()).patch(`/organizations/${orgId}/events/${event.body.id}`)
      .set('Authorization', `Bearer ${presToken}`).send({ startAt: future(20), endAt: future(21) }).expect(200);

    const after = await queue.getJob(reminderJobId(event.body.id));
    expect(after).toBeDefined();
    expect(after!.opts.delay).toBeGreaterThan(originalDelay);
  });

  it('cancelling a PUBLISHED event with a pending reminder removes the job', async () => {
    const event = await request(app.getHttpServer()).post(`/organizations/${orgId}/events`)
      .set('Authorization', `Bearer ${presToken}`).send({ title: 'Cancel Event', startAt: future(10), endAt: future(11) });
    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/publish`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);
    expect(await queue.getJob(reminderJobId(event.body.id))).toBeDefined();

    await request(app.getHttpServer()).post(`/organizations/${orgId}/events/${event.body.id}/cancel`)
      .set('Authorization', `Bearer ${presToken}`).expect(200);

    expect(await queue.getJob(reminderJobId(event.body.id))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the e2e file to verify it fails**

```bash
cd backend && npx jest --config ./test/jest-e2e.json notifications-event-reminders
```

Expected: FAIL — no reminder jobs are ever scheduled yet (all `getJob` calls that expect a defined job return `undefined`).

- [ ] **Step 3: Wire `NotificationsModule` into `EventsModule`**

Replace the full contents of `backend/src/events/events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [NotificationsModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
```

- [ ] **Step 4: Inject `NotificationsService` and call it from `publish()`/`complete()`/`cancel()`/`update()`**

In `backend/src/events/events.service.ts`, add the import:

```ts
import { NotificationsService } from '../notifications/notifications.service';
```

Update the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}
```

Replace `publish()`, `complete()`, and `cancel()` (each was previously a single-expression `return this.transition(...)`) with:

```ts
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
```

In `update()`, the method currently ends with:

```ts
      const updated = await tx.event.update({ where: { id: eventId, organizationId }, data });
      await this.audit.record({
        organizationId, actorUserId, action: 'event.update',
        targetType: 'Event', targetId: eventId, metadata: { eventId, fields },
      }, tx);
      return updated;
    });
  }
```

Change the outer `return this.prisma.$transaction(...)` to capture the result first, then reschedule if `startAt` changed on a still-`PUBLISHED` event:

```ts
  async update(organizationId: string, eventId: string, dto: UpdateEventDto, actorUserId?: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      // ... unchanged transaction body ...
      return updated;
    });

    if (dto.startAt && updated.status === 'PUBLISHED') {
      await this.notifications.cancelEventReminder(eventId);
      await this.notifications.scheduleEventReminder(organizationId, eventId, updated.startAt);
    }

    return updated;
  }
```

(Only the `async update(...)` signature line and the final `return this.prisma.$transaction(...)` → `const updated = await this.prisma.$transaction(...)` plus the new block after it change; the transaction body itself is untouched. Note: this reschedules even if the new `startAt` is identical to the old one — a harmless no-op recompute, not worth a deep-equality check.)

- [ ] **Step 5: Run the e2e file to verify it passes**

```bash
cd backend && npx jest --config ./test/jest-e2e.json notifications-event-reminders
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Run the full suite**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `64 passed` (unchanged, per the Global Constraints deviation note); e2e `285 passed` (281 from Task 4 + 4 new in `notifications-event-reminders.e2e-spec.ts`). This full run includes every pre-existing `events-*.e2e-spec.ts` file, confirming `publish()`/`complete()`/`cancel()`/`update()`'s restructuring didn't change their behavior or response shapes.

- [ ] **Step 7: Commit**

```bash
git add backend/src/events/events.module.ts backend/src/events/events.service.ts backend/test/notifications-event-reminders.e2e-spec.ts
git commit -m "feat: wire event reminder scheduling on publish/update/cancel/complete"
```

---

### Task 6: Docs sync

**Files:**
- Modify: `docs/security.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Update `docs/security.md`**

Read the current file first (`docs/security.md`), find the `### As built — public club page (shipped)` section (the most recent one), and add a new `### As built — email notifications (shipped)` section directly after it (before `## 3. Multi-Tenant Isolation`, matching where every prior "As built" section was inserted):

```markdown
### As built — email notifications (shipped)

No new endpoints — purely internal side effects of existing actions, via a new `NotificationsModule` (`backend/src/notifications/`) and a BullMQ queue (`notifications`) backed by the `redis` container (first feature to actually use it).

Six triggers, one email each: `RegistrationsService.register()` resolving to `APPROVED` or `WAITLISTED` (registrant), `RegistrationsService.reject()` (registrant), the waitlist auto-promotion cascade inside `resolve()` (promoted registrant), every new registration (fan-out — one email per `MANAGE_EVENTS`-tier ACTIVE org member, for visibility, not a required approval step), and a delayed `event.reminder` job scheduled 24h before `Event.startAt` on `publish()`, rescheduled on `update()` when `startAt` changes, and cancelled on `cancel()`/`complete()` (deterministic job id `` `reminder:<eventId>` ``).

Plain-text templates only (`notifications/templates.ts`), sent via `nodemailer` (`MailerService`) against a `mailpit` dev container (SMTP `:1025`, web UI `:8025`) — no HTML, no opt-out (all six triggers are transactional, not marketing).

**Audit:** one new action, `notification.email` (`targetType: 'Registration'`, metadata `{ kind }` only — never the recipient's email address or message body, per the "never log personal data" rule). Written by the queue worker only on successful send; failed sends retry via BullMQ defaults and are logged (not audited).

No new Prisma models. `TENANT_SCOPED_MODELS` unchanged.
```

- [ ] **Step 2: Run the full unit and e2e suites one more time**

```bash
cd backend && npm test && npm run test:e2e
```

Expected: unit `64 passed`; e2e `285 passed` (docs changes add no tests).

- [ ] **Step 3: Commit**

```bash
git add docs/security.md
git commit -m "docs: sync security.md for email notifications"
```

---

## Post-plan: roadmap note

Email Notifications (Phase 2 item 6) is now shippable end-to-end: registration
confirmation/waitlist/rejection/promotion emails, a committee new-registration
notice, and a 24h-before-event reminder — all via a BullMQ queue against the
existing `redis` container, sent through a new `mailpit` dev container, with
no new HTTP endpoints and one new audit action (`notification.email`). Six
Phase 2 items remain, no fixed dependency order: Certificate Generator,
Branding & Themes, Event Feedback+NPS, Committee Handover Pack,
Consent-versioned re-prompt.
