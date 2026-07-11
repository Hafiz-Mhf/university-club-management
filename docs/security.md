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
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

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
  Shipped: `tenant-isolation` + `memberships-isolation` e2e suites cover
  wrong-org access (403) and membership-id guessing through the attacker's own
  org (404).
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
