# Meeting Minutes — Design Spec

Roadmap Phase 2, item 3 ("Organization Workspace"). Backend-only (no
frontend exists yet in this project — same posture as every prior phase
item). Structured meeting-minutes records with a paginated archive.

## Goal

Give committee members a place to record structured minutes for org
meetings (committee meetings, general meetings — not tied to any specific
Event) and browse a chronological archive. Distinct from File Repository
(free-form document uploads) and Analytics (aggregate metrics) — this is
one structured record per meeting, created and maintained directly through
the API, not an uploaded file.

## Scope

One new model (`MeetingMinutes`), one new module (`MinutesModule`).
Standalone, org-level records — not linked to any `Event`. Attendees are
selected from the org's real `Membership` records (validated at write
time, not free text). Action items are plain structured text with an
optional owner name — no status tracking (not a task-management feature).
Full CRUD: committee-tier roles can create/edit/delete; any ACTIVE member
can view the archive.

## Data model

```prisma
model MeetingMinutes {
  id                    String       @id @default(uuid())
  organizationId        String
  organization          Organization @relation(fields: [organizationId], references: [id])
  title                 String
  meetingDate           DateTime
  attendeeMembershipIds Json
  agendaItems           Json
  actionItems           Json
  createdByUserId       String
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  @@index([organizationId])
}
```

- `attendeeMembershipIds`: `string[]` — each entry must be a `Membership.id`
  belonging to this org, validated at both create and update time (an
  unknown or foreign-org id → `400`). Stored as `Json` rather than a join
  table: no many-to-many join-table precedent exists anywhere in this
  codebase (`Organization.advisors`/`socialLinks`,
  `Membership.committeeHistory`, `Registration.answers` are all `Json?`
  for structured-but-not-relational data) — introducing the first join
  table for a read pattern that's just "fetch one minutes entry, show its
  attendee list" is more machinery than the feature needs.
- `agendaItems`: `Array<{ topic: string; notes: string }>` — both required,
  non-empty strings per entry.
- `actionItems`: `Array<{ task: string; owner?: string }>` — `task`
  required non-empty string, `owner` optional free-text name (not a
  `Membership` link — the owner might be someone not present, or a
  sub-team, and this is a record, not an assignment/tracking system).
  No `status` field — action items are text captured in the minutes, not
  a task tracker; a separate open/done workflow is a different feature
  not on this roadmap.
- `createdByUserId`: the committee member who authored the entry
  (plain column, no FK relation, matching `Certificate.uploadedByUserId`'s
  and `OrgFile.uploadedByUserId`'s convention).

`MeetingMinutes` **is** added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts` — the list/archive
endpoint issues a genuine org-scoped `findMany`, exactly the shape the
middleware is meant to guard (same reasoning as `OrgFile` in the File
Repository phase).

Not tied to `Event` — no `eventId` field. Committee meetings and general
meetings are frequently never created as an `Event` record (`Event` models
things with capacity/registration/attendance, which doesn't fit an
internal committee meeting), and the roadmap line doesn't call for an
event link either.

## Endpoints

All routes live under a new `MinutesModule` (`backend/src/minutes/`),
mirroring `FilesModule`'s file shape (`minutes.module.ts`,
`minutes.controller.ts`, `minutes.service.ts`, `dto/`).

`@Controller('organizations/:orgId/minutes')`

1. `POST /organizations/:orgId/minutes` — create.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - Body: `title` (string, required), `meetingDate` (ISO date string,
     required), `attendeeMembershipIds` (`string[]`, required — may be
     empty), `agendaItems` (`Array<{topic, notes}>`, required — may be
     empty), `actionItems` (`Array<{task, owner?}>`, required — may be
     empty).
   - Validates every id in `attendeeMembershipIds` against
     `Membership.findMany({ where: { id: { in: [...] }, organizationId } })`
     — any id not found in that set → `400 BadRequestException`.
   - Writes the `MeetingMinutes` row + `AuditLog` (`minutes.create`)
     atomically in a `$transaction`.
   - Returns the created row.

2. `GET /organizations/:orgId/minutes` — archive/list.
   - Guard: `JwtAuthGuard, TenantGuard` only. Any ACTIVE member.
   - Query params: `page` (default 1), `pageSize` (default 25, max 100) —
     same convention and defaults as `AuditService.list`.
   - Sorted `meetingDate desc`.
   - Returns `{ data, total, page, pageSize }` (same envelope shape as
     `AuditService.list`, for consistency across the codebase's two
     paginated list endpoints).

3. `GET /organizations/:orgId/minutes/:minutesId` — get one.
   - Guard: `JwtAuthGuard, TenantGuard` only. Any ACTIVE member.
   - `404` if `minutesId` doesn't belong to this org.

4. `PATCH /organizations/:orgId/minutes/:minutesId` — edit.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - Body: any subset of `title`, `meetingDate`, `attendeeMembershipIds`,
     `agendaItems`, `actionItems`.
   - `attendeeMembershipIds`, if provided, is re-validated exactly as on
     create.
   - `404` if `minutesId` doesn't belong to this org.
   - Writes the update + `AuditLog` (`minutes.update`) atomically.

5. `DELETE /organizations/:orgId/minutes/:minutesId` — delete.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - `404` if `minutesId` doesn't belong to this org.
   - Writes the delete + `AuditLog` (`minutes.delete`) atomically.

## Validation

- `title`: required, non-empty string.
- `meetingDate`: required, must parse to a valid date (`400` on an
  unparseable value).
- `attendeeMembershipIds`: required array (may be empty), every element
  must be a string; every element must resolve to a real `Membership` row
  in this org (checked via a single `findMany` — not one query per id).
- `agendaItems`: required array (may be empty); each entry requires
  non-empty `topic` and `notes` strings.
- `actionItems`: required array (may be empty); each entry requires a
  non-empty `task` string; `owner` is an optional string.

Any validation failure → `400 BadRequestException` with a message naming
the failing field, matching this codebase's existing DTO/class-validator
error conventions.

## RBAC

| Action | Roles |
|--------|-------|
| Create | `MANAGE_EVENTS` |
| List (archive) | Any ACTIVE member of the org (all roles) |
| Get one | Any ACTIVE member of the org |
| Edit | `MANAGE_EVENTS` |
| Delete | `MANAGE_EVENTS` |

Same guard-chain convention as every other multi-route controller
(`@UseGuards`/`@Roles` repeated per-method, not hoisted to class level).

## Audit

Three new audit actions, matching `event.create`/`event.update`/
`event.delete`'s exact shape:

- `minutes.create` — `targetType: 'MeetingMinutes'`, `targetId: minutes.id`,
  metadata `{ minutesId, title, meetingDate }`.
- `minutes.update` — same shape, metadata reflects the post-update state.
- `minutes.delete` — same shape.

Reads (list, get-one) are unaudited — matches the `GET /dashboard`,
Analytics, and Files precedent of unaudited reads.

## Error handling

- Wrong org → `403` (`TenantGuard`, no membership) on every route.
- Non-committee caller on create/edit/delete → `403` (`RolesGuard`).
- Unknown `attendeeMembershipIds` entry, missing/empty required field,
  unparseable `meetingDate` → `400`.
- `minutesId` not found in this org (get-one, edit, delete) → `404`.

## Testing plan

**E2E only** (`backend/test/minutes-*.e2e-spec.ts`), no unit-test file —
same precedent as `CertificatesService`/`FilesService`.

- **Create:** committee member creates a minutes entry with attendees,
  agenda items, and action items → `201`, row matches input; a plain
  participant attempting create → `403`; an unknown
  `attendeeMembershipIds` entry → `400`; missing `title` → `400`;
  unparseable `meetingDate` → `400`.
- **List:** returns entries sorted `meetingDate desc`; pagination
  (`page`/`pageSize`) returns the correct slice and `total`; a plain
  participant can list (no RBAC restriction).
- **Get one:** returns the full entry including agenda/action items;
  `404` for a `minutesId` from a different org.
- **Edit:** updates a subset of fields, leaves others untouched; a
  re-validated `attendeeMembershipIds` update with an unknown id → `400`;
  a plain participant attempting edit → `403`; `404` for a `minutesId`
  from a different org.
- **Delete:** committee member deletes an entry → subsequent get-one →
  `404`; a plain participant attempting delete → `403`; `404` for a
  `minutesId` from a different org.
- **Isolation:** org B's president cannot list, get, edit, or delete org
  A's minutes (`403`/`404` as appropriate for each route).

## Out of scope

- Event linkage — standalone, org-level records only.
- Action-item status tracking (open/done) — text only, this phase.
- File attachments (e.g. a scanned signed copy) — no `orgFileId` field
  this phase; can be added later without reshaping the model.
- Rich-text/markdown formatting for agenda notes — plain strings.
- Edit history/versioning — `PATCH` overwrites in place, same as every
  other editable record in this codebase (Events, Members).
