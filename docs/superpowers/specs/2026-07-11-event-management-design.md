# Event Management — Design Spec

Roadmap Phase 1, item 5. Org-scoped event CRUD + lifecycle status. Banner
upload is **out of scope** (schema field only) — it lands with the shared
storage module, built as its own spec just before Certificates (item 8).
Registration forms, waitlist, and capacity **enforcement** are item 6 (a
separate spec); this module only stores a capacity number.

Builds directly on the memberships module patterns (org-scoped service,
`@Roles` guard chain, self-scoped mutations, PDPA-clean audit). Read
`docs/security.md` and `backend/src/memberships/` before implementing.

---

## 1. Scope

**In:** Event model + `EventStatus` enum; create, edit, list, read; lifecycle
transitions (publish / complete / cancel) as separate action endpoints; hard
delete; DRAFT visibility control; tenant-isolation tests.

**Out (deferred, do not build):** banner upload / storage module; registration
forms; waitlist; capacity enforcement; participant/public (unauthenticated)
event browsing; event feedback/NPS (Phase 2); recurring events; online-vs-venue
typing; registration deadlines.

---

## 2. Data model

New enum + model in `backend/prisma/schema.prisma`:

```prisma
enum EventStatus {
  DRAFT
  PUBLISHED
  COMPLETED
  CANCELLED
}

model Event {
  id              String       @id @default(uuid())
  organizationId  String
  title           String
  description     String?
  venue           String?
  startAt         DateTime
  endAt           DateTime
  capacity        Int?         // null = unlimited; enforcement is item 6
  bannerKey       String?      // set later by the storage module; no upload here
  status          EventStatus  @default(DRAFT)
  createdByUserId String?      // actor who created it (audit/display)
  organization    Organization @relation(fields: [organizationId], references: [id])
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  @@index([organizationId])
  @@index([organizationId, status])
}
```

`Organization` gains `events Event[]`.

**Tenant scope middleware:** add `Event` to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts`, so a filtering read
(`findMany`/`findFirst`/`count`) that omits `organizationId` throws — the same
protection `Membership` and `AuditLog` have. Prove it with the existing
middleware unit spec (extend it if it enumerates models).

Migration created via `npx prisma migrate dev`.

---

## 3. Role group

Add to `backend/src/rbac/role-groups.ts`:

```typescript
export const MANAGE_EVENTS: Role[] = [
  'PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'EVENT_DIRECTOR', 'COMMITTEE',
];
```

Matches the `docs/security.md` matrix "Create/edit events" row. Destructive
actions (cancel, delete) reuse the existing `MANAGE_MEMBERS` (excludes
Committee).

---

## 4. Endpoints & RBAC

`@Controller('organizations/:orgId/events')`. Guard chain on **every** route:
`JwtAuthGuard → TenantGuard → RolesGuard`.

| Route | Guard tier | Transition / purpose |
|-------|-----------|----------------------|
| `POST /` | `MANAGE_EVENTS` | create (starts `DRAFT`) |
| `GET /` | any member (TenantGuard only, no `@Roles`) | list; DRAFT filtered out for non-managers |
| `GET /:id` | any member (TenantGuard only, no `@Roles`) | read; 404 on DRAFT for non-managers |
| `PATCH /:id` | `MANAGE_EVENTS` | edit fields |
| `POST /:id/publish` | `MANAGE_EVENTS` | `DRAFT → PUBLISHED` |
| `POST /:id/complete` | `MANAGE_EVENTS` | `PUBLISHED → COMPLETED` |
| `POST /:id/cancel` | `MANAGE_MEMBERS` | `DRAFT\|PUBLISHED → CANCELLED` |
| `DELETE /:id` | `MANAGE_MEMBERS` | hard delete (any state) |

The two read routes carry no `@Roles` (any org member with a membership passes
`TenantGuard`). They need the caller's role to decide DRAFT visibility: read it
via the existing `@MembershipRole()` decorator and compute
`canManage = MANAGE_EVENTS.includes(role)` in the service.

Reads default to newest-first, e.g. `orderBy: { startAt: 'desc' }`.

---

## 5. Transition & precondition rules

Each action verifies current state and throws `ConflictException` (409)
otherwise — the guardrail style already used in `MembershipsService`:

- **create:** always starts `DRAFT`; sets `createdByUserId` from the actor.
- **publish:** must be `DRAFT` else 409. `endAt` must be in the future at
  publish time else `ConflictException` (can't publish an already-past event).
- **complete:** must be `PUBLISHED` else 409.
- **cancel:** must be `DRAFT` or `PUBLISHED` else 409.
- **edit (PATCH):** allowed only on `DRAFT` and `PUBLISHED`; **rejected on
  `COMPLETED`/`CANCELLED`** (409) — terminal states are immutable.
- **delete:** allowed in any state (`MANAGE_MEMBERS` only).

All mutations self-scope `where: { id, organizationId }` (the middleware does
not cover `update`/`delete`) and map Prisma `P2025 → 404` via the established
pattern. Each transition (and delete) wraps its state write + audit write in a
single `$transaction` so a failed audit rolls back the state change. No
serializable isolation needed — these are single-row edits with no
cross-row invariant (unlike the last-president count).

DRAFT read guard: `GET /:id` on a DRAFT event returns **404** (not 403) for a
non-manager, so unpublished events don't leak their existence.

---

## 6. Validation (DTOs, global `whitelist:true`)

`CreateEventDto`:

```typescript
title       string   @IsString @MinLength(2)          // required
description  string?  @IsOptional @IsString
venue        string?  @IsOptional @IsString
startAt      string   @IsISO8601                       // required
endAt        string   @IsISO8601                       // required
capacity     number?  @IsOptional @IsInt @Min(1)
```

Cross-field: `endAt` must be strictly after `startAt` → **400** on violation
(in-service check throwing `BadRequestException`, or a custom class-validator
constraint).

`UpdateEventDto`: every field above optional. **No** `status`,
`organizationId`, `createdByUserId`, or `bannerKey` — status only moves via the
action endpoints, and the others are server-owned. Global
`ValidationPipe({ whitelist: true })` strips any such extras (mass-assignment
guard). On a partial date update, re-validate the **effective** pair
(incoming value or the persisted one) so `endAt > startAt` always holds.

---

## 7. Tenancy & audit

Every query org-scoped (Section 2 + self-scoped mutations). Audit actions
(metadata is **ids / enum values / event title only** — never personal data;
`title` is organizational data and is intentionally included for a readable log):

| Action | metadata |
|--------|----------|
| `event.create` | `{ eventId, title }` |
| `event.update` | `{ eventId, fields: [...changed] }` |
| `event.publish` | `{ eventId, from, to }` |
| `event.complete` | `{ eventId, from, to }` |
| `event.cancel` | `{ eventId, from, to }` |
| `event.delete` | `{ eventId }` |

Audit writes ride inside the same `$transaction` as their mutation
(`this.audit.record(entry, tx)`).

---

## 8. Testing (TDD, mandatory tenant isolation)

Per-task e2e specs (against the running Postgres, like the membership suites):

- `events-crud`: create (→ DRAFT), list (manager sees DRAFT; non-manager does
  not), get by id, edit; edit on COMPLETED/CANCELLED → 409.
- `events-lifecycle`: publish / complete / cancel happy paths + each wrong-state
  409; publish of a past-dated event → 409; cancel by a `COMMITTEE` member →
  403 (destructive tier is `MANAGE_MEMBERS`).
- `events-validation`: `endAt <= startAt` → 400; `capacity < 1` → 400; missing
  title → 400.
- `events-isolation`: org A cannot list / read / edit / transition / delete org
  B's events; DRAFT of B not leaked to A; membership-in-A + B-event-id guessing
  → 404. (Mirrors `memberships-isolation`.)

Unit: extend the tenant-scope middleware spec to assert `Event` is scoped.

Every feature: red → green → refactor. All existing suites stay green
(currently unit 18, e2e 33).

---

## 9. Module wiring

New `backend/src/events/` module (`events.module.ts`, `events.controller.ts`,
`events.service.ts`, `dto/create-event.dto.ts`, `dto/update-event.dto.ts`),
registered in `AppModule`. Service consumes `PrismaService` + `AuditService`.
No changes to auth, tenancy guards, or organizations beyond the
`Organization.events` back-relation.

---

## 10. Deferred / follow-up (tracked, not built here)

- Banner upload + shared storage module (MinIO presign, MIME/size/quota,
  signed URLs) — own spec before item 8.
- Capacity enforcement + registration/waitlist — item 6.
- Public/unauthenticated event browsing — Phase 2 public club page.
- List filtering/pagination query DTO (`?status`, `?from`, `?to`) — add when the
  dashboard needs it; note the pre-existing member-list query-param backlog item.
- `Event` FK `onDelete` behaviour once registrations/attendance/certificates
  reference it (PDPA cascade) — revisit at item 6.
