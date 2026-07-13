# Security & Privacy Design

Covers authentication, authorization (RBAC), multi-tenant isolation, PDPA, and
audit logging. Security is a first-class requirement, not an afterthought.

---

## 1. Authentication

- Email + password. Passwords hashed with **argon2** (or bcrypt) — never stored plain.
- **JWT bearer** tokens (short-lived access + refresh token rotation).
- Refresh tokens stored hashed; revocable on logout / password change.
- MFA (TOTP) — schema-ready (`User.mfaSecret`), enabled in a later phase.
- University SSO (SAML/OIDC) — Phase 3.
- Rate-limit login + lockout on repeated failures. HTTPS enforced everywhere.

---

## 2. Authorization — RBAC

Roles resolve **per organization** via `Membership.role`. A user can hold
different roles in different organizations. There is no global role except the
platform-level `SuperAdmin` / `UniversityAdmin`.

### Hierarchy
```
SuperAdmin > UniversityAdmin > Advisor > President > VP >
Secretary / Treasurer / EventDirector > Committee > Volunteer > Participant
```

### Enforcement
- `AuthGuard` verifies JWT.
- `TenantGuard` resolves the caller's active org + membership, injects scope.
- `RolesGuard` reads the `@Roles()` decorator on the handler and checks the
  caller's per-org role.

### Permission Matrix (Phase 1)

| Capability | President | VP | Sec/Treas/EvDir | Committee | Volunteer | Participant |
|---|---|---|---|---|---|---|
| Manage org settings/branding | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage committee & roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage members | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/edit events | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View events (published) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve registrations | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Scan QR / mark attendance | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Upload certificates | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View org analytics/dashboard | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Register for events | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Download own certificate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View audit log | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

`Advisor` = read-only oversight across the org. `SuperAdmin`/`UniversityAdmin`
= platform admin (cross-tenant, break-glass logged).

### As built — member management (shipped)

Permission tiers are centralized in `backend/src/rbac/role-groups.ts`:

- `MANAGE_ROLES` = President, VP — change committee roles, remove members,
  assign President/VP on member add.
- `MANAGE_MEMBERS` = MANAGE_ROLES + Secretary, Treasurer, Event Director —
  add members, update profile/status.
- `VIEW_MEMBERS` = MANAGE_MEMBERS + Committee — list members.

Endpoints (`/organizations/:orgId/members`): `GET` (VIEW_MEMBERS), `GET /me`
(any member), `POST` (MANAGE_MEMBERS), `PATCH /:id` profile/status
(MANAGE_MEMBERS), `PATCH /:id/role` (MANAGE_ROLES), `DELETE /:id`
(MANAGE_ROLES). Guard chain on every route: `JwtAuthGuard → TenantGuard →
RolesGuard`; the actor's role is always read from `req.membershipRole` (set by
`TenantGuard`), never from the client.

Invariants enforced in `MembershipsService`:

- **Escalation guard:** a MANAGE_MEMBERS-only actor cannot assign a
  President/VP role when adding a member (403).
- **Last-president guardrail:** an org must always keep ≥1 ACTIVE President.
  Enforced on role change, status change (alumni), and removal — inside
  **serializable transactions** so concurrent demotions cannot race past the
  check (serialization conflicts map to 409).
- Role changes append `{role, until}` to `committeeHistory`.
- Audit actions: `member.add`, `member.status.change`, `member.role.change`,
  `member.remove` — metadata is ids/enum values only, never personal data.

Known accepted risk (policy decision pending): a VP can seize the presidency
in two audited calls (promote self, then demote the original President), and
any MANAGE_MEMBERS holder can mark a non-last President as alumni. Both match
the Phase-1 matrix; revisit if committee politics demand President-only
controls.

### As built — event management (shipped)

Permission tiers (same `backend/src/rbac/role-groups.ts`):

- `MANAGE_EVENTS` = MANAGE_MEMBERS + Committee (President, VP, Secretary,
  Treasurer, Event Director, Committee) — create/edit events and drive
  DRAFT→PUBLISHED→COMPLETED transitions.
- `MANAGE_MEMBERS` (reused, destructive tier) — cancel and delete events; one
  step above MANAGE_EVENTS since these are harder to undo.

Endpoints (`/organizations/:orgId/events`):

| Route | Tier | Notes |
|---|---|---|
| `POST /` | MANAGE_EVENTS | creates in `DRAFT` |
| `GET /` | any member (TenantGuard only) | DRAFT hidden from non-managers |
| `GET /:eventId` | any member (TenantGuard only) | DRAFT read by a non-manager → 404, not 403 |
| `PATCH /:eventId` | MANAGE_EVENTS | 409 if event is COMPLETED/CANCELLED — terminal states immutable |
| `POST /:eventId/publish` | MANAGE_EVENTS | DRAFT→PUBLISHED; 409 if `endAt` already past |
| `POST /:eventId/complete` | MANAGE_EVENTS | PUBLISHED→COMPLETED |
| `POST /:eventId/cancel` | MANAGE_MEMBERS | DRAFT\|PUBLISHED→CANCELLED |
| `DELETE /:eventId` | MANAGE_MEMBERS | any status |

Guard chain: `JwtAuthGuard → TenantGuard → RolesGuard` on the gated routes;
`list`/`get` drop `RolesGuard` — visibility is filtered inside the service by
the caller's `req.membershipRole`, not gated by a role decorator. All
mutations self-scope `where: { id, organizationId }` (the tenant-scope
middleware covers `Event` for filtering reads, not `update`/`delete` — see
§3).

Invariants enforced in `EventsService`:

- **Create/edit vs destructive split:** create, edit, and the forward
  transitions (publish, complete) sit at MANAGE_EVENTS; cancel and delete —
  the two operations that void or destroy an event — require MANAGE_MEMBERS.
- **Terminal-state immutability:** COMPLETED and CANCELLED events reject
  `PATCH` with 409.
- **DRAFT-hidden-404:** DRAFT events are invisible to non-managers in both
  `list` (filtered out of the result set) and `get` (404, never 403 — avoids
  confirming a DRAFT event's existence to someone who isn't allowed to see
  it).
- **Compare-and-swap transitions:** `publish`/`complete`/`cancel` update
  `where: { id, organizationId, status: <validated-status> }` inside a
  transaction; a concurrent conflicting transition loses with Prisma P2025 →
  mapped to 409, and never writes an audit row for the loser.
- Audit actions: `event.create` `{eventId, title}`, `event.update`
  `{eventId, fields}`, `event.publish` / `event.complete` / `event.cancel`
  `{eventId, from, to}`, `event.delete` `{eventId, title}` — metadata is
  ids/enum values/title only, never personal data.

### As built — registration (shipped)

No new role group: `MANAGE_EVENTS` (see above) is reused for registration-form
management (`PUT`/`DELETE` on `registration-form`) and for the committee
side of registrations (`GET` list, `POST /:registrationId/reject`).

Endpoints (`/organizations/:orgId/events/:eventId/registrations` +
`.../registration-form`):

| Route | Tier | Notes |
|---|---|---|
| `POST /registrations` | any authenticated user (`JwtAuthGuard` only — **no `TenantGuard`**) | self-registration; see below |
| `GET /registrations` | MANAGE_EVENTS | list all registrations for the event |
| `GET /registrations/me` | any org member (TenantGuard only) | caller's own registration |
| `POST /registrations/:id/cancel` | any org member (TenantGuard only) | ownership-checked, see below |
| `POST /registrations/:id/reject` | MANAGE_EVENTS | any registration in the org |
| `PUT` / `GET` / `DELETE registration-form` | `PUT`/`DELETE`: MANAGE_EVENTS; `GET`: any org member | form GET has no `RolesGuard` |

**Self-enrollment mechanism (deliberate cross-org design):** `POST
/registrations` is the only route in the codebase that skips `TenantGuard`,
reading `orgId` from the route param instead of `req.organizationId`. Any
authenticated user may register for any org's `PUBLISHED` event, even if they
hold no `Membership` in that org yet — `RegistrationsService.register()`
upserts a `PARTICIPANT` `Membership` for the caller as part of registering.
This is intentional, not an isolation gap: participants discover and join
events/clubs they are not members of yet, and self-registration is how that
first membership is created. Every other registration operation (list,
cancel, reject, form management) is fully tenant-isolated through the normal
`TenantGuard` + org-scoped `where` pattern.

**Capacity / waitlist invariant:** `register()` takes a `SELECT ... FOR
UPDATE` lock on the `Event` row before counting `APPROVED` registrations for
that event (org-scoped), serializing concurrent registrants against the same
capacity. Below `event.capacity` (or `capacity === null` = unlimited) →
`APPROVED`; at/over capacity → `WAITLISTED`. When an `APPROVED` registration
resolves to a terminal state (`cancel` or `reject`), the same transaction
promotes the oldest `WAITLISTED` registration for that event (`createdAt`
asc, FIFO) to `APPROVED`. Promotion uses a CAS `updateMany` loop (not a single
`update`) so a race against a concurrent `resolve()` on a different
registration for the same event degrades to "try the next-oldest waitlisted
row" instead of aborting the whole transaction.

**Cancel vs. reject split:** `cancel` is self-service — the caller may only
cancel their **own** registration (403 if not, checked after a 404
existence/org-scope check). `reject` is committee-only (MANAGE_EVENTS) and
can act on **any** registration in the org. Both funnel into the same
`resolve()` helper: terminal states (`REJECTED`, `CANCELLED`) are final — a
second resolve attempt on an already-terminal registration is a 409, and a
concurrent resolve on the same row loses via compare-and-swap (`update` with
`status: current.status` in the `where`) mapped to 409, never writing an
audit row for the loser.

**Audit actions:** `registration.create` `{registrationId, eventId, status}`,
`registration.cancel` / `registration.reject` `{registrationId, from, to}`,
`registration.promote` `{registrationId, eventId}`, `form.upsert`
`{eventId, fieldCount}`, `form.delete` `{eventId}` — metadata is ids/enum
values/counts only; registration **answers are never logged**, in keeping
with the "never personal data in logs" rule.

**PDPA note:** a `ConsentRecord` (purpose `event-registration`,
`policyVersion`, `grantedAt`, `ipAddress`) is written in the same transaction
as every `Registration`, ahead of the full PDPA module (roadmap item 11),
which will own the export/delete/anonymize endpoints described in §5 below.

### As built — attendance (shipped)

New role group: `MANAGE_ATTENDANCE = [...MANAGE_EVENTS, 'VOLUNTEER']` — the
first feature to grant the `VOLUNTEER` role any capability, matching the
Permission Matrix's "Scan QR / mark attendance" row above.

| Route | Tier | Notes |
|---|---|---|
| `GET /attendance/me` | any org member (TenantGuard only) | caller's own attendance record + a fresh signed token |
| `GET /attendance` | MANAGE_ATTENDANCE | full list for the event |
| `POST /attendance/scan` `{ token }` | MANAGE_ATTENDANCE | verifies the token, CAS `REGISTERED → PRESENT` |
| `POST /attendance/:attendanceId/absent` | MANAGE_ATTENDANCE | CAS `REGISTERED → ABSENT`; 409 if already `PRESENT` |

**Stateless QR token:** no `qrTokenHash` column and no per-row secret — the
token is `attendanceId + "." + HMAC-SHA256(attendanceId, ATTENDANCE_TOKEN_SECRET)`,
a dedicated env-var secret independent of the JWT signing secrets. Verification
recomputes the HMAC and compares with a timing-safe equality check; a
malformed or tampered token is a `400`, never a `500` or a leak of whether
the id exists. Single-use is enforced purely by the status CAS: the first
scan flips `REGISTERED → PRESENT`; any further scan hits `P2025` on the CAS
and returns `409`, the same idiom used throughout events/registrations.

**Lifecycle tied to Registration, not a separate trigger:** `Attendance`
rows are created and deleted **inside `RegistrationsService`'s own
transactions** — created when a registration becomes `APPROVED` (direct
approve or waitlist promotion), deleted when a registration resolves to
`CANCELLED` or `REJECTED`. A cancelled or rejected participant's QR stops
verifying immediately (`404` on scan — the row is gone), without a separate
cleanup job.

**Audit actions:** `attendance.scan` / `attendance.absent`
`{attendanceId, eventId}` — metadata is ids/enum values only. The raw token
is never logged. Attendance row creation/deletion is not separately audited
— it's a system side effect already covered by `registration.create` /
`registration.promote` / `registration.cancel` / `registration.reject`.

### As built — certificates (shipped)

No new role group: `MANAGE_EVENTS` is reused for all committee-side
certificate operations (matches how registration list/reject and form
management already work).

| Route | Tier | Notes |
|---|---|---|
| `POST /certificates` (multipart `file` + body `userId`) | MANAGE_EVENTS | committee uploads on behalf of a specific participant |
| `GET /certificates` | MANAGE_EVENTS | list metadata for the event (id, userId, fileSizeBytes, createdAt) — no signed URLs |
| `GET /certificates/me` | any org member (TenantGuard only) | caller's own certificate + a fresh 5-min signed download URL; 404 if none |
| `GET /certificates/:certificateId/download` | MANAGE_EVENTS | fresh signed URL for any certificate in the event (committee verification) |
| `DELETE /certificates/:certificateId` | MANAGE_EVENTS | deletes the DB row + audit atomically, then the storage object |

Routes rooted at `/organizations/:orgId/events/:eventId/certificates`. Guard
chain on the gated routes: `JwtAuthGuard → TenantGuard → RolesGuard`; `/me`
drops `RolesGuard` (any authenticated org member reads their own certificate).

**Upload validation order** (`CertificatesService.upload`, fail-fast):

1. Org-scoped `Event` lookup — 404 if wrong org/event (no existence leak).
2. MIME must be `application/pdf`, size ≤ 5MB — checked in the service so the
   rejection is a clean 400. Multer's `FileInterceptor` limit sits higher
   (10MB) purely as an abuse ceiling.
3. Target user must have a `PRESENT` `Attendance` row for this event
   (org-scoped, joined through `Registration.userId`) — 400 if not.
4. **Duplicate pre-check before any storage write:**
   `certificate.findFirst({ eventId, organizationId, userId })` → 409
   immediately if one exists. The storage key is deterministic and *shared*
   across every upload attempt for the same person/event, so this must run
   before `putObject` — cleaning up "the just-uploaded object" on a later
   P2002 would delete the shared key and destroy the original, still-referenced
   certificate.
5. Live `SUM(fileSizeBytes)` for the org (`certificate.aggregate`) + the new
   file's size vs `Organization.storageQuotaMb` — 400 if it would exceed quota.
6. `StorageService.putObject` to the deterministic key.
7. `Certificate.create` + `certificate.upload` audit in one transaction. A
   residual P2002 (the narrow concurrent race the step-4 pre-check doesn't
   fully close) → 409; the storage object is **never** deleted on this path
   (on a shared key a losing request can't tell its own bytes from the
   winner's).

**Private storage / signed URLs:** single private S3-compatible bucket (MinIO
in dev), no public read. Both download routes call
`StorageService.getSignedDownloadUrl(storageKey, 300)` — a 5-minute-TTL signed
URL generated fresh per request and **never stored**. `/me` is
org+event+userId scoped (404 if none); the committee download route is
org+event scoped (404 if wrong org/event).

**Delete ordering (as shipped):** the DB row and the `certificate.delete`
audit row are deleted **atomically in a transaction first**, then the storage
object. A storage-delete failure leaves only an orphaned object at the
deterministic key, which self-heals on re-upload (upload overwrites the same
key). The reverse order (storage first) could leave a dangling DB row that
blocks re-upload with no self-heal. A lost concurrent double-delete surfaces as
P2025 → 404 and rolls back its own audit write with the transaction.

**Audit actions:** `certificate.upload` / `certificate.delete`
`{certificateId, eventId, userId}` — ids only. No file content, and no PII
beyond the existing userId-in-audit pattern used everywhere else.

### As built — dashboard (shipped)

No new role group: `MANAGE_EVENTS` is reused (same tier as certificates
list/upload/download/delete, registration list/reject, form management) —
pending approvals and org-wide activity are committee-facing data, so there
is no participant-facing variant of this endpoint.

| Route | Tier | Notes |
|---|---|---|
| `GET /organizations/:orgId/dashboard` | MANAGE_EVENTS | single aggregate endpoint returning all widgets in one payload |

Guard chain: `JwtAuthGuard → TenantGuard → RolesGuard`.

**KPI definitions** (`DashboardService.getSummary`, all `organizationId`-scoped
`count` queries):

- `activeMembers` — `Membership.count({ status: 'ACTIVE' })`.
- `totalEvents` — `Event.count({ status: { in: ['PUBLISHED', 'COMPLETED'] } })`
  — excludes `DRAFT`/`CANCELLED`.
- `activeRegistrations` — `Registration.count({ status: { in: ['APPROVED', 'WAITLISTED'] } })`
  — excludes `CANCELLED`/`REJECTED`.
- `certificatesIssued` — `Certificate.count({})`.

**"Pending approvals" maps to `WAITLISTED`, not a new gate:** the
`pendingApprovals` widget lists `Registration` rows with `status:
'WAITLISTED'`, ordered `createdAt asc` — the only registration state
actually awaiting committee action today (a committee member can `reject` a
waitlisted row to free a spot, or it auto-promotes when someone ahead
resolves). `RegistrationStatus.PENDING` remains unused elsewhere in the
codebase; this endpoint does not introduce a new approval state or gate.

**Fixed top-N widgets, no pagination (explicit scope decision):**
`upcomingEvents` (5), `pendingApprovals` (10), `recentRegistrations` (10),
`activityFeed` (15) are capped, ordered lists with no pagination — a
deliberate scope decision for a "Basic Dashboard" glance view, not an
oversight. A full paginated activity log is a separate, not-yet-built
roadmap item (Phase 1 item 10, Audit Logs).

**Field-selection discipline:** every widget query uses an explicit Prisma
`select` — never a raw spread of the full row — the same convention adopted
in the certificates fix above. `Registration` rows in particular carry
`answers` (participant's custom-form responses) and `consentRecordId`,
neither of which is selected.

**Audit:** none. This is a read-only aggregate endpoint; viewing the
dashboard is not logged, matching the existing precedent that `GET
/certificates` list is also unaudited.

### As built — audit logs (shipped)

No new role group: `MANAGE_MEMBERS` is reused (same tier as member management
— President, VP, Secretary, Treasurer, Event Director).

| Route | Tier | Notes |
|---|---|---|
| `GET /organizations/:orgId/audit-logs` | MANAGE_MEMBERS | single read-only query endpoint with filtering and offset pagination |

Guard chain: `JwtAuthGuard → TenantGuard → RolesGuard`.

**Query parameters and defaults** (`AuditService.list`):

- `page` (default `1`) — offset-based pagination; clamped to minimum 1.
- `pageSize` (default `25`) — clamped to maximum 100.
- `action` (optional) — filter by audit action name (e.g., `member.add`, `event.create`, etc.).
- `actorUserId` (optional) — filter by the actor's user ID.
- `from` (optional) — ISO 8601 date-time; filters `createdAt ≥ from` (400 if invalid).
- `to` (optional) — ISO 8601 date-time; filters `createdAt ≤ to` (400 if invalid).

**Response structure:** returns `{ data: AuditLog[], total: number, page: number, pageSize: number }`, where every log entry includes:
- `id`, `organizationId`, `actorUserId`, `action`, `targetType`, `targetId`, `createdAt`.
- **`metadata` is always included** in this response — unlike the dashboard's
  activity feed which excludes it — since this is the dedicated log viewer and
  every audited action in the codebase already follows the "ids-only" metadata
  convention (never personal data, only enum values and identifiers).
- `isBreakGlass` — schema-ready but always `false` today; reserved for the
  future `SuperAdmin` cross-tenant break-glass feature not yet implemented.

**Explicit deferral:** break-glass alerting and the `SuperAdmin` cross-tenant
access feature remain planned (Phase 2/3). Today, all logs are org-scoped and
`isBreakGlass` remains unused, consistent with the `User.mfaSecret` posture
for MFA (schema-ready, deferred until the MFA feature ships).

**Audit actions captured:** `member.add`, `member.status.change`,
`member.role.change`, `member.remove`, `event.create`, `event.update`,
`event.publish`, `event.complete`, `event.cancel`, `event.delete`,
`registration.create`, `registration.cancel`, `registration.reject`,
`registration.promote`, `form.upsert`, `form.delete`, `attendance.scan`,
`attendance.absent`, `certificate.upload`, `certificate.delete`.

---

## 3. Multi-Tenant Isolation

- Every tenant-owned row carries `organizationId`.
- Two enforcement layers: `TenantGuard` (request scope) + Prisma
  middleware/extension (query-level assertion — missing org filter throws).
- The middleware covers filtering reads (`findMany`/`findFirst`/`count`) but
  **not** `update`/`delete` — every mutation must therefore self-scope its
  `where` with `organizationId` (Prisma 5 extended unique where); a cross-org
  id surfaces as P2025 → 404. This is the established pattern in
  `MembershipsService`.
- **Mandatory automated tests:** org A must never read or write org B's data.
  Shipped: `tenant-isolation`, `memberships-isolation`, and `events-isolation`
  e2e suites cover wrong-org access (403) and id guessing through the
  attacker's own org (404) for memberships and events.
- SuperAdmin cross-tenant access allowed but **always** written to `AuditLog`
  with `isBreakGlass = true` and flagged for review.

---

## 4. File Security (Certificates & Uploads)

- **Private** S3-compatible buckets — no public read.
- Downloads via **short-lived signed URLs** (5 min) issued only after RBAC +
  ownership check.
- Uploads validated: MIME type, size, per-org storage quota.
- Encryption at rest (bucket-level) + in transit (HTTPS).

---

## 5. PDPA / Privacy-by-Design

| Principle | Implementation (Phase 1) |
|---|---|
| Consent | `ConsentRecord` with purpose + policy version + timestamp captured at registration |
| Data minimization | Collect only necessary personal fields; custom forms discouraged from over-collecting |
| Right to access | "Export my data" endpoint returns all personal data for the user |
| Right to erasure | "Delete/anonymize request" → soft delete + anonymization job |
| Retention | Configurable retention windows; scheduled purge jobs |
| Transparency | Privacy policy versioned; consent re-prompt on version change (Phase 2) |
| Security | Encryption at rest + transit, hashed passwords, secure sessions |

Personal data is never exposed across tenants and never returned in logs.

---

## 6. Audit Logging

Every sensitive action writes an `AuditLog` row: actor, action, target,
`organizationId`, timestamp, IP/device (optional). Covers login, role changes,
registration approval, certificate upload/download, data export/delete, and all
SuperAdmin cross-tenant access (break-glass).

---

## 7. Secure Coding Baseline

- Input validation via DTOs + Zod/class-validator on every endpoint.
- Parameterized queries via Prisma (no raw string SQL with user input).
- CORS locked to known frontend origins.
- Secrets via environment variables, never committed.
- Dependency and container scanning in CI.
- Principle of least privilege on all tokens, keys, and DB roles.
