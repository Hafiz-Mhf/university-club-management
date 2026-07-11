# Registration — Design Spec

Roadmap Phase 1, item 6. Custom registration forms, approval workflow,
waitlist with auto-promote on cancel — the module that turns "browsing an
event" into "being on the list for it." Builds directly on Event Management
(`docs/superpowers/specs/2026-07-11-event-management-design.md`) and the
memberships module's patterns (self-scoped mutations, CAS transitions,
PDPA-clean audit).

Export and payment integration are explicitly future (`docs/planning.md`) —
**not built here**.

---

## 1. Scope

**In:** `RegistrationForm`/`FormField` (optional per event, 4 field types);
self-service registration that auto-enrolls a `PARTICIPANT` membership;
capacity-aware auto-approve/auto-waitlist; participant self-cancel; committee
reject; FIFO auto-promote from the waitlist on cancel/reject; a minimal
`ConsentRecord` snapshot per registration; tenant-isolation tests.

**Out (deferred, do not build):** CSV/data export; payment integration
(the `PENDING` status is reserved for this later, unused for now); manual
approve of a `PENDING` registration (default flow auto-approves; nothing
currently produces `PENDING`); QR attendance (item 7); full PDPA
export/delete endpoints (item 11 — `ConsentRecord` is written here so that
module has data to work with, but no PDPA endpoints ship in this spec);
out-of-order manual promotion from the waitlist (promotion is strictly FIFO).

---

## 2. Data model

New enums + models in `backend/prisma/schema.prisma`:

```prisma
enum RegistrationStatus {
  PENDING     // reserved for a future manual-review/payment flow; unused by this spec
  APPROVED
  WAITLISTED
  REJECTED
  CANCELLED
}

enum FormFieldType {
  TEXT
  TEXTAREA
  SELECT
  CHECKBOX
}

model RegistrationForm {
  id        String      @id @default(uuid())
  eventId   String      @unique
  event     Event       @relation(fields: [eventId], references: [id])
  fields    FormField[]
  createdAt DateTime    @default(now())
}

model FormField {
  id                 String           @id @default(uuid())
  registrationFormId String
  registrationForm   RegistrationForm @relation(fields: [registrationFormId], references: [id])
  label              String
  type               FormFieldType
  required           Boolean          @default(false)
  options            Json?            // string[] for SELECT; null otherwise
  order              Int

  @@index([registrationFormId])
}

model Registration {
  id              String             @id @default(uuid())
  eventId         String
  organizationId  String             // denormalized: tenant-scope middleware + direct per-org listing
  userId          String
  answers         Json?              // Record<fieldId, string | string[]>; null if event has no form
  status          RegistrationStatus @default(APPROVED)
  consentRecordId String             @unique
  event           Event              @relation(fields: [eventId], references: [id])
  user            User               @relation(fields: [userId], references: [id])
  consentRecord   ConsentRecord      @relation(fields: [consentRecordId], references: [id])
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  @@unique([eventId, userId])
  @@index([organizationId])
  @@index([eventId, status])
}

model ConsentRecord {
  id            String   @id @default(uuid())
  userId        String
  purpose       String   // 'event-registration' for this module
  policyVersion String
  grantedAt     DateTime @default(now())
  ipAddress     String?
  user          User     @relation(fields: [userId], references: [id])
}
```

`Event` gains `registrationForm RegistrationForm?` and
`registrations Registration[]`. `User` gains `registrations Registration[]`
and `consentRecords ConsentRecord[]`.

**Tenant scope middleware:** add `Registration` to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts` (same protection `Event`,
`Membership`, `AuditLog` have). `RegistrationForm`/`FormField` are **not**
added — they carry no `organizationId` of their own and are only ever reached
through their already-org-scoped parent `Event`, the same pattern used
elsewhere in this codebase for strictly-owned child records.

Migration via `npx prisma migrate dev`.

---

## 3. Endpoints & RBAC

Two controllers, both nested under events.

### Form management — `/organizations/:orgId/events/:eventId/registration-form`

| Route | Guard tier | Purpose |
|-------|-----------|---------|
| `PUT /` | `MANAGE_EVENTS` | create-or-replace the whole `fields[]` (atomic swap, not incremental) |
| `GET /` | any member (`TenantGuard` only, no `@Roles`) | participants need to see what to fill in |
| `DELETE /` | `MANAGE_EVENTS` | remove the form — event reverts to bare signup |

`PUT`/`DELETE` are rejected with 409 when the event is `COMPLETED` or
`CANCELLED` — same terminal-state-immutable rule as editing the event itself.

### Registrations — `/organizations/:orgId/events/:eventId/registrations`

| Route | Guard | Purpose |
|-------|-------|---------|
| `POST /` | `JwtAuthGuard` only | self-register; auto-enrolls a `PARTICIPANT` membership if the caller has none in this org |
| `GET /` | `MANAGE_EVENTS` | list all registrations for the event, with answers |
| `GET /me` | `TenantGuard` only | caller's own registration for this event |
| `POST /:id/cancel` | `TenantGuard` only + ownership check | self-cancel (caller must own the registration) |
| `POST /:id/reject` | `MANAGE_EVENTS` | committee-initiated removal, any registration |

`POST /` requires the event to be `PUBLISHED` (`404` for `DRAFT`/`COMPLETED`/
`CANCELLED` — indistinguishable from a non-existent event to a stranger,
matching the event module's DRAFT-hidden-404 rule). Duplicate registration
(same user, same event) → `409` via the `[eventId, userId]` unique
constraint.

**Guard mechanism for self-service (Approach A, chosen over modifying
`TenantGuard` or moving the route outside `organizations/:orgId/...`):**
`POST /` uses `JwtAuthGuard` alone. The service manually verifies the org and
event exist, then does a `findOrCreate` on `Membership`
(`role: PARTICIPANT, status: ACTIVE`) inside the same transaction as creating
the `Registration`. `TenantGuard` itself is never modified — every other
route in this module (and every other module) keeps its existing "always
requires an active membership" contract untouched.

---

## 4. Registration, capacity, and waitlist logic

All inside one `$transaction`, mirroring the events module's CAS pattern:

```
register(organizationId, eventId, userId, dto):
  event = findFirst({ id: eventId, organizationId, status: 'PUBLISHED' })
  if !event: 404

  form = findUnique({ eventId })  // may be null
  if form:
    validate dto.answers against form.fields
      (every required field present; SELECT value ∈ options) — else 400
  else if dto.answers is non-empty: 400 (no form to answer)

  membership = upsert Membership
    where { userId, organizationId }
    create { userId, organizationId, role: 'PARTICIPANT', status: 'ACTIVE' }
    update {}  // no-op if it already exists — preserves existing role/status

  approvedCount = count(Registration, { eventId, status: 'APPROVED' })
  status = (event.capacity != null && approvedCount >= event.capacity)
    ? 'WAITLISTED' : 'APPROVED'

  consentRecord = create ConsentRecord
    { userId, purpose: 'event-registration', policyVersion: CURRENT_POLICY_VERSION,
      ipAddress: req.ip }

  registration = create Registration
    { eventId, organizationId, userId, answers: dto.answers ?? null, status,
      consentRecordId: consentRecord.id }
    — P2002 on [eventId, userId] → 409

  audit 'registration.create' { registrationId, eventId, status }  — no answers, no PII
  return registration
```

`CURRENT_POLICY_VERSION` is a literal constant (e.g. `'v1'`) defined in the
service — no versioning infrastructure beyond the literal; item 11 owns
policy-version management.

**Cancel and reject** share one private helper, `resolve(organizationId,
registrationId, terminalStatus, action, actorUserId)`:

```
resolve(...):
  current = findFirst({ id: registrationId, organizationId })
  if !current: 404
  if current.status in ['REJECTED', 'CANCELLED']: 409 (already terminal)

  // CAS, same shape as event transitions
  updated = update({ where: { id, organizationId, status: current.status },
                      data: { status: terminalStatus } })
    — P2025 → 409 (concurrent modification)

  audit action { registrationId, from: current.status, to: terminalStatus }

  if current.status == 'APPROVED':
    promoted = findFirst({ eventId: current.eventId, status: 'WAITLISTED' },
                          orderBy: { createdAt: 'asc' })  // FIFO
    if promoted:
      update promoted (same CAS shape) → 'APPROVED'
      audit 'registration.promote' { registrationId: promoted.id, eventId }

  return updated
```

`cancel` calls `resolve(..., 'CANCELLED', 'registration.cancel', ...)` after
an ownership check (`current.userId === caller.userId`, else `403` — checked
*after* the 404 so a stranger can't distinguish "not found" from "not
yours"). `reject` calls `resolve(..., 'REJECTED', 'registration.reject', ...)`
with no ownership check (any `MANAGE_EVENTS` holder may reject any
registration).

Capacity is checked only against `APPROVED` count — `PENDING` is unused by
this spec (reserved for a future manual-review/payment hold state).

---

## 5. Validation (DTOs, global `whitelist:true`)

`UpsertRegistrationFormDto`:

```typescript
fields: FormFieldDto[]   // @IsArray @ValidateNested({ each: true }) @Type(() => FormFieldDto)

// FormFieldDto:
label     string        @IsString @MinLength(1)
type      FormFieldType @IsEnum(FormFieldType)
required  boolean?      @IsOptional @IsBoolean
options   string[]?     @IsOptional @IsArray @IsString({ each: true })
order     number        @IsInt @Min(0)
```

Cross-field: `options` must be a non-empty array **iff** `type === 'SELECT'`,
else must be absent — checked with a custom class-validator constraint (or an
in-service check throwing `BadRequestException`) rather than per-field
decorators alone.

`RegisterDto`:

```typescript
answers?: Record<string, string | string[]>   // @IsOptional @IsObject
```

No `status`, `organizationId`, `userId`, or `consentRecordId` ever accepted
from a client — the whitelist pipe strips them; the service never reads them
from the DTO.

---

## 6. Tenancy & audit

`Registration` is org-scoped and self-scoping on every mutation (`where: {
id, organizationId }`), matching the pattern established in the events
module. Audit actions — **metadata is ids/enum values only, never `answers`**
(form responses can carry arbitrary personal data, unlike an event `title`):

| Action | metadata |
|--------|----------|
| `registration.create` | `{ registrationId, eventId, status }` |
| `registration.cancel` | `{ registrationId, from, to }` |
| `registration.reject` | `{ registrationId, from, to }` |
| `registration.promote` | `{ registrationId, eventId }` |
| `form.upsert` | `{ eventId, fieldCount }` |
| `form.delete` | `{ eventId }` |

All audit writes ride inside the same `$transaction` as their mutation.

---

## 7. Testing (TDD, mandatory tenant isolation)

Per-task e2e specs:

- `registrations-form`: PUT/GET/DELETE; `SELECT` without `options` → 400;
  edit/delete on a `COMPLETED`/`CANCELLED` event → 409.
- `registrations-register`: bare event (no form) → 201 `APPROVED`; event with
  a form, missing a required field → 400; duplicate registration → 409;
  register on `DRAFT`/`COMPLETED`/`CANCELLED` event → 404; a fresh user with
  zero prior membership registers, then successfully hits
  `GET .../members/me` and is `PARTICIPANT`/`ACTIVE` (proves auto-enrollment).
- `registrations-capacity`: fill capacity exactly → next registration is
  `WAITLISTED`; cancel an `APPROVED` registration with 2+ people waitlisted →
  the *oldest* waitlisted one promotes to `APPROVED` (FIFO), not an arbitrary
  one.
- `registrations-cancel-reject`: owner cancels (200); non-owner cancel
  attempt (403); committee (including `COMMITTEE` role, since `reject` is
  `MANAGE_EVENTS`) rejects (200); double-cancel/double-reject on an already
  terminal registration → 409.
- `registrations-isolation`: org A cannot list / cancel / reject org B's
  registrations, or read/write org B's form (wrong-org → 403 via
  `TenantGuard`); registering for org B's event through **org A's own URL
  path** (`eventId` mismatched to `orgId`) → 404 (id-guessing). Note:
  self-*registration* into an org B event using B's own correct path is
  intentionally NOT an isolation violation — any authenticated user may
  register for any org's `PUBLISHED` event by design (§3); this suite tests
  the boundary around *managing* registrations, not around who may create
  one. Survival assertion included.

Unit: extend the tenant-scope middleware spec to assert `Registration` is
scoped (mirrors the `Event` case added in the previous plan).

Every feature: red → green → refactor. All existing suites stay green
(current baseline on `main`: unit 23, e2e 66).

---

## 8. Module wiring

New `backend/src/registrations/` module: `registrations.module.ts`,
`registrations.controller.ts` (registrations), `registration-form.controller.ts`
(form management), `registrations.service.ts`, `registration-form.service.ts`,
`dto/{register.dto.ts, upsert-registration-form.dto.ts, form-field.dto.ts}`.
Registered in `AppModule`. Services consume `PrismaService` + `AuditService`
(both global, no explicit imports needed — matches `EventsModule`).

No changes to auth, tenancy guards, RBAC guards, or the events module beyond
the `Event.registrationForm` / `Event.registrations` back-relations. No new
role group — reuses `MANAGE_EVENTS` for form management and registration
review/reject (the existing security-matrix "Approve registrations" row is
already exactly this tier).

---

## 9. Deferred / follow-up (tracked, not built here)

- CSV/data export of registrants.
- Payment integration; the `PENDING` status and hold-state semantics it will
  need.
- Manual out-of-order promotion from the waitlist (strictly FIFO for now).
- Full PDPA export/delete endpoints (item 11) — `ConsentRecord` rows already
  exist for that module to act on.
- QR attendance (item 7) — will consume `Registration.status === 'APPROVED'`
  as its precondition.
- Policy-version management beyond a literal constant.
