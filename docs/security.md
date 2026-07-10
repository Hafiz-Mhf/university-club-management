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
| Approve registrations | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Scan QR / mark attendance | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Upload certificates | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View org analytics/dashboard | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Register for events | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Download own certificate | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View audit log | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

`Advisor` = read-only oversight across the org. `SuperAdmin`/`UniversityAdmin`
= platform admin (cross-tenant, break-glass logged).

---

## 3. Multi-Tenant Isolation

- Every tenant-owned row carries `organizationId`.
- Two enforcement layers: `TenantGuard` (request scope) + Prisma
  middleware/extension (query-level assertion — missing org filter throws).
- **Mandatory automated tests:** org A must never read or write org B's data.
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
