# Certificate Generator — Design Spec

Roadmap Phase 2, item 7 ("Organization Workspace"): "Certificate Generator —
automatic certificate generation (upgrade from upload-only)." Backend-only.
Upgrades Phase 1's Certificate Repository (`backend/src/certificates/`),
which was upload-only by explicit design (`docs/superpowers/specs/2026-07-12-certificate-repository-design.md`'s
"Out of scope this phase: Automatic certificate generation
(planning.md's stated future item)").

## Goal

When a committee member completes an event, automatically generate a PDF
certificate for every attendee who was marked `PRESENT` and doesn't already
have one — no manual upload required for the common case. Manual upload
stays available for anyone who wants a hand-crafted certificate instead.
Participants get an email when their certificate (generated or uploaded) is
ready, reusing the Email Notifications module shipped this session.

## Scope

**Triggers → behavior (this phase):**

1. `EventsService.complete()` (`PUBLISHED → COMPLETED`) → after the
   transition commits, enqueue one `certificate.generate` BullMQ job per
   `PRESENT` attendee of that event who has no `Certificate` row yet.
2. Each `certificate.generate` job → render a PDF, store it at the same
   deterministic key manual upload already uses, create the `Certificate`
   row, audit it, and notify the recipient.
3. `CertificatesService.upload()` (existing, Phase 1) → gains one line:
   after its transaction commits, also notify the recipient. No other
   change to the upload path.

**Explicitly not building this phase:**

- Template editor / customization UI — one fixed layout, no per-org or
  per-event visual configuration beyond what `Organization` already stores
  (`name`, `logoKey`, `primaryColor`).
- Verification code / QR code on the certificate.
- Signature line (printed or captured).
- A "regenerate" or "retry" endpoint for a single failed attendee — the
  existing manual-upload endpoint is the fallback if generation fails for
  someone.
- Removing or disabling manual upload — it stays exactly as Phase 1 built
  it, plus the one added notification call.
- Portrait layout.
- A `Certificate` column distinguishing generated-vs-uploaded provenance —
  the audit log (`certificate.generate` vs `certificate.upload`) already
  carries that distinction; no UI need for it on the row itself this phase.

## Architecture

New `generation/` subfolder inside the existing `backend/src/certificates/`
module (`CertificatesModule` already exists from Phase 1 — this extends it,
doesn't replace it):

```text
certificates/
  certificates.controller.ts        # unchanged (Phase 1)
  certificates.service.ts           # +1 line: notify on upload
  certificates.module.ts            # +queue registration, +new providers, +NotificationsModule import
  generation/
    certificate-generation.types.ts # queue name, job payload type, deterministic-key helper reuse
    certificate-pdf.service.ts      # pure render(data) -> Buffer via pdf-lib
    certificate-generation.service.ts    # enqueueBatchForEvent(orgId, eventId)
    certificate-generation.processor.ts  # WorkerHost, one process(job)
```

- **`CertificatePdfService.render(data: CertificateRenderData): Promise<Buffer>`**
  — `data: { participantFullName: string; eventTitle: string;
  eventDate: Date; orgName: string; orgPrimaryColor: string; orgLogoBytes:
  Buffer | null }`. Builds a landscape A4 page via `pdf-lib`: "Certificate
  of Participation" heading (`StandardFonts.HelveticaBold`), participant
  name, event title, event date (`eventDate.toISOString()`'s date portion),
  org name, org logo top-center if `orgLogoBytes` is non-null (tries
  `embedPng` then `embedJpg`; on failure from either, logs a warning and
  omits the image — never throws), a border/accent rectangle in
  `orgPrimaryColor` (hex parsed to RGB). No Prisma, no `StorageService`, no
  Nest DI beyond being an injectable class — testable as a plain function
  call.
- **`CertificateGenerationService`** (queue producer side):
  - `enqueueBatchForEvent(organizationId: string, eventId: string,
    actorUserId: string | undefined): Promise<void>` — queries
    `Attendance.findMany({ where: { eventId, organizationId, status:
    'PRESENT' } })`, filters out any whose `userId` already has a
    `Certificate` row for this event (one `findMany` on `Certificate` with
    `userId: { in: [...] }`, then a Set-difference in memory — cheaper than
    N existence checks), and calls `queue.add('certificate.generate', {
    organizationId, eventId, userId, actorUserId })` once per remaining
    attendee (`actorUserId` is the caller of `complete()` — see
    `uploadedByUserId` below). No job id (unlike the reminder job, there's
    no need to find-and-replace a specific job later — a duplicate job
    landing twice just no-ops on the processor's race-guard, see below).
- **`CertificateGenerationProcessor`** (`@Processor('certificates')`,
  extends `WorkerHost`, one `process(job)` — same `@nestjs/bullmq` pattern
  as `NotificationsProcessor`, not the older Bull `@Process(kind)`
  decorator): for a `certificate.generate` job:
  1. Re-check `Certificate.findFirst({ eventId, organizationId, userId })`
     — if one now exists (a manual upload landed between enqueue and
     processing), skip silently. This is the race-guard the "keep both
     paths" decision requires.
  2. Load `Event` (title, startAt), `Organization` (name, logoKey,
     primaryColor), `User` (fullName, email) for the job's ids.
  3. If `logoKey` is set, fetch the logo bytes via
     `StorageService.getObject` (new method — Phase 1's `StorageService`
     only has `putObject`/`getSignedDownloadUrl`/`deleteObject`; add a
     `getObject(key): Promise<Buffer>` wrapping `GetObjectCommand` +
     buffering the body stream). On any fetch error, treat as "no logo"
     (log a warning, pass `null`) rather than failing the whole job.
  4. Call `CertificatePdfService.render(...)`.
  5. `StorageService.putObject(`certificates/${organizationId}/${eventId}/${userId}.pdf`, buffer, 'application/pdf')`
     — identical key convention to `CertificatesService.upload()`, so
     download/signed-URL/quota logic needs zero changes.
  6. In one `$transaction`: create the `Certificate` row (`uploadedByUserId`
     = the job payload's `actorUserId`) and record the
     `certificate.generate` audit entry (same shape as `certificate.upload`:
     `targetType: 'Certificate'`, metadata `{ certificateId, eventId,
     userId }`).
  7. Call `NotificationsService.enqueueCertificateReady(organizationId,
     certificate.id)`.
  - `uploadedByUserId` for generated certificates: the job payload carries
    the `actorUserId` who called `complete()` (added to the payload
    alongside `organizationId`/`eventId`/`userId`) — reusing the column
    Phase 1 already has rather than adding a nullable variant or a
    `'SYSTEM'` sentinel string that would need a schema change to permit.
  - On any unhandled error in steps 2–6, the job throws and BullMQ retries
    with its default backoff, exactly like `NotificationsProcessor`'s
    failure handling; after retries exhaust, an `@OnWorkerEvent('failed')`
    hook logs via Nest's `Logger`. Storage quota is checked the same way
    `upload()` checks it (sum of `Certificate.fileSizeBytes` +
    `OrgFile.fileSizeBytes` + `GalleryPhoto.fileSizeBytes` against
    `Organization.storageQuotaMb`) — a job that would exceed quota throws
    `BadRequestException`-equivalent (logged, not audited, per the same
    "no audit row for a failure" precedent as Email Notifications) rather
    than silently skipping the attendee.

**Wiring:** `CertificatesModule` gains `BullModule.registerQueue({ name:
'certificates' })`, the three new providers above, and imports
`NotificationsModule` (to inject `NotificationsService` into the
processor). `EventsModule` imports `CertificatesModule` (no circular
dependency — `CertificatesModule` has never imported `EventsModule`).
`EventsService.complete()` gains one line after its `transition()` call:
`await this.certificateGeneration.enqueueBatchForEvent(organizationId,
eventId, actorUserId);` — same post-commit placement pattern as
`scheduleEventReminder`/`cancelEventReminder` in Email Notifications.
(`complete()` already receives `actorUserId` as a parameter — no signature
change needed there beyond passing it through.)

## Email Notifications extension

One more job kind on the existing `notifications` queue:
`NotificationJobName.CertificateReady = 'certificate.ready'`.

- `NotificationsService.enqueueCertificateReady(organizationId: string,
  certificateId: string): Promise<unknown>` — thin `queue.add(...)` call,
  same shape as the four `enqueueRegistration*` methods.
- New template `certificateReadyEmail(data: { fullName: string; eventTitle:
  string }): { subject: string; text: string }` in `templates.ts`.
- `NotificationsProcessor.process()` gains one more branch: on
  `certificate.ready`, fetch the `Certificate` (joined to `User` for
  email/fullName and `Event` for title), send the email, and audit
  `notification.email` with `targetType: 'Certificate'`, `targetId:
  certificateId`, metadata `{ kind: 'certificate.ready' }` — the one
  `notification.email` audit row this phase that targets something other
  than a `Registration` (every prior kind targeted `Registration`; this is
  the natural target for a certificate-ready notice).
- `CertificatesService.upload()` gains one line after its existing
  transaction: `await this.notifications.enqueueCertificateReady(...)`.
  `CertificatesModule` must import `NotificationsModule` for this (new
  dependency — `CertificatesService`'s constructor gains
  `NotificationsService`).

## Data model

No new Prisma models, no new columns on any existing model.
`TENANT_SCOPED_MODELS` unchanged. `StorageService` gains one new method,
`getObject(key: string): Promise<Buffer>`, alongside its existing
`putObject`/`getSignedDownloadUrl`/`deleteObject`.

## Trigger / eligibility

Identical eligibility rule to manual upload: `Attendance.status ===
'PRESENT'` for that event+user (Phase 1's `upload()` already enforces this
via the same query shape). On `complete()`, every `PRESENT` attendee
without an existing `Certificate` row gets exactly one generation job.
Events where every `PRESENT` attendee already has a manually-uploaded
certificate enqueue zero jobs. A permanently-failed generation (retries
exhausted) leaves that attendee without a certificate; the committee's
existing manual-upload endpoint is the fallback — no automatic retry
mechanism beyond BullMQ's built-in backoff.

## RBAC

None new. `enqueueBatchForEvent` is an internal side effect of the
already-guarded `complete()` action (`MANAGE_EVENTS` tier, unchanged from
Phase 1's Event Management RBAC). No new endpoints.

## Audit

- `certificate.generate` (new) — `targetType: 'Certificate'`, metadata
  `{ certificateId, eventId, userId }`, same shape as `certificate.upload`.
- `notification.email` (existing, from Email Notifications) — gains one
  more `metadata.kind` value, `'certificate.ready'`, targeting the
  `Certificate` instead of a `Registration`.
- No audit row for a failed generation attempt — matches the "audit
  successful sensitive actions only" precedent already established.

## Testing plan

**Unit** (`backend/src/certificates/generation/*.spec.ts`):

- `CertificatePdfService`: rendering with a logo produces a loadable PDF
  (`PDFDocument.load(buffer)` round-trip doesn't throw); rendering without
  a logo (`orgLogoBytes: null`) also produces a valid PDF; a logo embed
  failure (malformed bytes passed in) is caught internally and still
  produces a valid PDF without the image, never throws out of `render()`.
- `CertificateGenerationService.enqueueBatchForEvent`: enqueues one job per
  `PRESENT` attendee with no existing certificate (mocked Prisma+queue);
  skips attendees who already have a `Certificate` row; enqueues zero jobs
  when every `PRESENT` attendee already has one.
- `CertificateGenerationProcessor.process`: happy path (mocked
  Prisma/Storage/PdfService/Audit/Notifications — asserts `putObject`,
  `Certificate.create`, `certificate.generate` audit, and
  `enqueueCertificateReady` all called with correct arguments); race-guard
  skip when a `Certificate` already exists by the time the job runs (no
  `putObject`/`create`/notify calls); logo-fetch failure still produces a
  certificate (verifies the "no logo" fallback path reaches `render()`
  with `null`).
- `NotificationsProcessor`'s new `certificate.ready` branch: sends the
  email and audits with `targetType: 'Certificate'` (extends the existing
  `notifications.processor.spec.ts`).

**E2E** (`backend/test/certificate-generation.e2e-spec.ts`, plus additions
to the existing certificate/notification e2e suites):

- Completing an event with two `PRESENT` attendees (neither previously
  certified) generates two `Certificate` rows, two `certificate.generate`
  audit rows, and two `notification.email` (`kind: 'certificate.ready'`)
  audit rows.
- An attendee with a pre-existing manual upload is skipped by generation
  (no second `Certificate` row, no `certificate.generate` audit row for
  them) but their certificate is still reachable via the unchanged
  download endpoint.
- A non-`PRESENT` registrant (e.g. `REGISTERED`/absent) gets no
  certificate.
- Manual `upload()` now also produces a `notification.email`
  (`kind: 'certificate.ready'`) audit row (extends
  `certificates-upload.e2e-spec.ts` or a small addition alongside it).
- Tenant isolation: completing org A's event never enqueues/generates
  anything referencing org B's users or events.

## Out of scope

- Template editor / customization UI.
- Verification code / QR code.
- Signature line.
- Per-attendee "regenerate" endpoint.
- Removing manual upload.
- Portrait layout.
- A provenance column on `Certificate` (generated vs. uploaded) — the
  audit log already distinguishes them.
