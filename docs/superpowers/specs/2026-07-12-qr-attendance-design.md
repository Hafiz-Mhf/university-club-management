# QR Attendance — Design Spec

Roadmap Phase 1, item 7. Backend-only (no frontend exists yet in this
project — same posture as auth/committee-rbac/events/registration).

## Goal

Track attendance for approved event registrations via a unique, single-use
QR token per participant. Committee/volunteers scan at the door to mark
`PRESENT`; committee can manually mark no-shows `ABSENT` after the event.

## Data model

New enum + model in `backend/prisma/schema.prisma`:

```prisma
enum AttendanceStatus {
  REGISTERED
  PRESENT
  ABSENT
}

model Attendance {
  id             String           @id @default(uuid())
  registrationId String           @unique
  registration   Registration     @relation(fields: [registrationId], references: [id])
  eventId        String
  organizationId String           // denormalized, tenant-scope pattern
  status         AttendanceStatus @default(REGISTERED)
  scannedAt      DateTime?
  scannedBy      String?          // committee/volunteer userId who scanned
  createdAt      DateTime         @default(now())

  @@index([organizationId])
  @@index([eventId, status])
}
```

`Attendance` is added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts`, same as
Membership/AuditLog/Event/Registration.

No `qrTokenHash` column. The token is **stateless**: no per-row secret is
stored, so there's no "regenerate my QR" capability this phase (explicit
scope decision — not requested, adds complexity for a capability nobody
asked for).

## Token design

```
token = base64url(attendanceId + "." + HMAC-SHA256(attendanceId, ATTENDANCE_TOKEN_SECRET))
```

- New env var `ATTENDANCE_TOKEN_SECRET` — dedicated secret, independently
  rotatable from the JWT signing secret.
- Verification: split on `.`, recompute the HMAC over the id, compare with
  `crypto.timingSafeEqual`. Malformed or mismatched signature → `400`,
  without revealing whether the id exists.
- Single-use is enforced by the **status CAS**, not by token storage: the
  first successful scan flips `REGISTERED → PRESENT`; a second scan of the
  same (still-valid) token hits the CAS `where: {status: 'REGISTERED'}` and
  gets `P2025 → 409`, matching the existing CAS-then-409 idiom used
  throughout events/registrations.

## Lifecycle: creation and deletion tied to Registration transitions

Attendance rows are created/deleted **inside the existing Registration
service transactions** — not via a separate event/listener mechanism — to
stay atomic with the codebase's established pattern (capacity lock,
promote-loop, audit, all in-tx):

- `RegistrationsService.register()`: when a registration lands `APPROVED`
  (capacity available), calls
  `attendanceService.createForRegistration(tx, {registrationId, eventId, organizationId})`
  before the transaction commits.
- `resolve()`'s waitlist promote-loop: when a `WAITLISTED` row is promoted
  to `APPROVED`, same call.
- `resolve()` (cancel/reject): after the caller's own CAS succeeds, deletes
  any existing `Attendance` row for that registration (org-scoped) in the
  same transaction. A cancelled/rejected participant's QR immediately stops
  verifying (`404` on scan — the row is gone).

`AttendanceModule` exports `AttendanceService`; `RegistrationsModule` imports
it (one-directional dependency, no cycle).

## Endpoints & RBAC

New role group in `backend/src/rbac/role-groups.ts`:

```ts
export const MANAGE_ATTENDANCE: Role[] = [...MANAGE_EVENTS, 'VOLUNTEER'];
```

(`VOLUNTEER` exists in the `Role` enum but was in no group until now —
first feature that grants it any capability.)

| Route | Guard | Behavior |
|---|---|---|
| `GET /organizations/:orgId/events/:eventId/attendance/me` | `TenantGuard` only (any org member) | Caller's own row via `Registration.userId` join. `404` if none: never registered, still `WAITLISTED` (no row yet), or cancelled/rejected (row deleted). |
| `GET /organizations/:orgId/events/:eventId/attendance` | `MANAGE_ATTENDANCE` | Full org+event-scoped list. |
| `POST /organizations/:orgId/events/:eventId/attendance/scan` `{ token }` | `MANAGE_ATTENDANCE` | Verify → org+event-scoped lookup by parsed id → CAS `REGISTERED→PRESENT`, sets `scannedAt`/`scannedBy = req.user.id`. |
| `POST /organizations/:orgId/events/:eventId/attendance/:attendanceId/absent` | `MANAGE_ATTENDANCE` | CAS `REGISTERED→ABSENT` only — marking absent someone already scanned `PRESENT` is a `409`, not a silent overwrite. |

`/me` mirrors the existing `registrations/me` pattern (TenantGuard only,
ownership implicit via `userId` filter — no separate ownership check
needed since the query itself is scoped to the caller).

## Error handling

- Scan: malformed/tampered token → `400`; wrong org/event or unknown id →
  `404` (no existence leak); already `PRESENT`/`ABSENT` → `409`.
- Mark-absent: wrong org/event → `404`; already `PRESENT` → `409` (CAS only
  fires from `REGISTERED`).
- `GET /me`: no row → `404`.

## Audit

- `attendance.scan {attendanceId, eventId}` and
  `attendance.absent {attendanceId, eventId}` — ids/enums only. Actor is
  `scannedBy` (the committee/volunteer's own id, not participant PII).
  Recorded inside the same transaction as the CAS update.
- Attendance row **creation** (on approve/promote) is not separately
  audited — it's a system side effect already covered by the existing
  `registration.create` / `registration.promote` audit entries.
- The raw token is never logged anywhere (PDPA: never log sensitive
  tokens/personal data).

## Testing plan

**Unit:**
- Token sign/verify roundtrip: valid token verifies; tampered signature or
  id rejected; malformed string rejected.
- `tenant-scope.middleware.spec.ts`: add `Attendance` to
  `TENANT_SCOPED_MODELS`, same 3-case pattern as Registration (unscoped
  throws, scoped-but-missing-orgId throws, properly scoped passes).

**E2E:**
- Attendance auto-created on `register()` direct-APPROVED path.
- Attendance auto-created on waitlist promote path.
- Attendance deleted on cancel; deleted on reject.
- `GET /attendance/me`: owner gets token; non-registrant `404`; waitlisted
  participant `404` (no row yet).
- Scan: happy path → `200` + `PRESENT`; re-scan same token → `409`;
  tampered token → `400`; wrong org/event → `404`; cancelled registration's
  stale token → `404` (row already deleted).
- Mark-absent: happy path `REGISTERED→ABSENT`; already-`PRESENT` → `409`;
  wrong org → `404`.
- Isolation: org A committee/volunteer cannot scan or list org B's event
  attendance (`403` via `TenantGuard`); id-guessing (A's org + B's
  eventId) → `404`, no cross-org data leak.

## Docs to sync (final task of the implementation plan)

- `docs/database.md`: correct the existing `Attendance` stub — drop
  `qrTokenHash` column, note the stateless HMAC token design instead, mark
  `(shipped)`.
- `docs/security.md`: add `MANAGE_ATTENDANCE` role group + the endpoint
  table above, matching the "As built" section style used for events and
  registration.

## Out of scope this phase

- QR image rendering (frontend's job later — this ships the raw token
  string only).
- Token regeneration/revocation independent of status.
- Automatic post-event sweep to mark no-shows absent (manual mark-absent
  endpoint only).
- Un-marking `ABSENT` back to `REGISTERED`, or `PRESENT` back to anything
  (no reversal endpoints this phase).
