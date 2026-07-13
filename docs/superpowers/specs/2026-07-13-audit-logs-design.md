# Audit Logs — Design Spec

Roadmap Phase 1, item 10. Backend-only (no frontend exists yet in this
project — same posture as every prior Phase 1 item). Read-side only: a
paginated, filterable query endpoint over the `AuditLog` rows every module
has already been writing since Phase 1 started.

## Goal

Give committee members (President tier and down to Event Director — not
plain Committee) a way to view their organization's sensitive-action audit
trail: who did what, to what, and when.

## Scope

Sensitive-action logging (the write side) is already fully built —
`AuditService.record()` is already called from `events`, `registrations`,
`memberships`, `certificates`, and `organizations`. This item adds no new
audited action and no schema change. It adds exactly one thing: a way to
read what's already being written.

**Break-glass alerting is explicitly out of scope for this item.** The
roadmap's "break-glass alerts" phrase presupposes a `SuperAdmin`/
cross-tenant access mechanism that does not exist anywhere in this
codebase — no global role field on `User`, no cross-tenant guard, no
notification infrastructure of any kind, and no earlier Phase 1 item builds
one. `AuditLog.isBreakGlass` stays schema-ready-but-unset, the same posture
this codebase already uses for `User.mfaSecret` (MFA is "schema-ready,
enabled in a later phase" per `docs/security.md`). Alerting is deferred
until a `SuperAdmin`/cross-tenant feature actually exists to trigger it.

## Endpoint

`GET /organizations/:orgId/audit-logs`

RBAC: `MANAGE_MEMBERS` role group (President, VP, Secretary, Treasurer,
Event Director) — **not** `MANAGE_EVENTS`. This matches the original
planning-phase permission matrix in `docs/security.md`, whose "View audit
log" row is ✅ for President/VP/Sec/Treas/EvDir and ❌ for Committee/
Volunteer/Participant — a narrower tier than every other Phase 1 endpoint,
which has used `MANAGE_EVENTS` (President tier + Committee). This is the
first endpoint in the project to use `MANAGE_MEMBERS` standalone rather than
as a base for `MANAGE_EVENTS`/`VIEW_MEMBERS`.

Guard chain: `JwtAuthGuard → TenantGuard → RolesGuard`.

New file `backend/src/audit/audit-log.controller.ts` and a new
`AuditLogService.list()` method, added to the existing `AuditModule`
(already `@Global()`, already exports `AuditService` — no new module, no
new imports elsewhere needed).

## Query parameters (all optional)

Following this codebase's existing raw-`@Query('x')`-param convention (see
`MembershipsController.list`'s `status`/`role` params) — no query-DTO class
precedent exists yet, and one filterable endpoint doesn't justify
introducing the pattern.

- `action` — exact string match against `AuditLog.action` (e.g.
  `certificate.delete`).
- `actorUserId` — exact match against `AuditLog.actorUserId`.
- `from` — ISO8601 string; filters `createdAt >= from`. Invalid date string
  → `400`.
- `to` — ISO8601 string; filters `createdAt <= to`. Invalid date string →
  `400`.
- `page` — 1-indexed, default `1`. Non-positive or non-numeric → treated as
  `1`.
- `pageSize` — default `25`, clamped to `[1, 100]`.

This is the first paginated endpoint in the project — offset-based
(`skip`/`take`), not cursor-based. Simpler, and matches this codebase's
YAGNI posture: club-scale audit volume doesn't need cursor pagination.
Every other Phase 1 list endpoint (registrations, certificates, dashboard's
fixed top-N widgets) either has no pagination or a fixed cap; this is the
one place a real paginated query belongs — the dashboard's design spec
explicitly flagged this ("a full paginated activity log is a separate,
not-yet-built roadmap item, Phase 1 item 10").

## Response shape

```ts
{
  data: Array<{
    id: string;
    organizationId: string | null;
    actorUserId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: Record<string, unknown> | null;
    isBreakGlass: boolean;
    createdAt: string;
  }>,
  total: number,   // count() with the same where-filters, for pagination UI
  page: number,
  pageSize: number,
}
```

`metadata` **is** included in this response — unlike the dashboard's
activity feed widget, which deliberately excluded it for a glance view, this
*is* the dedicated log viewer, and every existing audited action already
follows the ids-only metadata convention (no PII, no file content — see
`docs/security.md`'s per-feature "Audit" sections).

`AuditLog.ipAddress` and `AuditLog.userAgent` columns exist on the model but
are excluded from the `select` — nothing in the codebase ever sets them
(`AuditService`'s own `AuditEntry` interface doesn't accept either field),
so they are always `null` today. Not a scope decision, just dead columns
not worth surfacing.

## Query construction

```
where: {
  organizationId,               // always present — tenant scope
  ...(action && { action }),
  ...(actorUserId && { actorUserId }),
  ...((from || to) && {
    createdAt: {
      ...(from && { gte: parsedFrom }),
      ...(to && { lte: parsedTo }),
    },
  }),
}
```

`organizationId` scoping satisfies the Prisma tenant-scope middleware
(`AuditLog` is already in `TENANT_SCOPED_MODELS`). `count()` and
`findMany()` run with the identical `where` clause — `count()` for `total`,
`findMany()` with `orderBy: { createdAt: 'desc' }`, `skip`, `take` for
`data`.

## Error handling

- Wrong org → `403` (`TenantGuard`, no membership).
- Invalid `from`/`to` (unparseable date string) → `400`.
- No `404` case — no path parameter beyond `:orgId`.

## Audit

None — viewing the audit log is not itself an audited action, matching the
existing precedent that `GET /certificates` list and `GET /dashboard` are
both unaudited reads.

## Testing plan

**Unit:** none new — the query is a single `organizationId`-scoped
`findMany`/`count` pair, matching this codebase's precedent of proving pure
read services at the e2e layer only.

**E2E** (`backend/test/audit-logs.e2e-spec.ts`):

- Happy path: seed an org, perform a handful of distinct audited actions
  (e.g. create + publish an event, register a participant), then assert the
  endpoint returns them with correct `total`, correct `data` ordering
  (newest first), and correct field shape (including a non-null `metadata`
  on at least one row).
- Filter by `action` — assert only matching rows return.
- Filter by `from`/`to` — assert only rows within the window return.
- Invalid `from` → `400`.
- Pagination — seed enough rows to span two pages (`pageSize` small,
  e.g. `2`), assert `page=1` and `page=2` return disjoint, correctly
  ordered slices and `total` reflects the full count regardless of page.
- RBAC — a Committee-tier member (passes `MANAGE_EVENTS` elsewhere but not
  `MANAGE_MEMBERS`) → `403`.
- Isolation — org B's President hitting org A's `:orgId` → `403` (no
  membership); org A's own query never contains org B's rows (implicit in
  the happy-path `total`/`data` assertions being exact, not "at least N").

## Out of scope

- Break-glass alerting / `SuperAdmin` / cross-tenant access (see Scope
  section above — explicit deferral, not an oversight).
- Cursor-based pagination.
- Export/download of the audit log (Phase 1 item 11, Basic PDPA, covers
  "export my data" for a participant's own data — this is a separate,
  committee-facing org-wide log, not part of that item).
- Real-time/streaming updates.
- Frontend rendering.
