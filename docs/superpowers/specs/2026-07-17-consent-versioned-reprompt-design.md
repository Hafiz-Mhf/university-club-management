# Consent-Versioned Re-Prompt — Design

Phase 2 item, last one on the roadmap (`docs/roadmap.md`): "Consent-versioned
re-prompt — re-collect consent on policy change." This is the feature
`backend/src/pdpa/policy-version.ts` was already written for — its existing
comment reads: "Bump when the policy text changes (re-prompt is a Phase 2+
roadmap item)." `CURRENT_POLICY_VERSION` is already stamped onto a
`ConsentRecord{purpose: 'account'}` at registration
(`backend/src/auth/auth.service.ts:32`); this feature is what happens when
that constant is bumped and existing users' stored version goes stale.

**In:** a hard-enforced re-consent gate — any authenticated request from a
user whose account consent doesn't match the current policy version is
blocked until they explicitly re-consent, except for a small, deliberate
exempt set of PDPA routes.

**Out (deferred, do not build):** frontend (backend-only, consistent with
every other Phase 2 item shipped so far), versioning the `event-registration`
consent purpose (that one is a historical snapshot tied to a specific
`Registration`, never "renewed" — only the persistent `account` consent gets
re-prompted), an admin UI/endpoint for bumping `CURRENT_POLICY_VERSION` or
authoring policy text (out of scope — that constant is still hand-edited in
source, same as today), any new Prisma model or column.

---

## Architecture

**Enforcement point:** `JwtAuthGuard` (`backend/src/auth/guards/jwt-auth.guard.ts`
— currently a bare `export class JwtAuthGuard extends AuthGuard('jwt') {}`,
already the one guard applied on every authenticated controller in this
codebase) gains an overridden `canActivate(context)`:

1. Call `super.canActivate(context)` first — Passport verifies the JWT and
   populates `req.user`. If that returns falsy, propagate as before.
2. Read metadata via `Reflector.getAllAndOverride` for a new
   `@SkipConsentCheck()` decorator on the handler/class — same mechanism
   `RolesGuard` already uses for `@Roles()`. If present, return `true`
   immediately (skip the check).
3. Otherwise, look up the user's most recent
   `ConsentRecord{userId, purpose: 'account'}` ordered by `grantedAt desc`.
   If its `policyVersion !== CURRENT_POLICY_VERSION`, or no such record
   exists at all (shouldn't happen for a live user — `register()` always
   creates one, and `login()` already rejects `deletedAt` users — but a
   security-relevant check defaults to blocking, not allowing, on an
   unexpected empty result), throw `ForbiddenException`.

This touches one file (`JwtAuthGuard`) instead of adding a check to every
controller. `JwtAuthGuard` can inject `PrismaService` (already `@Global()`)
and Nest's `Reflector` (a core provider, resolvable from any module) without
any new module wiring.

**`@SkipConsentCheck()` decorator:** `backend/src/auth/decorators/skip-consent-check.decorator.ts`,
a `SetMetadata`-based marker, structurally identical to `@Roles()`.

**Exempt routes:** `PdpaController` (`@Controller('me')`) gets class-level
`@SkipConsentCheck()` — every route under it (`GET /me/consents`,
`GET /me/export`, `DELETE /me`, and the new `POST /me/consent` below) stays
reachable regardless of consent staleness. A user who doesn't want to accept
the new policy can still see their consent history, export their data, or
delete their account and leave — never trapped into "accept or nothing."

**Proactive signal:** `AuthService.issueTokens()` (private method shared by
both `login()` and `refresh()` — see
`backend/src/auth/auth.service.ts:47,44,81`) gains the same staleness check
inline, adding `consentStale: boolean` to the object both public methods
already return alongside `accessToken`/`refreshToken`. This lets the
frontend route straight to a re-consent screen instead of discovering
staleness via a failed request on the next call.

---

## Data

No new Prisma model or column. `ConsentRecord` already carries everything
needed:

```prisma
model ConsentRecord {
  id            String        @id @default(uuid())
  userId        String
  purpose       String
  policyVersion String
  grantedAt     DateTime      @default(now())
  ipAddress     String?
  user          User          @relation(fields: [userId], references: [id])
  registration  Registration?
}
```

Re-consenting simply inserts a new row with `purpose: 'account'` and the
current `policyVersion` — the old stale row is left in place as history
(mirrors how `MembershipsService.changeRole` appends to `committeeHistory`
rather than mutating the past away). `ConsentRecord` is user-scoped, not
org-scoped — it was never in `TENANT_SCOPED_MODELS` and stays that way.

---

## Endpoint, RBAC, audit, testing

**Endpoint:** `POST /me/consent` on the existing `PdpaController`. No
request body. Captures `req.ip` the same way
`RegistrationsController.register()` already does (`@Req() req: Request`,
pass `req.ip` through). Creates
`ConsentRecord{userId, purpose: 'account', policyVersion: CURRENT_POLICY_VERSION, ipAddress}`
and returns `{id, purpose, policyVersion, grantedAt}` — the same item shape
`GET /me/consents` already returns.

**RBAC:** none beyond `JwtAuthGuard` — identical to every other route on
`PdpaController` (cross-org by design, no `TenantGuard`/`RolesGuard`).

**Audit:** new action `pdpa.consent.renew` (`targetType: 'User'`,
`targetId: userId`, no metadata beyond the standard shape). This is a
mutation, so it's audited under the ordinary rule — not the deliberate
read-exception Committee Handover Pack introduced.

**Testing:**
- A freshly registered user (whose `account` consent already matches
  `CURRENT_POLICY_VERSION`) is never blocked by any authenticated route.
- Directly backdating a user's `ConsentRecord.policyVersion` via Prisma in
  the test (the same "simulate an edge case via a direct DB write" idiom
  already used for storage-quota and feedback-window-expiry tests — there's
  no way to flip the real exported constant per-test) causes the next
  authenticated request (e.g. `GET /organizations`) to `403`.
- `POST /me/consent` un-blocks: calling it after a backdated write, then
  retrying the same previously-blocked request, now succeeds.
- `PdpaController` routes (`GET /me/consents`, `GET /me/export`,
  `DELETE /me`) all stay reachable while the user is otherwise blocked.
- `login` and `refresh` responses carry `consentStale: true` for a
  backdated user and `false` for a normal one.
- A successful `POST /me/consent` writes exactly one `pdpa.consent.renew`
  audit row.
- No tenant-isolation test needed — `ConsentRecord` is user-scoped, not
  org-scoped, same treatment it's always had.

---

## Test baseline to verify before planning

Re-run `npm test` / `npm run test:e2e` in `backend/` and record actual
counts before writing the implementation plan's task numbering — per
standing rule (a past arithmetic mistake during the Analytics phase is why
this exists).
