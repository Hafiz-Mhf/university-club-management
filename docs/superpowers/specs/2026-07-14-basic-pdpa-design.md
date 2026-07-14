# Basic PDPA — Design Spec

Roadmap Phase 1, item 11 (final Phase 1 item): consent capture, export my
data, delete/anonymize. Backend-only, same posture as every prior Phase 1
item.

## Goal

Give every user (participant or committee) their PDPA rights over their own
personal data: see what they consented to, export everything the platform
holds about them, and delete their account — while org-level records
(attendance counts, audit trail) stay statistically intact.

## What already exists

- `ConsentRecord` model (userId, purpose, policyVersion, grantedAt,
  ipAddress) — written at event registration with
  `purpose: 'event-registration'` (`registrations.service.ts`).
- `User.deletedAt` — checked at login only (`auth.service.ts:33`). No
  endpoint sets it.
- `StorageService.getSignedDownloadUrl(key, ttl)` and `deleteObject(key)`.
- No `pdpa` module. Signup records no consent.

## Architecture

New `backend/src/pdpa` module (controller / service), matching the module
list in CLAUDE.md. All routes are **user-level** — `JwtAuthGuard` only, no
`TenantGuard`/`RolesGuard`, no `:orgId`. First non-auth user-level routes
in the project. The signup-consent change lands in the existing `auth`
module.

| Route | Behavior |
|---|---|
| `GET /me/export` | Full personal-data JSON (all orgs) |
| `GET /me/consents` | All the user's ConsentRecords |
| `DELETE /me` | Immediate anonymize |

## Consent capture (auth module change)

`RegisterDto` gains a required `consent` field validated `@Equals(true)`
(class-validator) — signup without explicit consent → 400. `register()`
creates the ConsentRecord atomically via nested write:

```ts
this.prisma.user.create({
  data: {
    email, passwordHash, fullName,
    consentRecords: {
      create: { purpose: 'account', policyVersion: CURRENT_POLICY_VERSION },
    },
  },
});
```

`CURRENT_POLICY_VERSION` (currently a local `'v1'` const in
`registrations.service.ts`) moves to `backend/src/pdpa/policy-version.ts`
and is imported by both `registrations` and `auth`. No value change.

Existing e2e helpers that call register must pass `consent: true` — a
mechanical test update across suites.

## GET /me/consents

`consentRecord.findMany({ where: { userId }, orderBy: { grantedAt: 'desc' } })`,
select: id, purpose, policyVersion, grantedAt. `ipAddress` excluded from
the response (collected for audit evidence, not for display).
`ConsentRecord` is not in `TENANT_SCOPED_MODELS` — direct userId query is
fine.

## GET /me/export

Single JSON response:

```ts
{
  profile: { id, email, fullName, createdAt },
  memberships: [{ organizationName, role, status, studentId, faculty,
                  programme, intake, phone, joinedAt }],
  registrations: [{ eventTitle, organizationName, status, answers, createdAt }],
  attendance: [{ eventTitle, status, scannedAt }],
  consents: [{ purpose, policyVersion, grantedAt }],
  certificates: [{ eventTitle, fileSizeBytes, createdAt, downloadUrl }],
  exportedAt: string, // ISO timestamp
}
```

- `downloadUrl` = `getSignedDownloadUrl(storageKey, 300)` — same 300s TTL
  as the certificates module.
- **Tenant-middleware compliance:** the Prisma `$use` middleware throws on
  unscoped `findMany`/`count` against `TENANT_SCOPED_MODELS` (Membership,
  Registration, Attendance, Certificate). Export therefore reads
  everything through ONE top-level query on `User` (not tenant-scoped)
  with nested `include`s — nested relation loads inside a single
  `user.findUnique` do not fire separate middleware events. No middleware
  change, no bypass flag.

```ts
this.prisma.user.findUnique({
  where: { id: userId },
  include: {
    memberships: { include: { organization: { select: { name: true } } } },
    registrations: {
      include: {
        event: { select: { title: true, organization: { select: { name: true } } } },
        attendance: true,
      },
    },
    consentRecords: true,
    certificates: { include: { event: { select: { title: true } } } },
  },
});
```

Attendance hangs off Registration (`registration.attendance`), included
via the registrations include. Organization name for a registration comes
through its event's organization relation (shown above).

- Audited: `pdpa.export`, ids-only metadata, `organizationId: null`
  (user-level action, no org context).

## DELETE /me — immediate anonymize

**Sole-president guard first:** for each ACTIVE PRESIDENT membership of
the user, count other ACTIVE PRESIDENTs in that org. Any org where the
user is the only one → `409 Conflict` with the org names in the message
("Transfer presidency in <names> before deleting your account"). Role
transfer already exists (memberships module).

Then one `$transaction`:

1. **User**: `email → deleted-<uuid>@anonymized.invalid`,
   `fullName → 'Deleted User'`, `passwordHash →` argon2 hash of a random
   UUID (never disclosed), `mfaSecret → null`, `deletedAt → now()`.
2. **Memberships**: per row (`update` by unique `id` — `update` is not in
   the middleware's `SCOPED_ACTIONS`, exempt by design): `studentId`,
   `faculty`, `programme`, `intake`, `phone`, `committeeHistory` → null.
   `status`/`role` unchanged — `MemberStatus` has only ACTIVE/ALUMNI, no
   REMOVED; adding one is a schema change with UI/filter implications this
   item doesn't need. Rows stay so org counts stay valid.
3. **Registrations**: per row `update` by id: `answers → null` (free-text
   answers may hold PII). Status/rows stay.
4. **Attendance**: untouched (status + scannedAt only, no PII).
5. **ConsentRecords**: untouched — they are the compliance evidence that
   consent existed; PDPA requires keeping proof, not destroying it.
6. **Certificates**: `deleteObject(storageKey)` per file, then `delete` by
   id per row (personal documents, not org statistics). Storage deletes
   happen before the DB transaction commits is NOT possible atomically —
   order: DB transaction first (rows deleted), then best-effort storage
   deletes after commit; a failed storage delete logs a warning and does
   not fail the request (orphaned object, no DB pointer, private bucket).
7. **RefreshTokens**: `updateMany` set `revokedAt → now()` (RefreshToken
   is not tenant-scoped).
8. **Audit**: one `pdpa.delete` entry per org the user had a membership in
   (ids-only: userId, membershipId) + the response returns 204.

Outstanding access JWTs stay valid until expiry (≤15 min) — accepted;
refresh path is dead and login is blocked by `deletedAt`.

A second `DELETE /me` within the access-token window (user already has
`deletedAt` set, JWT still authenticates) hits a `deletedAt` early-return
in the service and responds 204 without touching anything.

## Errors

- `DELETE /me` sole-president → 409 with org names.
- Signup without `consent: true` → 400 (class-validator).
- Export/consents: no failure paths beyond 401.

## Audit

- `pdpa.export` — on every export.
- `pdpa.delete` — per-org entries on account deletion.
- Viewing `GET /me/consents` unaudited (read of own consent list, same
  precedent as other self-reads).

## Testing plan

**Unit:** none new (reads + straight-line transaction; e2e-layer
precedent).

**E2E** (`backend/test/pdpa.e2e-spec.ts`):

- Signup without consent → 400; with consent → ConsentRecord
  (purpose 'account', policyVersion 'v1') exists.
- `GET /me/consents` — account + event-registration entries after one
  registration; no `ipAddress` field in response.
- `GET /me/export` — all sections present; registration answers included;
  certificate entry carries `downloadUrl` that actually fetches the file;
  **isolation: a second user's data absent** (exact-match assertions, not
  "at least").
- `DELETE /me` sole-president → 409 naming the org; after role transfer →
  succeeds.
- Successful delete: 204; login now 401; user row anonymized (email not
  original, fullName 'Deleted User'); membership PII fields null;
  registration answers null; certificate row gone + storage object gone
  (signed URL fetch 404s); refresh token rejected; org's registration
  count for the event unchanged.
- Existing suites: register helper updated with `consent: true` — all
  previously green suites stay green.

## Out of scope

- Deletion request queue / grace period / scheduled jobs (user decision:
  immediate self-service anonymize).
- Consent withdrawal endpoint (withdrawing account consent ≡ deletion;
  event-consent withdrawal has no defined semantics yet).
- Consent-versioned re-prompt on policy change (explicit Phase 2+ roadmap
  item).
- ZIP export / file bundling — JSON with signed URLs only.
- Configurable data retention.
- SuperAdmin-driven deletion of other users.
- Frontend rendering.
