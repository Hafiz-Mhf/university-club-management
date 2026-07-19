# Frontend Slice 5 — Attendance / QR Check-in (Design)

Status: approved, pending write-up review
Depends on: Slice 1 (Foundation), Slice 2 (Events), Slice 3 (Registrations), Slice 4 (Members)

## Scope

Full attendance feature: participant's own QR check-in code (shown from the
event they're approved for), committee/volunteer camera-based scanner to
check people in, a checked-in roster with participant names resolved
client-side, and mark-absent. No new backend endpoints — verified against
the actual `AttendanceController`/`AttendanceService` source during
brainstorming.

Out of scope: any backend change to join participant names into
`GET /attendance` or `GET /registrations` (both currently return raw rows
with only `registrationId`/`userId`) — the frontend resolves names by
cross-referencing already-built endpoints (Slice 3's registrations list,
Slice 4's members list), not by requesting a backend enhancement.

## Backend contract (verified against controller/service/schema/e2e, not assumed)

Base path `organizations/:orgId/events/:eventId/attendance`:

- `GET /` — `MANAGE_ATTENDANCE` tier (`PRESIDENT, VICE_PRESIDENT,
  SECRETARY, TREASURER, EVENT_DIRECTOR, COMMITTEE, VOLUNTEER` — the first
  feature in this frontend giving `VOLUNTEER` any capability). Returns raw
  `Attendance[]`, ordered `createdAt asc`, **no join** — no participant
  name, not even `userId` directly (only `registrationId`).
- `GET /me` — any authenticated org member, **no role check**. Returns the
  caller's own `Attendance` row plus a freshly-signed `token` field
  (`{...attendance, token}`), or 404 `'No attendance record found'` if none
  exists. Attendance rows only exist for `APPROVED`-derived registrations —
  a `WAITLISTED`/`CANCELLED`/`REJECTED` registration has none (created on
  approval/promotion, deleted on cancel/reject — Slice 3's finding, reused
  here), so `GET /me` 404s for anyone not currently checked-in-eligible.
  This is the only per-event fetch the frontend needs for a participant's
  own status/token — no separate "do I have an attendance record" check.
- `POST /scan` — `MANAGE_ATTENDANCE` tier, `@HttpCode(200)`. Body `{ token
  }`. Token format: `${attendanceId}.${HMAC-SHA256(attendanceId,
  ATTENDANCE_TOKEN_SECRET)_base64url}` — stateless, non-expiring (valid
  until the Attendance row itself is deleted by a cancel/reject). Single-use
  via compare-and-swap on `status: 'REGISTERED' → 'PRESENT'`: an
  already-resolved row throws `409 'Attendance already resolved (scanned or
  marked absent)'`. A malformed/tampered token throws `400 'Invalid
  attendance token'`. A well-formed token for a *different* event throws
  `404 'Attendance record not found in this event'` — the frontend surfaces
  all three verbatim, no custom copy.
- `POST /:attendanceId/absent` — `MANAGE_ATTENDANCE` tier, `@HttpCode(200)`.
  Same CAS as scan (`REGISTERED → ABSENT`), same 409 message on an
  already-resolved row. No `scannedAt`/`scannedBy` set (only `status`).

`AttendanceStatus` enum: `REGISTERED | PRESENT | ABSENT`. No `updatedAt`
column. `registrationId` is unique (1:1 with Registration).

## Data layer

`types/api.ts`: `AttendanceStatus`, `Attendance` (`id, registrationId,
eventId, organizationId, status, scannedAt: string | null, scannedBy:
string | null, createdAt`), `MyAttendance = Attendance & { token: string }`.

`features/orgs/roles.ts`: `canManageAttendance(role)` — mirrors backend
`MANAGE_ATTENDANCE` exactly (`isCommittee(role) || role === 'VOLUNTEER'`,
implemented directly rather than composed, to keep the truth table
independently testable the same way `canManageRoles`/`canManageMembers`
already are).

`features/attendance/use-attendance.ts`: `useMyAttendance(orgId, eventId)`
(GET /me, `retry: false` — a 404 here is meaningful, same reasoning as
Slice 2's `useEvent`), `useAttendanceList(orgId, eventId)` (GET /, called
only from `MANAGE_ATTENDANCE`-gated UI), `useScanAttendance(orgId,
eventId)` (POST /scan), `useMarkAbsent(orgId, eventId)` (POST /:id/absent).
Scan/mark-absent mutations invalidate the attendance list query key.

## Participant's own QR (event detail page)

Extends Slice 3's `MyRegistrationPanel` (`components/registrations/`): when
the caller's registration status is `APPROVED`, add a "Show my check-in
code" button. Clicking it calls `useMyAttendance` and opens a `Dialog`
rendering the token as a QR image — the `qrcode` npm package (pure
client-side canvas/data-URL encoding, no backend involvement), first new
runtime dependency this frontend has added. If `GET /me` 404s (edge case:
approved but the attendance row was somehow deleted — shouldn't happen
given the lifecycle guarantees, but the UI must not crash), the dialog
shows a plain "No check-in code available" message instead of an image.

## Committee scanner (`/attendance` → pick event → scan)

`/attendance`: content gated by `canManageAttendance(membership.role)` —
non-eligible viewers (plain PARTICIPANT/ADVISOR) see a short explainer
("Check-in tools are for committee and volunteers. Find your own QR code on
an event's page.") rather than a dead page; this mirrors the nav item
staying visible to all members (`GET /me` *is* for anyone) while the page
content branches, the same pattern the dashboard already uses for
role-branching. Eligible viewers see a list of non-DRAFT events (reusing
`useEvents`, filtered client-side), each linking to `/attendance/[eventId]`.

`/attendance/[eventId]` renders `QrScanner`: feature-detects
`'BarcodeDetector' in window`. If present, requests camera access
(`getUserMedia`), decodes frames in a loop, and calls `useScanAttendance`
on each newly-detected value (de-duplicated so a value isn't submitted
twice while still in frame). If `BarcodeDetector` is unsupported (older
Safari, Firefox) or camera access is denied, falls back to a manual
token-entry form (text input + submit, same mutation) — the door desk still
functions, just without the camera. Scan feedback (success / already
scanned / wrong event / invalid token) renders for 2 seconds then
auto-clears so the scanner is ready for the next person without a manual
reset — this is a fast, repetitive door-desk flow, not a one-shot form.

## Checked-in roster + mark absent

Same page, below the scanner: `useAttendanceList(orgId, eventId)` combined
client-side with `useRegistrations(orgId, eventId)` (Slice 3) and
`useMembers(orgId, {})` (Slice 4) to resolve each row's participant name —
`Attendance.registrationId` → matching `Registration.userId` → matching
`Member.user.fullName`/`email`. A row whose registration or member lookup
comes up empty (shouldn't happen given the lifecycle guarantees, but not
impossible under a race) falls back to showing the raw `registrationId`,
same "never crash on a stitched lookup miss" discipline used elsewhere.
Status filter (All/Registered/Present/Absent), client-side, matching the
Slice 3/4 filter precedent. "Mark absent" button per row, shown only when
`status === 'REGISTERED'` (terminal-state hiding, same as Registrations'
reject button), behind a `Dialog` confirm, surfacing the 409 "already
resolved" message inline if a race occurs (e.g. someone else scanned the
same person between page load and the mark-absent click).

## Testing

Unit (Vitest): `canManageAttendance` truth table (all 9 roles — true only
for the `MANAGE_ATTENDANCE` set including VOLUNTEER). The name-resolution
join function (`registrationId` → name) is logic-bearing and gets its own
pure-function test (matched lookup, missing-registration fallback,
missing-member fallback) — extracted as a plain function rather than
inlined in the page component, so it's testable the same way
`formatAnswers` was in Slice 3.

Live verification (Playwright against the real dev server, both themes):
as a participant, register and get approved for an event, open "Show my
check-in code," confirm a QR image renders. As a committee/volunteer
account, navigate `/attendance` → pick the event → confirm the checked-in
roster shows the participant's real name (not a raw id) with status
Registered. Manually enter the token (camera scanning isn't drivable via
Playwright in a headless/CI-like environment — verified through the manual
fallback path, which exercises the same `useScanAttendance` mutation and
backend contract) → confirm status flips to Present and `scannedAt`
appears. Attempt to scan the same token again → confirm the 409 "already
resolved" message. Attempt to mark a `PRESENT` row absent → confirm the
"Mark absent" button is correctly hidden for that row (not just disabled).
Register a second participant, leave them unresolved, mark them absent
directly → confirm status flips to Absent and the row's action disappears.
Confirm a non-eligible (PARTICIPANT) account sees the explainer, not the
event picker, at `/attendance`.

## Non-negotiables carried over

Tenant isolation, RBAC (`MANAGE_ATTENDANCE` reused from the backend, no new
role group — first frontend feature to actually branch on VOLUNTEER),
QR tokens are never logged or displayed anywhere except the owning
participant's own dialog (matches backend's "raw token never logged in
audit metadata"), no domain hue collision — Attendance's domain hue (teal,
`--domain-attendance`, already used on the nav icon per `design.md`) stays
on icons/nav only, never on status badges (which reuse the same
semantic-token family as Events/Registrations/Members:
REGISTERED=neutral, PRESENT=success, ABSENT=danger).
