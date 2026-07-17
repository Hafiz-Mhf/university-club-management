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

- `page` (default `1`) — offset-based pagination; clamped to [1, ∞).
- `pageSize` (default `25`) — clamped to [1, 100].
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
- **Excluded:** `ipAddress` and `userAgent` (dead schema columns, never
  populated by `AuditService.record()`, following the "never log personal data"
  rule).

Results are ordered by `createdAt DESC` (newest first).

**Audit:** none. This is a read-only query endpoint; viewing the audit log is
not itself logged, matching the existing precedent that the dashboard list is
also unaudited.

**Explicit deferral:** break-glass alerting and the `SuperAdmin` cross-tenant
access feature remain planned (Phase 2/3). Today, all logs are org-scoped and
`isBreakGlass` remains unused, consistent with the `User.mfaSecret` posture
for MFA (schema-ready, deferred until the MFA feature ships).

**Audit actions captured:** `organization.profile.update`,
`organization.settings.update`, `member.add`, `member.status.change`,
`member.role.change`, `member.remove`, `event.create`, `event.update`,
`event.publish`, `event.complete`, `event.cancel`, `event.delete`,
`registration.create`, `registration.cancel`, `registration.reject`,
`registration.promote`, `form.upsert`, `form.delete`, `attendance.scan`,
`attendance.absent`, `certificate.upload`, `certificate.delete`, `pdpa.export`,
`pdpa.delete`.

### As built — PDPA (shipped)

**Signup consent capture:** Every user must explicitly grant consent (`RegisterDto.consent @Equals(true)`) at signup — missing or `false` → 400. The consent is recorded atomically in the same transaction as user creation: a `ConsentRecord { purpose: 'account', policyVersion: CURRENT_POLICY_VERSION }` is written via nested create (`AuthService.register`). **`ipAddress` is not captured for this record** — it is left null. `ipAddress` is only ever captured for `purpose: 'event-registration'` consent, recorded separately in `RegistrationsService` at the time of event signup. The policy version is single-sourced in `backend/src/pdpa/policy-version.ts` (currently `'v1'`) and reused for all consent types (account + event-registration).

**User-level PDPA routes (first cross-org routes):** Three routes rooted at `@Controller('me')` with `JwtAuthGuard` only — no `TenantGuard` or `RolesGuard`, intentionally positioning these as user-level, cross-org operations:

- `GET /me/consents` — list the user's ConsentRecords (purpose, policyVersion, grantedAt; `ipAddress` excluded from response).
- `GET /me/export` — retrieve all personal data via a single `user.findUnique` include tree (User is not tenant-scoped; the per-model middleware assertions don't fire on nested includes).
- `DELETE /me` — anonymize and soft-delete the account.

**Tenant-scope middleware exemption — read and write sides:** `GET /me/export`'s bypass is the `findUnique` case above. The `DELETE /me` anonymize transaction bypasses the same guard for a different reason: `Membership`, `Registration`, and `Certificate` *are* listed in `TENANT_SCOPED_MODELS` (`backend/src/prisma/tenant-scope.middleware.ts`), but `deleteAccount` never issues a filtering query against them — it writes per-row via `tx.membership.update({ where: { id } })`, `tx.registration.update({ where: { id } })`, and `tx.certificate.delete({ where: { id } })`, keyed by each row's own unique id (already scoped to the requesting user's own rows by construction). The middleware's `SCOPED_ACTIONS` set only gates `findFirst`/`findFirstOrThrow`/`findMany`/`updateMany`/`deleteMany`/`count`/`aggregate`/`groupBy` — unique-id `update`/`delete` are exempt by design, since they can't leak across an unrelated organizationId filter.

**Export:** returns all sections: profile (id, email, fullName, createdAt), memberships (incl. organization names), registrations (incl. event titles, organization names, and answers), attendance records, consents (excl. ipAddress), and certificates with 300-second signed download URLs. Audited as a single `pdpa.export` action (targetType `User`, `organizationId: null`) — the latter is deliberate: export is a user-level operation crossing orgs. However, **this audit row is not visible through any current API or endpoint** — `AuditService.list()` always filters by a specific `organizationId` supplied by the caller (there is no superadmin/global log viewer yet), so a null-organizationId row can never match any org's list query. Today the only way to see it is direct database inspection.

**Deletion (anonymization transaction):** atomic three-stage process:

1. **Sole-president guard:** if the user is an ACTIVE PRESIDENT in any org with no other ACTIVE PRESIDENT, the delete fails 409 with "Transfer presidency in [org names]…" — ensures no org is left headless.
2. **Anonymize transaction (compare-and-swap via `deletedAt: null` condition):** a single `$transaction` atomically:
   - User: email → `deleted-<uuid>@anonymized.invalid`, fullName → 'Deleted User', passwordHash → random argon2 hash, mfaSecret → null, deletedAt → now.
   - Memberships: studentId, faculty, programme, intake, phone nulled; committeeHistory → `DbNull`; row, role, status retained (org statistics).
   - Registrations: answers → `DbNull`; row retained (org statistics).
   - Certificates: hard-deleted from DB.
   - Refresh tokens: all active tokens revoked (revokedAt updated).
   - Per-org audit: for each membership, `pdpa.delete` action recorded (targetType `Membership`, targetId = membership id, organizationId = org id).
   - Idempotency has two layers, guarding two different races: (a) **sequential** — a second `DELETE /me` call after the first has already committed hits the pre-transaction `if (!user || user.deletedAt) return` guard in `PdpaService.deleteAccount` and no-ops immediately; (b) **concurrent** — two in-flight requests racing on the same user are resolved inside the transaction by the `tx.user.updateMany({ where: { id: userId, deletedAt: null } })` compare-and-swap: only one call's `updateMany` can match the row (`count === 1`), the other sees `count === 0` and returns without redoing the anonymization work.
3. **Storage cleanup (post-commit, best-effort):** certificate objects in S3-compatible storage are deleted asynchronously; failure is logged but does not fail the request (orphaned object in a private bucket).

**Consent records & attendance untouched:** ConsentRecords and Attendance rows are not deleted or anonymized — they are compliance evidence and must survive the account deletion.

**Outstanding access tokens:** valid only until their TTL expires; login and refresh are both blocked (deleted users cannot authenticate). The `user.deletedAt` check in the login flow prevents reactivation.

---

### As built — analytics (shipped)

**Five read endpoints**, all under `GET /organizations/:orgId/analytics/*`: `overview`, `trends`, `demographics`, `certificates`, `committee-activity`. Every route is gated `JwtAuthGuard → TenantGuard → RolesGuard`, `@Roles(...MANAGE_EVENTS)` — the same tier as the existing Dashboard endpoint (President, Vice President, Secretary, Treasurer, Event Director, Committee). No new permission tier introduced.

**Attendance rate** (`overview`): `PRESENT / (PRESENT + ABSENT)` across all `Attendance` rows in the org, all-time. Rows still `REGISTERED` (event not yet resolved) are excluded from both numerator and denominator. `null` (not `0` or `NaN`) when there are zero resolved rows.

**`days` query parameter** (`trends`, `committee-activity`): optional, defaults to `30`. Non-numeric or non-positive values silently default to `30` — never `400`s, since this is a reporting window, not a security-sensitive filter. Clamped to `[1, 365]` to bound query cost.

**Demographics** returns aggregate counts only — `groupBy` on `Membership.faculty`/`Membership.programme` for `ACTIVE` memberships, never a member list and never any identifying field (userId, fullName) alongside the faculty/programme breakdown. This combination is demographic/PII-adjacent data; exposing it only as counts is the least-exposure design.

**Committee activity** groups `AuditLog` rows in the window by `actorUserId`, joined to that actor's *current* `Membership` in the org for `fullName`/`role` display. An actor who has since left the org (no current Membership row) is excluded entirely — dropped, not shown with placeholder data. A member with zero audit actions in the window simply doesn't appear (not zero-filled, unlike the daily trend buckets).

**`CertificateDownload` tracking:** a row is written on every signed-URL issuance — both `CertificatesService.findMine` (participant self-download) and `download` (committee download-by-id, now carrying `actorUserId` from `@CurrentUser`). The write is best-effort: wrapped in its own try/catch, logged on failure, and never blocks the download response — by the time it runs, a valid signed URL has already been minted and is about to be returned.

**No new audit action.** All five reads are unaudited, matching the existing `GET /dashboard` and audit-logs-list precedent. The `CertificateDownload` insert is a metrics row, not an audit entry — downloading a certificate is already implicitly covered by the existing `certificate.upload`/`certificate.delete` audit actions on the write side.

---

### As built — file repository (shipped)

Four routes under `/organizations/:orgId/files*`: `POST` upload, `GET` list, `GET /:fileId/download`, `DELETE /:fileId`. Upload and delete are gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` — same tier as Certificates/Events. List and download are gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member of the org, any role, can view and download.

**Validation:** allowed MIME types are PDF, DOCX, XLSX, PPTX, PNG, JPEG — anything else is `400`. Max file size 20MB. Storage quota is shared with Certificates: every upload sums `Certificate.fileSizeBytes` and `OrgFile.fileSizeBytes` against `Organization.storageQuotaMb` before writing; exceeding it is `400`.

**No download tracking** for org files (unlike `CertificateDownload`) — out of scope this phase.

**Audit:** two new actions, `file.upload` and `file.delete` (`targetType: 'OrgFile'`). Reads (list, download) are unaudited, matching the Dashboard/Analytics precedent.

**No per-category access control** — `category` is a display/filter tag only, not a permission boundary.

---

### As built — meeting minutes (shipped)

Five routes under `/organizations/:orgId/minutes*`: `POST` create, `GET` list, `GET /:minutesId`, `PATCH /:minutesId`, `DELETE /:minutesId`. Create/edit/delete are gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` — same tier as Events/Files. List/get-one are gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member, any role.

`attendeeMembershipIds` is validated on every create/update against real `Membership` rows in the target org — an unknown or foreign-org id is rejected with `400`, never silently accepted. Standalone, org-level records — no relation to `Event`.

**Action items are plain text** (`task` + optional `owner`) with no status field — this is a record, not a task tracker.

**List is paginated** (`page`/`pageSize`, default 25/max 100 — same convention as `AuditService.list`), sorted `meetingDate desc`.

**Audit:** three new actions, `minutes.create`, `minutes.update`, `minutes.delete` (`targetType: 'MeetingMinutes'`) — matches `event.create`/`event.update`/`event.delete`'s shape. Reads (list, get-one) are unaudited.

---

### As built — asset management (shipped)

Five routes under `/organizations/:orgId/assets*`: `POST` create, `GET` list, `GET /:assetId`, `PATCH /:assetId`, `DELETE /:assetId`. Create/edit/delete are gated `JwtAuthGuard → TenantGuard → RolesGuard`, `MANAGE_EVENTS` — same tier as Files/Minutes. List/get-one are gated `JwtAuthGuard → TenantGuard` only — any ACTIVE member, any role.

Quantity-per-type inventory, not individual-unit tracking. `condition` defaults `GOOD` if omitted at creation.

**List is unpaginated** — a bounded inventory (dozens of asset types), unlike the paginated Meeting Minutes archive.

**No checkout/return tracking, no purchase/cost fields** — out of scope this phase (cost tracking deferred to a future budget-management item).

**Audit:** three new actions, `asset.create`, `asset.update`, `asset.delete` (`targetType: 'Asset'`) — matches `event.create`/`event.update`/`event.delete`'s shape. Reads (list, get-one) are unaudited.

---

### As built — public club page (shipped)

Gallery: `POST`/`GET`/`DELETE /organizations/:orgId/gallery*`. Upload/delete `MANAGE_EVENTS`; list any ACTIVE member, list response embeds a signed `downloadUrl` per photo (10MB cap, PNG/JPEG only, quota summed across `Certificate` + `OrgFile` + `GalleryPhoto`).

Achievements: full CRUD under `/organizations/:orgId/achievements*`, same RBAC/audit shape as Asset Management.

**Public routes — the first unauthenticated surface in this codebase:** `GET /public/organizations/:orgId/profile`, `/gallery`, `/achievements`. No `JwtAuthGuard`, no `TenantGuard`, no `RolesGuard` — anyone can call these with no credentials at all. Each explicitly checks the org exists (`404` if not) since there's no guard to do that implicitly. The profile response is a fixed field allowlist — `name`, `description`, `logoUrl` (signed, if `logoKey` is set), `primaryColor`, `socialLinks`, `advisors`, `upcomingEvents` (published + future only) — and never includes `storageQuotaMb`, `settings`, or any other `Organization` column.

Public reads are unaudited (no authenticated actor to attribute them to).

Anonymous event registration remains out of scope — the public profile only surfaces event *links* (id/title/dates); registering still requires signup/login.

---

### As built — email notifications (shipped)

No new endpoints — purely internal side effects of existing actions, via a new `NotificationsModule` (`backend/src/notifications/`) and a BullMQ queue (`notifications`) backed by the `redis` container (first feature to actually use it).

Six triggers, one email each: `RegistrationsService.register()` resolving to `APPROVED` or `WAITLISTED` (registrant), `RegistrationsService.reject()` (registrant), the waitlist auto-promotion cascade inside `resolve()` (promoted registrant), every new registration (fan-out — one email per `MANAGE_EVENTS`-tier ACTIVE org member, for visibility, not a required approval step), and a delayed `event.reminder` job scheduled 24h before `Event.startAt` on `publish()`, rescheduled on `update()` when `startAt` changes, and cancelled on `cancel()`/`complete()` (deterministic job id `` `reminder-<eventId>` `` — not `reminder:<eventId>` as originally specced; BullMQ rejects `:` in custom job ids).

Plain-text templates only (`notifications/templates.ts`), sent via `nodemailer` (`MailerService`) against a `mailpit` dev container (SMTP `:1025`, web UI `:8025`) — no HTML, no opt-out (all six triggers are transactional, not marketing).

**Audit:** one new action, `notification.email` (`targetType: 'Registration'`, metadata `{ kind }` only — never the recipient's email address or message body, per the "never log personal data" rule). Written by the queue worker only on successful send; failed sends retry via BullMQ defaults and are logged (not audited). These actor-less rows are excluded from the Basic Dashboard's capped `activityFeed` (they'd crowd out actor activity there) but remain fully queryable via `GET /organizations/:orgId/audit-logs`.

No new Prisma models. `TENANT_SCOPED_MODELS` unchanged.

---

### As built — certificate generator (shipped)

No new endpoints — an internal side effect of `EventsService.complete()`, via a second BullMQ queue (`certificates`, alongside `notifications`) and a new `generation/` subfolder in the existing `backend/src/certificates/` module.

On `complete()`, one `certificate.generate` job is enqueued per `PRESENT` attendee who doesn't already have a `Certificate` row (same eligibility rule Phase 1's manual upload already enforces). Each job renders a landscape PDF via `pdf-lib` (`CertificatePdfService` — participant name, event title, event date, org name/logo/`primaryColor`, no verification code, no signature line), stores it at the exact key manual upload already uses (`certificates/<orgId>/<eventId>/<userId>.pdf`), and creates the same `Certificate` row shape Phase 1 creates (`uploadedByUserId` = the actor who called `complete()`). A `Certificate` row created first by either path (generate or manual upload) wins — the other is a no-op, enforced by `@@unique([eventId, userId])` plus a race-guard existence check inside the processor.

Storage quota exceeded during generation: logged and skipped (no `Certificate` row, no audit row) — not thrown, since there's no HTTP response to throw into inside a background job and BullMQ's retry wouldn't help (quota doesn't change on retry).

**Email Notifications extension:** one more job kind, `certificate.ready`, fired from both the new generation processor and the existing manual `upload()` path — participants get notified regardless of how their certificate was created. Reuses the exact same `notification.email` audit action; this is the first `notification.email` kind whose `targetType` is `Certificate` rather than `Registration`.

**Audit:** one new action, `certificate.generate` — same shape as `certificate.upload` (`targetType: 'Certificate'`, metadata `{ certificateId, eventId, userId }`).

No new Prisma models or columns. `TENANT_SCOPED_MODELS` unchanged.

---

### As built — branding & themes (shipped)

New endpoints on `OrganizationsController`: `POST`/`DELETE .../logo` and `.../banner` (multipart upload, PNG/JPEG/WebP, ≤2MB, `PRESIDENT`/`VICE_PRESIDENT`), plus `secondaryColor` added to `PATCH .../settings` (`PRESIDENT` only, unchanged from `primaryColor`'s existing gate).

Two new nullable `Organization` columns, `bannerKey` and `secondaryColor` (default `#1e293b`). Logo/banner are single overwritable slots at a deterministic key (`branding/<orgId>/<kind>.<ext>`) — re-uploading with a different image format deletes the old object after the new one is confirmed written (never the reverse, so a failed upload never leaves the org logo-less). They do **not** join the shared storage-quota aggregate (`Certificate`/`OrgFile`/`GalleryPhoto`'s `SUM(fileSizeBytes)`) — a flat 2MB per-upload cap is enough for a non-accumulating single-image field, so `files.service.ts`/`certificates.service.ts`/`gallery.service.ts` are unchanged.

`OrganizationsService.findOne()` now resolves `logoKey`/`bannerKey` to signed `logoUrl`/`bannerUrl` (5-minute TTL, matching every other signed-URL precedent) instead of returning raw storage keys — the authenticated org view and the public club page (`public.service.ts getProfile()`, which also gained `bannerUrl`) now behave identically. `logoKey` was removed from the raw `PATCH /organizations/:orgId` body entirely — upload is the only way to set it, closing off a client pointing it at an arbitrary/unvalidated storage key.

**Audit:** four new actions — `organization.logo.upload`, `organization.logo.delete`, `organization.banner.upload`, `organization.banner.delete` — same shape as every other mutation (`targetType: 'Organization'`, metadata `{ key }`, no personal data). A delete on an already-absent key is a no-op: no storage call, no audit row.

---

### As built — event feedback + NPS (shipped)

New `backend/src/feedback/` module at `organizations/:orgId/events/:eventId/feedback`. `POST /` (submit) and `GET /me` are eligibility-gated in the service, not role-gated — any member can submit if they were marked `PRESENT` for the event, within 14 days of `Event.endAt`; a duplicate submission (`@@unique([eventId, userId])`) 409s. `GET /summary` is `MANAGE_EVENTS`-gated and returns aggregates only (avg NPS, avg of each 1–5 rating, response count, a bare comment list) — **never `userId` or any submitter identity**, so committee-visible feedback can't be attributed to a person even though the row itself tracks the submitter for eligibility/gating purposes.

**Certificate release gating:** a new per-event opt-in, `Event.requireFeedbackForCertificate` (default `false`, editable only while `DRAFT`/`PUBLISHED` — same edit-lock every other event field already has). When on, `EventsService.complete()` no longer certs every `PRESENT` attendee unconditionally: `CertificateGenerationService.enqueueBatchForEvent()` gained an `onlyWithFeedback` filter, and `complete()` also schedules a delayed BullMQ job (existing `certificates` queue, job id `feedback-window-close-<eventId>`, hyphen separator — BullMQ rejects `:` in custom job ids, same reason `notifications.types.ts` uses one) that, 14 days later, issues certificates to whoever's still missing one regardless of feedback. Every feedback submission against an already-`COMPLETED` gated event re-runs the gated batch check immediately, so a person isn't forced to wait for the 14-day fallback once they submit. Non-gated events are byte-for-byte unchanged — the existing Certificate Generator e2e suite passes untouched.

**Analytics extension:** two new `MANAGE_EVENTS`-gated endpoints on the existing `AnalyticsController` — `GET /analytics/feedback` (per-event NPS/rating averages) and `GET /analytics/feedback-trends?days=` (org-wide day-bucketed trend, same `dayRange`/`windowStart` zero-fill pattern as `getTrends`/`getCommitteeActivity`).

**Audit:** one new action, `feedback.submit` (`targetType: 'FeedbackResponse'`, actor = submitting member). Reads (`/me`, `/summary`, both analytics endpoints) are never audited, per established pattern.

New model: `FeedbackResponse`, added to `TENANT_SCOPED_MODELS`. New column: `Event.requireFeedbackForCertificate`. See `docs/database.md` for the full schema.

---

### As built — committee handover pack (shipped)

New `backend/src/handover/` module, one endpoint: `GET /organizations/:orgId/handover` (`MANAGE_EVENTS`). Generates a multi-page PDF on demand and streams it back (`StreamableFile`, `Content-Type: application/pdf`) — nothing is persisted, no new Prisma model or column, no storage-quota interaction.

`HandoverService` aggregates five sections with direct Prisma queries scoped to `organizationId` — same cross-cutting-read pattern `AnalyticsService` already uses (no other feature module imported): every `ACTIVE` `Membership` (name, current role, and the `committeeHistory` JSON array already written by `MembershipsService.changeRole` — this is the first *reader* of that field), the 10 most recent `MeetingMinutes` by `meetingDate desc`, every `Asset`, `OrgFile` rows where `category` is `SOP` or `REPORT` (titles/filenames only, not the file contents), and `PUBLISHED` events with `startAt >= now`. `HandoverPdfService` (plain pdf-lib injectable, no Prisma dependency, same testability rationale as `CertificatePdfService`) renders one heading + line-listing per section, page-breaking when a section overflows; an empty section renders "None" rather than being silently skipped.

**Audit:** one new action, `handover.generate` (`targetType: 'Organization'`, no personal data). This is a deliberate exception to "reads are never audited" — a full-org data export (committee roster + asset inventory + file manifest in one response) is a meaningfully different event from a normal list/detail read.

No new Prisma models or columns. `TENANT_SCOPED_MODELS` unchanged.

---

### As built — consent-versioned re-prompt (shipped)

The tenth and final Phase 2 roadmap item. No new endpoint on its own module —
enforcement lives in `JwtAuthGuard` (`backend/src/auth/guards/jwt-auth.guard.ts`),
which already sits on every authenticated route in the codebase. Its
overridden `canActivate()` runs Passport's JWT check first, then — unless the
route carries the new `@SkipConsentCheck()` metadata (`Reflector`-based, same
mechanism `RolesGuard` already uses for `@Roles()`) — looks up the caller's
most recent `ConsentRecord{purpose: 'account'}` via the shared
`isAccountConsentStale(prisma, userId)` helper (`backend/src/pdpa/consent-status.util.ts`).
A version mismatch, or no record at all, is a hard `403`. `PdpaController`
carries `@SkipConsentCheck()` at the class level — a user who won't accept the
new policy can still view consent history, export their data, or delete their
account; they are never fully locked out.

**Cure endpoint:** `POST /me/consent` (also `@SkipConsentCheck()`, same
controller) inserts a fresh `ConsentRecord{purpose: 'account', policyVersion:
CURRENT_POLICY_VERSION, ipAddress: req.ip}` — the stale row is left in place as
history, never mutated. Returns the same `{id, purpose, policyVersion,
grantedAt}` shape `GET /me/consents` already uses.

**Proactive signal:** `AuthService.issueTokens()` (shared by `login()` and
`refresh()`) calls the same `isAccountConsentStale` helper and adds
`consentStale: boolean` to both responses, so the frontend can route to a
re-consent screen without waiting for a request to 403 first.

**Audit:** one new action, `pdpa.consent.renew` (`targetType: 'User'`,
`organizationId: null` — same cross-org shape as `pdpa.export`/`pdpa.delete`).
The staleness check itself (every blocked/allowed request) is not audited —
matching the existing "reads/guard checks are not separately logged" pattern;
only the mutation that cures staleness is.

No new Prisma model or column — `ConsentRecord` already carried everything
needed. `ConsentRecord` remains outside `TENANT_SCOPED_MODELS` (user-scoped,
not org-scoped, unchanged from every other feature that has touched it).

With this item shipped, no Phase 2 items remain on `docs/roadmap.md`.

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
| Transparency | Privacy policy versioned; consent re-prompt on version change (shipped — `JwtAuthGuard`-enforced, see §2 "consent-versioned re-prompt") |
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
