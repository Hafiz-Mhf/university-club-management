# Analytics — Design Spec

Roadmap Phase 2, item 1 ("Organization Workspace"). Backend-only (no
frontend exists yet in this project — same posture as every Phase 1 item).
Read-side only: five new aggregate-query endpoints over data every earlier
module already writes, plus one small new write path for certificate
download tracking.

## Goal

Give committee members (President tier down to plain Committee — same tier
as the existing Dashboard) a deeper, historical view of their organization
than the Dashboard's current-snapshot KPIs: attendance rate, member growth,
demographic distribution, registration trends, certificate issuance vs.
download, and committee activity.

## Scope

This is the Dashboard's "bigger sibling" — Dashboard (Phase 1 item 9) shows
a live snapshot (active members right now, upcoming events, pending
approvals). Analytics adds trends over time and breakdowns the Dashboard
deliberately left out. It does not replace or duplicate any Dashboard field.

One new model is required: certificate downloads are not tracked anywhere
today (`CertificatesService.download()` and the participant self-download
path both just mint a fresh signed URL — no row is ever written). This spec
adds a `CertificateDownload` row written on every download.

Everything else reads models that already exist: `Membership`, `Event`,
`Registration`, `Attendance`, `Certificate`, `AuditLog`.

## Endpoints

All five routes live under a new `AnalyticsModule`
(`backend/src/analytics/`), mirroring `DashboardModule`'s file shape
(`analytics.module.ts`, `analytics.controller.ts`, `analytics.service.ts`
— one controller, one service, no DTOs beyond raw `@Query` params, same
convention as `MembershipsController` and the audit-logs endpoint).

Guard chain on every route: `JwtAuthGuard → TenantGuard → RolesGuard`,
`@Roles(...MANAGE_EVENTS)` — identical tier to the existing Dashboard
endpoint (President, Vice President, Secretary, Treasurer, Event Director,
Committee).

1. `GET /organizations/:orgId/analytics/overview`
2. `GET /organizations/:orgId/analytics/trends?days=30`
3. `GET /organizations/:orgId/analytics/demographics`
4. `GET /organizations/:orgId/analytics/certificates`
5. `GET /organizations/:orgId/analytics/committee-activity?days=30`

Splitting into five focused routes (rather than one combined payload like
Dashboard's `getSummary`) means each metric group is independently cheap to
query, independently testable, and a future frontend can request only the
widget currently in view instead of always paying for all six metrics.

### `days` query parameter

Used by `trends` and `committee-activity`. Raw `@Query('days')`, following
the audit-logs precedent for un-DTO'd query params:

- Optional, default `30`.
- Non-numeric or non-positive → treated as `30` (silently defaults, same
  posture as audit-logs' `page` param — this is a reporting window, not a
  security-sensitive filter, so a bad value degrading to the default rather
  than `400`ing is the right tradeoff).
- Clamped to `[1, 365]` — bounds query cost; a club's data doesn't need a
  window larger than a year in this phase.

## Response shapes and metric definitions

### 1. Overview

```ts
{
  attendanceRate: number | null; // 0..1, null if no resolved attendance rows yet
}
```

**Attendance rate** = `PRESENT / (PRESENT + ABSENT)` across all
`Attendance` rows in the organization, all-time (no `days` window — this is
a resolved-outcome ratio, not a trend). Rows still in `REGISTERED` status
(event hasn't happened yet, or committee hasn't marked attendance) are
excluded from both numerator and denominator — they aren't a resolved
outcome. If there are zero resolved rows (`PRESENT + ABSENT === 0`),
`attendanceRate` is `null`, not `0` or `NaN`.

Kept deliberately to this one field — `activeMembers`, `totalEvents`, etc.
already exist on the Dashboard; duplicating them here would violate DRY for
no benefit.

### 2. Trends

```ts
{
  registrationTrend: Array<{ date: string; count: number }>; // YYYY-MM-DD, one entry per day in the window, zero-filled
  memberGrowth: Array<{ date: string; cumulativeActive: number }>; // YYYY-MM-DD, one entry per day in the window
}
```

**Registration trend** = count of `Registration` rows (any status) created
on each day within `[today - days, today]`, grouped by
`DATE(createdAt)`. Days with zero registrations appear with `count: 0`
(zero-filled, not omitted — a caller charting this shouldn't have to
backfill gaps).

**Member growth** = cumulative count of `Membership` rows with
`status: ACTIVE` and `joinedAt <= that day`, for each day in the window.
This is a running total, not a daily delta — `MemberStatus` has no
`REMOVED` value (only `ACTIVE`/`ALUMNI`), so there's no "member left"
event to net out; the count only grows or holds flat.

### 3. Demographics

```ts
{
  faculty: Array<{ value: string | null; count: number }>;
  programme: Array<{ value: string | null; count: number }>;
}
```

`groupBy` on `Membership.faculty` and `Membership.programme` respectively,
filtered to `status: ACTIVE`, counting rows per distinct value.
`value: null` groups members who never filled in that field. **Aggregates
only** — this endpoint never returns a member list or any per-member
identifying field alongside faculty/programme, since that combination is
demographic/PII-adjacent data (CLAUDE.md: "collect only necessary personal
data" — this reuses data already collected for membership, but exposing it
only as counts, never as a name-linked list, is the least-exposure design).

### 4. Certificates

```ts
{
  issued: number;
  downloaded: number; // count of CertificateDownload rows, not distinct certificates
}
```

`issued` = `Certificate.count({ organizationId })` (same query the
Dashboard already runs). `downloaded` = `CertificateDownload.count()` for
certificates belonging to the org, all-time. A certificate downloaded five
times counts as five — this measures download *activity*, not unique
reach; splitting into "downloaded at least once" vs. "total downloads" is
a YAGNI cut this phase doesn't need.

### 5. Committee activity

```ts
{
  data: Array<{
    userId: string;
    fullName: string;
    role: Role;
    actionCount: number;
  }>; // sorted by actionCount desc
}
```

`AuditLog` rows in the window (`createdAt >= today - days`) grouped by
`actorUserId`, count per group, joined to that user's current `Membership`
in the org for `fullName`/`role` display. Rows with `actorUserId: null`
(system-attributed actions, if any exist) are excluded — there's no
member to attribute them to. A member who left no audit trail in the
window simply doesn't appear (not zero-filled — unlike the daily trend
buckets, there's no fixed universe of "all members" this list needs to
enumerate against).

## New schema

```prisma
model CertificateDownload {
  id            String      @id @default(uuid())
  certificateId String
  certificate   Certificate @relation(fields: [certificateId], references: [id])
  userId        String
  downloadedAt  DateTime    @default(now())

  @@index([certificateId])
}
```

Add `downloads CertificateDownload[]` to the existing `Certificate` model.
`CertificateDownload` is **not** added to `TENANT_SCOPED_MODELS` in
`tenant-scope.middleware.ts` — analytics reads it scoped through
`certificate: { organizationId }` (a relation filter, same pattern
`Registration`/`Attendance` queries already use when filtering through a
relation), and the one write path
(`CertificatesService.download()`/participant download) creates by known
`certificateId`, not a scoped list query. This mirrors the PDPA feature's
established precedent: `create`/`findUnique` by id are exempt from the
scoping guard by design; only the six `SCOPED_ACTIONS` are gated.

## Write path: certificate download tracking

In `backend/src/certificates/certificates.service.ts`, both
`issue()` (committee re-fetching a download link) and `download()`
(participant self-download) already call
`storage.getSignedDownloadUrl(...)`. Each of those two call sites gains one
extra line immediately after: a `prisma.certificateDownload.create({ data:
{ certificateId: certificate.id, userId } })`. The write is awaited (not
fire-and-forget — consistent with this codebase's posture of never
silently dropping a DB write without at least trying), but wrapped in its
own try/catch: if the insert fails, log and still return the signed URL —
the download response must not 500 because a metrics write hiccuped. This
mirrors PDPA's post-commit storage-cleanup best-effort precedent (a
secondary effect's failure never blocks the primary response), just
inverted — here the tracked write is cheap/local Postgres running before
the response, not S3 running after it.

No audit log entry — this is a metrics write, not a sensitive action in
the audit sense; downloading your own certificate is already implicitly
covered by the existing `certificate.upload`/`certificate.delete` audit
actions on the write side.

## Query construction notes

Every query is scoped by `organizationId` (directly, for models already in
`TENANT_SCOPED_MODELS`, or via a `relation: { organizationId }` filter for
`CertificateDownload`). All five endpoints use `Promise.all` for their
independent sub-queries where more than one is needed (trends: two
queries; demographics: two `groupBy` calls; certificates: two counts) —
same pattern as `DashboardService.getSummary`.

Daily bucketing for `trends` does **not** use Prisma's raw SQL
aggregation — Prisma's `groupBy` has no date-truncation column to group by
directly, so trends queries fetch raw rows in the window
(`createdAt`, and for growth `joinedAt`) and bucket them in application
code (JS `Map<string, number>` keyed by `YYYY-MM-DD`), then zero-fill the
full day range. Club-scale data volume (a single org's registrations/
memberships over a year) makes this trivially fast in-process; this is not
expected to need a raw SQL date-trunc query at this phase.

## Error handling

- Wrong org → `403` (`TenantGuard`, no membership).
- `days` non-numeric/non-positive → silently defaults to `30` (see above).
- No `404` case on any route — no path parameter beyond `:orgId`.

## Audit

None of the five read endpoints are audited — matching the existing
precedent that `GET /dashboard` and the audit-logs list endpoint are both
unaudited reads. The one write (`CertificateDownload` insert) is a metrics
row, not an audit entry (see Write path section above).

## Testing plan

**Unit:** `CertificatesService`'s two call sites gain a unit-test
assertion that `certificateDownload.create` is called with the right
`certificateId`/`userId` — matching this codebase's precedent of unit-
testing write-side side effects and leaving pure reads to e2e coverage.

**E2E**, one file per endpoint under `backend/test/`
(`analytics-overview.e2e-spec.ts`,
`analytics-trends.e2e-spec.ts`,
`analytics-demographics.e2e-spec.ts`,
`analytics-certificates.e2e-spec.ts`,
`analytics-committee-activity.e2e-spec.ts`):

- **Overview:** seed a mix of PRESENT/ABSENT/REGISTERED attendance rows,
  assert the exact ratio; separately assert a fresh org with zero resolved
  rows returns `attendanceRate: null`.
- **Trends:** seed registrations across several days (including a
  deliberate gap day), assert `registrationTrend` zero-fills the gap and
  counts match; seed memberships joining on different days, assert
  `memberGrowth` is a correct non-decreasing cumulative series.
- **Demographics:** seed members with varying `faculty`/`programme`
  (including one `null`), assert grouped counts are correct and no
  member-identifying field is present in the response.
- **Certificates:** seed certificates and multiple downloads of the same
  certificate, assert `issued` and `downloaded` counts (downloaded counting
  repeats, not distinct certificates).
- **Committee activity:** seed audited actions from two different
  committee members, assert per-member counts and descending sort; assert
  a member with zero actions in the window is absent from `data`.
- **RBAC** (each endpoint): a plain PARTICIPANT-tier member → `403`.
- **Isolation** (each endpoint): org B's President hitting org A's `:orgId`
  → `403`; org A's own results never include org B's rows (implicit in
  exact-count assertions, not "at least N").

## Out of scope

- Frontend rendering (charts, dashboard page) — first frontend work of the
  project is a separate, later item, not bundled into this backend spec.
- Custom date-range (`from`/`to`) or weekly/monthly granularity — fixed
  last-N-days, daily buckets only, this phase.
- Cross-event or predictive analytics (Phase 3 territory per
  `docs/roadmap.md`).
- Distinct-download-reach metric ("downloaded by N unique participants") —
  `downloaded` is a raw activity count this phase.
- Action-type breakdown for committee activity (per-action-type counts
  org-wide) — this phase reports per-member counts only.
