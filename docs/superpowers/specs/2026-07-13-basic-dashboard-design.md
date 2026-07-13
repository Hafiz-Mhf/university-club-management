# Basic Dashboard — Design Spec

Roadmap Phase 1, item 9. Backend-only (no frontend exists yet in this
project — same posture as auth/committee-rbac/events/registration/attendance/
certificates). One new module, one new endpoint, no new tables.

## Goal

A single committee-facing view of an organization's current state: headline
counts, upcoming events, registrations waiting on committee action, recent
signups, and a feed of sensitive-action activity — everything the roadmap's
"Basic Dashboard" item calls for (KPI cards, upcoming events, pending
approvals, recent registrations, activity feed), backed by existing data.

## Architecture

`GET /organizations/:orgId/dashboard` — one aggregate endpoint returning all
five widgets in one payload. Considered five separate granular endpoints
(`/dashboard/kpis`, `/dashboard/upcoming-events`, etc.) for composability, but
rejected: more route/guard/test surface for a "Basic Dashboard" that's meant
to back one screen, and every other "Basic X" item in this project has stayed
similarly lean. One endpoint, one guard chain, one e2e suite.

New module `backend/src/dashboard/` (`DashboardModule`, `DashboardController`,
`DashboardService`). No new Prisma models — the service composes org-scoped
queries against `Membership`, `Event`, `Registration`, `Certificate`, and
`AuditLog`.

## RBAC

`MANAGE_EVENTS` role group (same tier as certificates list/upload/download/
delete, registration list/reject, form management). Pending approvals and
org-wide activity are committee-facing data; a plain participant does not see
them. Guard chain: `JwtAuthGuard → TenantGuard → RolesGuard`.

## Response shape

```ts
{
  kpis: {
    activeMembers: number,
    totalEvents: number,
    activeRegistrations: number,
    certificatesIssued: number,
  },
  upcomingEvents: Array<{
    id: string; title: string; startAt: string; venue: string | null;
    registrationCount: number;
  }>,
  pendingApprovals: Array<{
    id: string; eventId: string; eventTitle: string; userId: string;
    createdAt: string;
  }>,
  recentRegistrations: Array<{
    id: string; eventId: string; eventTitle: string; userId: string;
    status: 'APPROVED' | 'WAITLISTED' | 'REJECTED' | 'CANCELLED';
    createdAt: string;
  }>,
  activityFeed: Array<{
    id: string; action: string; targetType: string | null;
    targetId: string | null; actorUserId: string | null; createdAt: string;
  }>,
}
```

### KPI cards

All four are `count`/`aggregate` queries scoped to `organizationId`:

- `activeMembers` — `Membership.count({ where: { organizationId, status: 'ACTIVE' } })`
- `totalEvents` — `Event.count({ where: { organizationId, status: { in: ['PUBLISHED', 'COMPLETED'] } } })`
  (excludes `DRAFT`/`CANCELLED` — these aren't "real" events from a
  dashboard-summary perspective)
- `activeRegistrations` — `Registration.count({ where: { organizationId, status: { in: ['APPROVED', 'WAITLISTED'] } } })`
  (excludes `CANCELLED`/`REJECTED`)
- `certificatesIssued` — `Certificate.count({ where: { organizationId } })`

### Upcoming events

Top 5 `Event` rows where `organizationId` matches, `status: 'PUBLISHED'`,
`startAt >= now()`, ordered by `startAt asc`. `registrationCount` is a
per-event `_count` of registrations (Prisma `_count: { select: { registrations: true } }`)
— not filtered by status, a raw signup count for at-a-glance capacity
awareness.

### Pending approvals

Top 10 `Registration` rows where `organizationId` matches and
`status: 'WAITLISTED'`, ordered by `createdAt asc` (oldest-waiting first —
these are registrations a committee member can `reject` to free a spot, or
that will auto-promote when someone ahead cancels). `RegistrationStatus.PENDING`
is unused elsewhere in this codebase (reserved for a future manual-review
flow) so `WAITLISTED` is the only genuinely "awaiting committee action" state
today. `eventTitle` is joined in via `event: { select: { title: true } }`.

### Recent registrations

Top 10 `Registration` rows where `organizationId` matches (any status),
ordered by `createdAt desc`. Same join for `eventTitle`.

### Activity feed

Top 15 `AuditLog` rows where `organizationId` matches, ordered by
`createdAt desc`. `metadata` is deliberately excluded from the response even
though it only ever holds ids (per the existing ids-only audit convention) —
the dashboard feed doesn't need it, and the explicit `select` keeps this
predictable if a future audited action's metadata shape changes.

## Field-selection discipline

Every widget query uses an **explicit Prisma `select`** — never a raw
spread of the full row. This directly follows the fix pattern from the
certificate repository feature, where `findMine`/`download` spreading full
`Certificate` rows was flagged as a (accepted, but avoidable) hygiene issue.
Registration rows in particular carry `answers` (participant's custom-form
responses) and `consentRecordId` — neither belongs in a dashboard summary.

## Error handling

Wrong org → `403` (`TenantGuard`, no membership). There's no other path
parameter, so no `404` case exists for this endpoint.

## Audit

None. This is a read-only aggregate endpoint; viewing the dashboard is not a
sensitive action in the sense the existing audit convention covers (compare:
`GET /certificates` list is also unaudited).

## Testing plan

**Unit:** none new. Every widget is a straightforward `organizationId`-scoped
Prisma read (`count`/`findMany` with `select`) — matches this project's
existing precedent of not unit-testing pure read/aggregate service methods
(e.g. `RegistrationsService.list`, `CertificatesService.list` have no unit
specs; their behavior is proven at the e2e layer).

**E2E** (`backend/test/dashboard.e2e-spec.ts`):

- Happy path: seed an org with committee + members (some `ALUMNI`), a
  `DRAFT` event (excluded from `totalEvents`/`upcomingEvents`), a `PUBLISHED`
  future event with several registrations (some `WAITLISTED` via capacity),
  a `COMPLETED` past event, a certificate. Assert every KPI count is exact,
  `upcomingEvents` excludes the past/draft events and includes the future
  published one with the right `registrationCount`, `pendingApprovals`
  contains only the `WAITLISTED` rows ordered oldest-first, `recentRegistrations`
  is ordered newest-first, `activityFeed` reflects the audited actions taken
  during setup (registration/promotion/certificate-upload) newest-first.
- Empty-org path: a freshly created org with no events/members beyond the
  president. All KPI counts are `0`, all four arrays are empty, `200` (not
  an error).
- RBAC: a plain `PARTICIPANT`-tier member → `403`.
- Isolation: org B's committee hitting org A's `:orgId` → `403` (no
  membership); org A's own dashboard never contains org B's rows (implicit
  in the happy-path assertions being exact counts, not "at least N").

## Out of scope

- Trends, rates, faculty/programme distribution, attendance-rate calculation
  (Phase 2 Analytics — explicit scope decision, matches roadmap's own
  Phase 1/Phase 2 split).
- Caching (Redis is introduced when caching/rate-limiting/analytics land per
  `CLAUDE.md` — this endpoint is cheap enough today to query live).
- Frontend rendering.
- Real-time/push updates.
- Pagination on the four list widgets — fixed top-N is sufficient for a
  "Basic Dashboard" glance view; a full paginated activity log already
  exists conceptually as the audit trail (Phase 1 item 10, not yet built).
