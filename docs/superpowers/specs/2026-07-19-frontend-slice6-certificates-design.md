# Frontend Slice 6 — Certificates (Design)

Status: approved, pending write-up review
Depends on: Slice 1 (Foundation), Slice 2 (Events)

## Scope

Full certificates feature: participant's own certificate download (shown
from the event they attended), committee per-event certificate management
(list, manual upload as an admin fallback, remove). No new backend
endpoints — verified against the actual `CertificatesController`/
`CertificatesService`/`CertificateGenerationService` source during
brainstorming.

Certificate **generation is fully automatic**: `EventsService.complete()`
enqueues a BullMQ job per `PRESENT` attendee (gated by
`Event.requireFeedbackForCertificate` — immediate for events that don't
require feedback, delayed-fallback via `scheduleFeedbackWindowClose` for
events that do). Manual upload exists purely as an admin fallback for a
failed or skipped auto-generation, not as the primary path. This frontend
slice builds the *viewing/managing* surface around an already-working
generation pipeline — it does not add any UI to trigger generation.

Out of scope: any backend change to join participant names into
`GET /certificates` (returns raw rows with only `userId`, same gap as
Attendance/Registrations) — resolved client-side, not via a backend join.

## Backend contract (verified against controller/service/schema, not assumed)

Base path `organizations/:orgId/events/:eventId/certificates`:

- `POST /` — `MANAGE_EVENTS` tier (reuses `isCommittee` from Slice 2, no
  new role tier — unlike Attendance's VOLUNTEER addition). `multipart/
  form-data`: `file` field (PDF only, ≤5MB, both validated server-side —
  `400` on either violation) and `userId` form field
  (`UploadCertificateDto`). The target user must have
  `Attendance.status === 'PRESENT'` for this event or the request `400`s
  ('Target user was not marked present for this event'). One certificate
  per event+user (`@@unique([eventId, userId])` in Prisma) — a second
  upload attempt for the same person `409`s ('A certificate already exists
  for this person and event').
- `GET /` — `MANAGE_EVENTS` tier. Returns `{id, userId, fileSizeBytes,
  createdAt}[]`, ordered `createdAt asc` — **no join**, not even a
  `storageKey` (deliberately omitted from the list projection; only
  `download()`/`findMine()` resolve it to a signed URL).
- `GET /me` — any authenticated org member, no role check. Returns the
  caller's own `Certificate` row plus a freshly-minted `downloadUrl`
  (5-minute signed URL) — `{...certificate, downloadUrl}` — or `404 'No
  certificate found'` if none exists for this event+user yet (the common
  case before `complete()` has run, or before feedback-gating unlocks it).
  Every call to this endpoint also records a `CertificateDownload` row
  (best-effort — a tracking-write failure never turns a successful
  download into a 500).
- `GET /:certificateId/download` — `MANAGE_EVENTS` tier. Same
  `{...certificate, downloadUrl}` shape, for committee re-downloading
  someone else's certificate; also records a download.
- `DELETE /:certificateId` — `MANAGE_EVENTS` tier. Deletes the DB row (DB
  first, then the storage object — self-healing orphan-object ordering,
  matches the service's own documented reasoning). `404 'Certificate not
  found in this event'` if missing.

`Certificate` model: `id, eventId, organizationId, userId, storageKey,
fileSizeBytes, uploadedByUserId, createdAt`. No `updatedAt`, no `status`
enum (existence of the row *is* the status — unlike Attendance's tri-state
enum).

## Data layer

`types/api.ts`: `Certificate` (`id, eventId, organizationId, userId,
storageKey, fileSizeBytes, uploadedByUserId, createdAt`), `MyCertificate =
Certificate & { downloadUrl: string }` (mirrors `MyAttendance`'s
token-only-on-`/me` shape from Slice 5).

`lib/api.ts`: a new `apiUpload<T>(path: string, formData: FormData):
Promise<T>` sibling to the existing `api()` — this frontend's first
multipart upload; `api()` today unconditionally sets `Content-Type:
application/json` and `JSON.stringify`s the body, which is wrong for a
file upload (the browser must set the multipart boundary itself).
`apiUpload` reuses the same bearer-token injection and 401→refresh→retry
cycle as `api()` (extracted or duplicated inline — implementation detail
for the plan), but passes `formData` directly as the fetch body with no
`Content-Type` header set manually. `api()` itself is not modified — zero
risk to any existing JSON call site.

`features/certificates/use-certificates.ts`: `useMyCertificate(orgId,
eventId)` (`GET /me`, `retry: false` — a 404 here is a meaningful "no
certificate yet", not a flake, same reasoning as `useMyAttendance`),
`useCertificateList(orgId, eventId)` (`GET /`, committee-only UI),
`useUploadCertificate(orgId, eventId)` (via `apiUpload`, invalidates the
list query key), `useRemoveCertificate(orgId, eventId)` (`DELETE`,
invalidates the list query key).

## Participant view (event detail page)

Extends the event detail page: a new `MyCertificatePanel` component
rendered alongside the existing `MyRegistrationPanel` (Slice 3) and QR
button (Slice 5). Calls `useMyCertificate(orgId, event.id)`. If the query
404s, renders nothing (no certificate yet is the default state for most
events, not an error to surface). If found, renders a "Download
certificate" link using the signed `downloadUrl` directly (a plain
anchor/button opening the URL — no dialog, since this is a direct file
download, not a code to display like the QR case).

## Committee view (`/certificates` → pick event → manage)

`/certificates`: content gated by `isCommittee(membership.role)` —
non-eligible viewers see a short explainer ("Certificates are managed by
committee." + a pointer to find their own certificate on an event's page),
same pattern as Attendance's non-eligible branch. Eligible viewers see a
list of non-DRAFT events (reusing `useEvents`, filtered client-side, same
as Attendance's picker), each linking to `/certificates/[eventId]`.

`/certificates/[eventId]` renders `CertificateManager`:

- **List**: `useCertificateList(orgId, eventId)` combined client-side with
  `useMembers(orgId, {})` (Slice 4) to resolve each row's name — a new
  one-hop resolver `resolveMemberName(userId: string, members: Member[]):
  string` (`Certificate.userId` → `Member.userId` directly, no
  registration indirection needed since `Certificate` carries `userId`
  itself — simpler than Attendance's two-hop
  `resolveParticipantName`). A lookup miss falls back to the raw
  `userId`, same "never crash on a stitched lookup miss" discipline as
  the rest of this app. Each row shows the resolved name, file size
  (human-readable), upload date, a "Download" button (calls `GET
  /:certificateId/download`, opens the signed URL), and a "Remove" button
  behind a `Dialog` confirm.
- **Upload form**: a `<select>` populated from `useAttendanceList(orgId,
  eventId)` (Slice 5) filtered to `status === 'PRESENT'` **and** excluding
  userIds already present in `useCertificateList`'s data — avoids
  presenting a choice that's guaranteed to 400 (not present) or 409
  (already has one). The source list here is `Attendance[]`, not
  `Certificate[]`, so each option's name is resolved with Slice 5's
  existing `resolveParticipantName(attendance, registrations, members)`
  (the two-hop `registrationId` → `userId` → `fullName` chain), reused
  as-is — not the new one-hop `resolveMemberName`, which only fits the
  certificate list below where rows already carry `userId` directly. A
  native `<input type="file" accept="application/pdf">` pairs with the
  select;
  submit builds a `FormData` (`file`, `userId`) and calls
  `useUploadCertificate`. Client-side pre-checks the file's MIME type and
  size (5MB) before submitting — a fast-fail UX nicety, not a security
  boundary (the backend re-validates both regardless). Surfaces the
  backend's `400`/`409` messages verbatim inline on failure.

## Testing

Unit (Vitest): `resolveMemberName` (matched lookup, missing-member
fallback — two cases, simpler than Slice 5's three-case
`resolveParticipantName` since there's only one hop to miss). Client-side
file validation function (correct MIME, correct size, both violations) if
extracted as its own pure function rather than inlined.

Live verification (Playwright against the real dev server, both themes):
complete a `requireFeedbackForCertificate: false` event as President (so
generation fires immediately, no feedback-window wait) with a `PRESENT`
attendee, confirm the participant sees "Download certificate" on the event
page and the link resolves to a real PDF. As a committee account, navigate
`/certificates` → pick the event → confirm the list shows the real name
(not a raw id) with correct file size/date. Remove it, confirm the row
disappears. Manually re-upload a PDF for that same attendee through the
upload form, confirm it reappears in the list. Attempt to upload a second
certificate for someone who already has one → confirm the picker excludes
them entirely (can't even attempt the guaranteed-409). Confirm a
non-committee (PARTICIPANT) account sees the explainer, not the event
picker, at `/certificates`.

## Non-negotiables carried over

Tenant isolation, RBAC (`isCommittee` reused, no new role group — unlike
Attendance's VOLUNTEER-inclusive tier), files are private (signed URLs
only, never a raw `storageKey` rendered anywhere in the UI), PDF/5MB
validated both client-side (fast-fail) and server-side (the real
boundary — client validation is UX only), no domain-hue collision
(Certificates' domain hue stays on the nav icon only, status/action
buttons use semantic tokens or plain neutral styling — there's no
multi-state status badge here the way Attendance/Registrations/Events
have, since a certificate either exists or doesn't).
