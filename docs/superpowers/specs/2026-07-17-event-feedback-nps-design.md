# Event Feedback + NPS — Design

Phase 2 item. Roadmap line (`docs/roadmap.md`): "Event Feedback + NPS — feeds
analytics; can gate certificate release." Spec precedent
(`docs/superpowers/specs/2026-07-10-club-management-platform-design.md:159`):
"feeds analytics; can gate certificate release (attend + feedback →
certificate)."

**In:** feedback submission (NPS + fixed rating set + comment), per-event
opt-in certificate gating, committee-facing anonymized summary, org-wide
analytics trend.

**Out (deferred, do not build):** frontend (backend-only, consistent with
every other Phase 2 item shipped so far), configurable rating categories,
configurable window length, per-question free text beyond one comment field,
identity-visible feedback for committee, multi-submission/edit-after-submit.

---

## Architecture

New `backend/src/feedback/` module (controller/service/DTOs — same shape as
every other feature module).

**Toggle:** `Event.requireFeedbackForCertificate` (boolean, default `false`).
Settable only via the existing `PATCH /events/:eventId` while the event is
`DRAFT`/`PUBLISHED` — reuses the existing edit-lock in
`events.service.ts:update()` that already blocks edits once `COMPLETED`/
`CANCELLED`. No new endpoint for the toggle.

**Eligibility to submit:** any member with `PRESENT` attendance at the event,
from whenever their attendance was marked until 14 days after `event.endAt`.
Not role-gated — enforced in `FeedbackService` (attendance lookup + window
check), same style as other eligibility checks in this codebase.

**Certificate gating — the core behavior change:**

`events.service.ts:complete()` currently calls
`certificateGeneration.enqueueBatchForEvent(orgId, eventId, actorUserId)`
unconditionally, which certs every `PRESENT` attendee immediately
(`certificate-generation.service.ts:14-34`). This changes only when the
event's gate is on:

1. At `complete()` time: if `requireFeedbackForCertificate` is true, the
   batch call is filtered to only attendees who *already* have a
   `FeedbackResponse` row (rare at this exact moment, but possible — someone
   could submit feedback while the event is still `PUBLISHED`, before the
   organizer calls complete). `enqueueBatchForEvent` gains an
   `opts?: { onlyWithFeedback?: boolean }` parameter that adds a
   `FeedbackResponse` existence filter to the attendee query.
2. Also at `complete()` time, if the gate is on: schedule one BullMQ delayed
   job on the existing `certificates` queue (`CERTIFICATE_QUEUE`), job id
   `feedback-window-close-<eventId>` (hyphen separator — BullMQ custom job
   ids reject `:`, per the Email Notifications precedent), delay =
   `max(0, event.endAt + 14 days - now)`. When it fires, the processor calls
   the *ungated* `enqueueBatchForEvent(orgId, eventId, undefined)` — this is
   the "auto-issue after window closes" fallback: whoever still doesn't have
   a certificate gets one regardless of feedback, because the window is over.
   `enqueueBatchForEvent` is already idempotent (skips users who already have
   a certificate), so this is safe to call even if some certs already went
   out earlier.
3. On every feedback submission (`FeedbackService.submit`): if the event is
   already `COMPLETED` and gated, re-run
   `enqueueBatchForEvent(orgId, eventId, undefined, { onlyWithFeedback: true })`
   right away. This re-scans all `PRESENT` attendees with feedback and skips
   existing certs, so it's cheap at this scale (club-sized events) and avoids
   a separate single-user code path. This is what makes a certificate appear
   immediately after someone submits, instead of waiting for the 14-day
   fallback.
4. Non-gated events: completely unchanged — one unconditional
   `enqueueBatchForEvent` call at `complete()`, no delayed job.

No job is needed to *cancel* the delayed job — `COMPLETED` is a terminal
event status (per the existing state machine in `events.service.ts`), so
there's no path back to `DRAFT`/`PUBLISHED` that would need to un-schedule it.

---

## Data model

```prisma
model FeedbackResponse {
  id                 String   @id @default(uuid())
  eventId            String
  event              Event    @relation(fields: [eventId], references: [id])
  organizationId     String
  userId             String
  user               User     @relation(fields: [userId], references: [id])
  npsScore           Int      // 0-10, "how likely are you to recommend this event"
  contentRating      Int      // 1-5
  organizationRating Int      // 1-5
  venueRating        Int      // 1-5
  comment            String?
  createdAt          DateTime @default(now())

  @@unique([eventId, userId])
  @@index([organizationId])
}
```

Ids are `uuid()` (not `cuid()`) to match every other model in this schema.
`organizationId` is a flat scalar with no `Organization` relation — mirrors
`Certificate`'s exact shape, which has the same redundant-with-`eventId`
`organizationId` column and no formal relation to `Organization`. No
`@db.Text` — unused anywhere else in this schema, plain `String?` matches
convention.

`Event` gains: `requireFeedbackForCertificate Boolean @default(false)`.

`FeedbackResponse` is added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts`.

All four scored fields (`npsScore`, `contentRating`, `organizationRating`,
`venueRating`) are required on submission; `comment` is optional
(`@db.Text`, cap at 2000 chars via DTO `@MaxLength`).

---

## Endpoints

Base path: `organizations/:orgId/events/:eventId/feedback`.

| Method + path | Guard | Access | Behavior |
|---|---|---|---|
| `POST /` | `JwtAuthGuard, TenantGuard` | Any member, enforced in service: must have `PRESENT` attendance for this event, within 14 days of `event.endAt`, no existing submission | Creates `FeedbackResponse`; audits `feedback.submit`; if event is `COMPLETED` and gated, triggers the immediate-unlock cert check (see Architecture #3) |
| `GET /me` | `JwtAuthGuard, TenantGuard` | Same member | Returns their own submission or `null` — lets the UI hide the form after submit |
| `GET /summary` | `JwtAuthGuard, TenantGuard, RolesGuard` + `@Roles(...MANAGE_EVENTS)` | Committee | Aggregates only: avg NPS, avg of each rating, response count, list of comments — **never includes `userId` or any submitter identity** |

Validation errors: not `PRESENT` → `403`; window expired → `403`; duplicate
submission → `409 Conflict`; event not found in this org → `404` (mirrors
`events.service.ts:findOne` tenant-scoped 404 pattern).

`requireFeedbackForCertificate` is added as an optional boolean field to the
existing `UpdateEventDto` — no new endpoint.

**Analytics** — two new endpoints on the existing `AnalyticsController`
(`backend/src/analytics/analytics.controller.ts`), same guards/`@Roles(...MANAGE_EVENTS)`
as every other analytics route:

- `GET /analytics/feedback` — per-event breakdown: for each event with at
  least one response, avg NPS, avg of each rating, response count.
- `GET /analytics/feedback-trends?days=` — org-wide trend over time (same
  `parseDaysParam` window pattern as `getTrends`/`getCommitteeActivity`):
  avg NPS and avg ratings bucketed over the window, so committee can see
  whether scores are improving or declining.

---

## RBAC, audit, testing

**RBAC:** submission is eligibility-gated in the service layer, not
role-gated (any org member can submit if they qualify). Summary and
analytics reads are `MANAGE_EVENTS`-gated, consistent with every other
committee-facing read in this codebase.

**Audit:** `feedback.submit` on create (actor = submitting member,
`targetType: 'FeedbackResponse'`). No audit rows for reads (`/me`,
`/summary`, analytics) — reads are never audited, per established pattern.

**Tenant isolation (mandatory):** org A cannot submit, read `/me`, read
`/summary`, or see org B's event/feedback in analytics.

**Core test coverage:**

- Submit rejected when: attendance isn't `PRESENT`, window has expired
  (`now > endAt + 14 days`), duplicate submission (`@@unique` → `409`),
  event doesn't exist in this org.
- Submit accepted records all four scored fields + optional comment,
  audits `feedback.submit`.
- `complete()` on a **gated** event only certs attendees who already have a
  `FeedbackResponse` at that moment; a **non-gated** event's `complete()`
  behavior is unchanged (existing Certificate Generator tests must still
  pass unmodified).
- Delayed `feedback-window-close-<eventId>` job, once fired, issues
  certificates to every remaining `PRESENT` attendee regardless of feedback,
  and skips anyone who already has one.
- Submitting feedback for an already-`COMPLETED` gated event immediately
  triggers that person's certificate (without waiting for the delayed job).
- `/summary` and analytics responses never contain `userId` or submitter
  name — only aggregates and a bare comment list.
- Toggling `requireFeedbackForCertificate` is blocked once the event is
  `COMPLETED`/`CANCELLED` (existing `update()` edit-lock, verified against
  the new field specifically).

---

## Test baseline to verify before planning

Re-run `npm test` / `npm run test:e2e` in `backend/` and record actual
counts before writing the implementation plan's task numbering — per
standing rule (a past arithmetic mistake during the Analytics phase is why
this exists).
