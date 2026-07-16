# Email Notifications — Design Spec

Roadmap Phase 2, item 6 ("Organization Workspace"): "Email Notifications —
approvals, reminders, waitlist promotion." Backend-only. First feature to
actually consume the `redis` container that has run since dev setup, and the
first to send email at all.

## Goal

Send transactional email at the moments participants and committees care
about: registration outcome, waitlist promotion, an event reminder, and
committee visibility into new registrations. No marketing/bulk email, no
opt-out UI (transactional mail, not marketing — see Scope).

## Scope

Correction from the initial brainstorm: there is **no explicit "approve"
action** in `RegistrationsService`. A registration's status (`APPROVED` or
`WAITLISTED`) is decided automatically at `register()` time based on
capacity; committees can only `reject` an existing registration, and the
system auto-`promote`s the oldest `WAITLISTED` row when a slot frees up.
Triggers below map onto what the code actually does, not onto a generic
"approve/reject" workflow that doesn't exist.

**Triggers → emails (this phase):**

1. `RegistrationsService.register()` resolves to `APPROVED` → confirmation
   email to the registrant.
2. `RegistrationsService.register()` resolves to `WAITLISTED` → waitlist
   email to the registrant.
3. `RegistrationsService.reject()` → rejection email to the registrant.
4. Waitlist auto-promotion (inside `resolve()`'s cascade) → promotion email
   to the promoted registrant.
5. Every new registration (any outcome) → one email to each committee-tier
   (`MANAGE_EVENTS`) member of the org, for visibility. Not "pending
   approval" (nothing requires their action) — just awareness.
6. 24 hours before `Event.startAt`, for a `PUBLISHED` event → one email to
   every `APPROVED` registrant.

**Explicitly not building this phase:**

- Opt-out/unsubscribe — all six triggers are transactional (tied to an
  action the recipient took: registering, or being on a roster for an event
  they registered for), not marketing. No `emailNotificationsEnabled` flag.
- Configurable reminder lead time — fixed 24h before `startAt`, no per-org
  or per-event setting. Add later if actually requested.
- HTML/branded templates — plain-text only. Revisit once Branding & Themes
  (Phase 2 item 8) exists.
- Persistent delivery-log table — delivery trail is `AuditLog` rows
  (metadata only) plus BullMQ's own transient job state in Redis. No new
  Prisma model for send history.
- Outbox pattern for exactly-once enqueue — jobs are enqueued *after* the
  triggering DB transaction commits, not inside it. A crash in the gap
  between commit and enqueue silently drops one notification; accepted for
  v1 rather than building transactional outbox machinery.
- Retry/backoff tuning beyond BullMQ defaults, dead-letter handling beyond
  "log and give up."

## Architecture

New `backend/src/notifications/` module, no controller — purely internal,
invoked by `RegistrationsService` and `EventsService`.

```text
notifications/
  notifications.module.ts
  notifications.service.ts       # enqueue* methods, called by other services
  notifications.processor.ts     # BullMQ worker — one process() per job kind
  mailer.service.ts               # nodemailer wrapper: sendMail({to, subject, text})
  templates.ts                    # pure functions: kind + data -> {subject, text}
  notifications.queue.ts          # BullMQ Queue provider (name: 'notifications')
```

- **Queue:** single BullMQ queue named `notifications`, connection from
  `REDIS_URL` (already in `.env.example`, unused until now). New deps:
  `bullmq`, `@nestjs/bullmq`, `nodemailer`, `@types/nodemailer`.
- **Job kinds** (BullMQ job `name`): `registration.approved`,
  `registration.waitlisted`, `registration.rejected`,
  `registration.promoted`, `registration.new` (committee fan-out — one job
  per committee member, not one job with an array, so one bad address
  doesn't block the rest), `event.reminder`.
- **`NotificationsService`** exposes one `enqueue*` method per kind (e.g.
  `enqueueRegistrationApproved(registrationId, eventId, organizationId,
  userId)`), each a thin `queue.add(kind, payload, { jobId? })` call. Calling
  services pass IDs only, not resolved email addresses — the processor
  re-fetches the current `User.email`/`Event.title` at send time, so a
  changed email or renamed event before the job runs is reflected correctly
  and no PII sits in the Redis job payload longer than necessary.
- **`NotificationsProcessor`** (`@Processor('notifications')`): one
  `@Process(kind)` handler per job kind. Each handler: (1) re-fetches the
  data it needs via Prisma, (2) builds `{subject, text}` via `templates.ts`,
  (3) calls `MailerService.sendMail`, (4) on success, calls
  `AuditService.record({ organizationId, action: 'notification.email',
  targetType, targetId, metadata: { kind } })` — no email address or body in
  the metadata. On failure, throws (BullMQ retries with default backoff);
  after retries exhaust, BullMQ marks the job failed and it's visible via
  Redis/Bull Board-style inspection if ever added — no audit row for a
  failure, matching "audit successful sensitive actions" precedent (no
  existing feature audits failed attempts either).
- **`MailerService`**: `nodemailer.createTransport({ host, port, auth })`
  from env. Dev points at a new `mailpit` container (no auth). Prod reads
  real SMTP creds from env — same client code path either way.
- **Reminder scheduling** (delayed job, deterministic ID `reminder:<eventId>`
  so it can be found and removed/replaced):
  - `EventsService.publish()`: after the transition commits, if
    `startAt - 24h` is still in the future, adds an `event.reminder` job
    with payload `{ eventId, organizationId }`, job ID `reminder:<eventId>`,
    and `delay` set to the milliseconds until `startAt - 24h`. If
    `startAt - 24h` has already passed (event published <24h out), skip —
    no immediate reminder substitute.
  - `EventsService.update()`: if `startAt` changed and the event is
    currently `PUBLISHED`, remove any existing `reminder:<eventId>` job
    (`queue.remove(jobId)`, no-op if absent/already run) then re-add with
    the new delay (skip re-add if the new `startAt - 24h` is in the past).
  - `EventsService.transition()` to `CANCELLED`: remove
    `reminder:<eventId>`.
  - `transition()` to `COMPLETED`: also remove `reminder:<eventId>` (an
    event can only complete after `endAt`, which is after the reminder
    would have fired, so this is normally a no-op — kept for symmetry and
    safety in case of manual/out-of-order transitions).
  - The reminder job handler, at fire time: loads the event; if it's no
    longer `PUBLISHED` (defensive — should already be prevented by the
    removals above), skip silently; otherwise loads all `APPROVED`
    registrations for that event with `User.email`, sends one email per
    registrant, and writes **one** `notification.email` audit row per
    registrant sent (`targetType: 'Registration'`).

## Data model

No new Prisma models, no new columns. `TENANT_SCOPED_MODELS` unchanged.

New env vars (added to `env.validation.ts` with dev defaults, `.env.example`
updated):

```text
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_USER=            # optional, blank for mailpit
MAIL_PASS=            # optional, blank for mailpit
MAIL_FROM="University Club Platform <no-reply@ucm.local>"
```

`docker-compose.yml` gains:

```yaml
mailpit:
  image: axllent/mailpit
  ports:
    - "1025:1025"   # SMTP
    - "8025:8025"   # web UI
```

## Triggers — call sites

| Trigger | Call site | Enqueued job |
| --- | --- | --- |
| `register()` → `APPROVED` | `RegistrationsService.register()`, after the transaction returns | `registration.approved` |
| `register()` → `WAITLISTED` | same | `registration.waitlisted` |
| `register()` (either outcome) | same, additionally | `registration.new` × one per committee-tier (`MANAGE_EVENTS`) org member |
| `reject()` | `RegistrationsService.resolve()`, after the transaction returns, when `action === 'registration.reject'` | `registration.rejected` |
| waitlist cascade promotes a candidate | same `resolve()` call, after the transaction returns, for each promoted candidate | `registration.promoted` |
| `publish()` | `EventsService.publish()`, after the transition commits | delayed `event.reminder` (`reminder:<eventId>`) |
| `update()` with changed `startAt` on a `PUBLISHED` event | `EventsService.update()`, after the transaction commits | remove + re-add `reminder:<eventId>` |
| `transition()` to `CANCELLED`/`COMPLETED` | `EventsService.transition()`, after the transition commits | remove `reminder:<eventId>` |
| reminder fires | processor | `event.reminder` handler fans out to all `APPROVED` registrants |

All enqueue calls happen **after** their triggering `$transaction` resolves
successfully (not inside the `tx` callback) — a queue push isn't part of the
Postgres transaction and shouldn't be attempted while it's still open.

## RBAC

None — no new endpoints. Enqueue calls are internal side effects of
already-guarded actions (`register`, `reject`, `publish`, `update`,
`transition`); no new attack surface.

## Audit

One new audit action: `notification.email`. Written by the processor only
on successful send, always `targetType: 'Registration'`, `targetId:
<registrationId>`, metadata `{ kind }` — every job kind traces back to a
specific registrant's `Registration` (including `registration.new`, whose
payload carries the triggering registration's ID, and `event.reminder`,
which writes one audit row per registrant it emails within that job).
Never includes the recipient's email address or message body — per
CLAUDE.md's "never log personal data."

No read endpoints in this module, so nothing else to audit.

## Testing plan

**Unit** (`backend/src/notifications/*.spec.ts`):

- `templates.ts`: one test per kind asserting `{subject, text}` shape and
  that required data (event title, dates) is interpolated correctly.
- `MailerService`: mock `nodemailer.createTransport`; assert `sendMail`
  called with expected `to`/`subject`/`text`.
- `NotificationsProcessor`: mock Prisma + `MailerService` + `AuditService`;
  one test per job kind asserting the right data is fetched, the right
  template is used, and the audit row shape (`kind`, `targetType`,
  `targetId`) is correct and PII-free.
- `NotificationsService.enqueue*`: mock the BullMQ queue; assert correct
  job name/payload/`jobId` per method, including the delay calculation for
  `event.reminder` and its `jobId` format.

**Unit additions to existing services:**

- `RegistrationsService.register()`/`resolve()`: assert the right
  `enqueue*` calls happen (mock `NotificationsService`) for each outcome
  (approved, waitlisted, rejected, promoted, committee fan-out) — and that
  no enqueue happens on a path that doesn't apply (e.g. no
  `registration.promoted` when no one was waitlisted).
- `EventsService.publish()`/`update()`/`transition()`: assert
  `queue.add`/`queue.remove` calls with the right `jobId` and delay,
  including the "skip if already past" branches on `publish()` and
  `update()`.

**E2E** (`backend/test/notifications-*.e2e-spec.ts`): run the queue in the
same process against a real (test) Redis, but assert on **enqueued job
state** (BullMQ's `getJob`/`getDelayed` etc.) and on **audit rows**, not on
actual SMTP delivery — no mailpit dependency in CI.

- Registering into an event under capacity → job for
  `registration.approved` enqueued for the registrant, plus one
  `registration.new` job per committee member; audit assertions after
  manually draining the queue in the test.
- Registering into a full event → `registration.waitlisted` instead.
- Committee rejects a registration → `registration.rejected` enqueued.
- Cancelling an `APPROVED` registration with a `WAITLISTED` one behind it →
  `registration.promoted` enqueued for the promoted registrant.
- Publishing an event >24h out → delayed `event.reminder` job exists with
  `jobId === 'reminder:<eventId>'` and a delay matching `startAt - 24h -
  now`.
- Publishing an event <24h out → no `event.reminder` job created.
- Updating a `PUBLISHED` event's `startAt` → old delayed job gone, new one
  present with updated delay.
- Cancelling a `PUBLISHED` event with a pending reminder → job removed.
- Tenant isolation: org A's committee members never receive a
  `registration.new` job for org B's registration (assert by inspecting
  enqueued job payloads' `organizationId`).

## Out of scope

- Opt-out/unsubscribe.
- Configurable reminder lead time.
- HTML/branded templates.
- Persistent delivery-log table.
- Outbox pattern / exactly-once enqueue guarantees.
- SMS/push notification channels.
- Digest/batching (e.g. one daily digest instead of per-event committee
  emails) — every trigger sends immediately, one email per event.
