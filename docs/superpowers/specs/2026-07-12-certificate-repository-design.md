# Certificate Repository — Design Spec

Roadmap Phase 1, item 8. Backend-only (no frontend exists yet in this
project — same posture as auth/committee-rbac/events/registration/attendance).
First feature touching file storage — introduces a small shared `storage`
module alongside the `certificates` module, per `CLAUDE.md`'s planned
backend layout.

## Goal

Committee uploads a certificate (PDF) for a specific participant who
actually attended an event; the participant downloads their own via a
short-lived signed URL. Private storage, MIME/size/quota validation,
attendance-gated issuance.

## New shared module: `backend/src/storage/`

`StorageService` wraps `@aws-sdk/client-s3` (S3-compatible client pointed at
MinIO via the existing `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` env
vars) + `@aws-sdk/s3-request-presigner`:

- `putObject(key: string, buffer: Buffer, contentType: string): Promise<void>`
- `getSignedDownloadUrl(key: string, expirySeconds: number): Promise<string>`
- `deleteObject(key: string): Promise<void>`

New env var `S3_BUCKET` (single bucket, e.g. `ucm-dev`). `StorageService`'s
`onModuleInit()` idempotently ensures the bucket exists (`createBucket`,
catching the "already owned by you" case — MinIO doesn't auto-create
buckets).

New dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`,
`multer`, `@types/multer` (Nest's `FileInterceptor` needs multer installed
explicitly; `@nestjs/platform-express` is already a dependency).

## Data model

```prisma
model Certificate {
  id               String   @id @default(uuid())
  eventId          String
  organizationId   String
  userId           String
  storageKey       String   // certificates/{organizationId}/{eventId}/{userId}.pdf
  fileSizeBytes    Int
  uploadedByUserId String
  event            Event    @relation(fields: [eventId], references: [id])
  user             User     @relation(fields: [userId], references: [id])
  createdAt        DateTime @default(now())

  @@unique([eventId, userId])
  @@index([organizationId])
}
```

`Certificate` added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts`, same as
Registration/Attendance.

`storageKey` is deterministic: `certificates/{organizationId}/{eventId}/{userId}.pdf`.
One certificate per person per event this phase (`@@unique([eventId, userId])`)
— no title/type field, no multiple certificates per event. A delete-then-reupload
naturally overwrites the same MinIO key.

## Endpoints & RBAC

| Route | Guard | Notes |
|---|---|---|
| `POST /organizations/:orgId/events/:eventId/certificates` (multipart `file` + body `userId`) | `MANAGE_EVENTS` | Uploads on behalf of a specific participant |
| `GET /organizations/:orgId/events/:eventId/certificates` | `MANAGE_EVENTS` | List metadata for the event (id, userId, fileSizeBytes, createdAt) — no signed URLs |
| `GET /organizations/:orgId/events/:eventId/certificates/me` | `TenantGuard` only (any org member) | Caller's own certificate + a fresh 5-min signed download URL; `404` if none |
| `GET /organizations/:orgId/events/:eventId/certificates/:certificateId/download` | `MANAGE_EVENTS` | Fresh signed URL for any certificate in the event (committee verification) |
| `DELETE /organizations/:orgId/events/:eventId/certificates/:certificateId` | `MANAGE_EVENTS` | Deletes the MinIO object first, then the DB row |

No new role group — reuses `MANAGE_EVENTS` (matches how registration list/reject
and form management already work).

## Upload validation order

1. Org-scoped `Event` lookup — `404` if wrong org/event.
2. MIME must be `application/pdf`, size ≤ 5MB — checked in the service (not
   left to multer's generic rejection, so the error is a clean `400`).
   Multer's own `FileInterceptor` limit is set higher (e.g. 10MB) purely as
   an abuse ceiling.
3. Target user has an `Attendance` row with `status: 'PRESENT'` for this
   event (org-scoped, joined through `Registration.userId` — same join
   pattern `AttendanceService.findMine` already uses) — `400` if not.
4. Fetch `Organization.storageQuotaMb`; compare against a live
   `SUM(fileSizeBytes)` for the org (`certificate.aggregate`) plus the new
   file's size — `400` if it would exceed quota. No running counter column;
   certificate volumes are small (one row per person per event) so a
   per-org `SUM` is cheap and never drifts.
5. `StorageService.putObject` to the deterministic key.
6. `Certificate.create`. If this throws `P2002` (a concurrent upload for
   the same person/event won the race), the just-uploaded MinIO object is
   deleted (best-effort cleanup) before returning `409` — a rejected
   upload never leaves an orphaned file.

## Download mechanics

Both `GET /certificates/me` and `GET /certificates/:certificateId/download`
call `StorageService.getSignedDownloadUrl(storageKey, 300)` (5 min, per
`docs/security.md`) and return `{ ...metadata, downloadUrl }` — generated
fresh per request, never stored. `/me` is org+event+userId scoped (`404` if
none); the committee route is org+event scoped (`404` if wrong org/event).

## Error handling

- Wrong org/event → `404` (no existence leak).
- Bad MIME, over-size, quota exceeded, non-`PRESENT` target → `400`.
- Duplicate cert for the same person/event → `409`.
- Cross-org access on any route → `403` (`TenantGuard`, no membership);
  id-guessing (own org, foreign eventId) → `404` / empty list.

## Audit

`certificate.upload {certificateId, eventId, userId}` and
`certificate.delete {certificateId, eventId, userId}` — ids only. No file
content, no PII beyond the already-audited userId pattern used everywhere
else.

## Testing plan

**Unit:** tenant-scope middleware gets 3 new `Certificate` cases (unscoped
throws, scoped-but-missing-orgId throws, properly scoped passes) — same
pattern as Registration/Attendance.

**E2E** (against the real MinIO container, not mocked — matches this
codebase's real-Postgres-not-mocked-Prisma testing philosophy):

- Upload happy path (committee, `PRESENT` participant) → `201`.
- Rejects non-PDF → `400`.
- Rejects over 5MB → `400`.
- Rejects a target user without `PRESENT` attendance → `400`.
- Rejects when org quota would be exceeded (test org with a tiny quota) →
  `400`.
- Duplicate upload for the same person/event → `409`; the orphaned MinIO
  object from the losing attempt is verified gone.
- `GET /me` happy path → `200` + a working `downloadUrl` (test fetches the
  URL and compares bytes to the uploaded buffer — proves the whole storage
  round-trip, not just that a string came back).
- `GET /me` → `404` when the caller has no certificate.
- Committee list → `200` array, no signed URLs present.
- Committee download-specific → `200` + a working URL.
- Delete → MinIO object gone, DB row gone, subsequent `/me` → `404`.
- Isolation: org A blocked (`403`) on list/upload/download/delete against
  org B; id-guessing (A's own org, B's eventId) → `404` / empty list.

## Out of scope this phase

- Automatic certificate generation (planning.md's stated future item).
- Multiple certificates per person per event / title-type labeling.
- Frontend rendering, QR-code-on-certificate, or any client upload UI.
- Presigned direct-to-MinIO client upload (server-mediated multipart this
  phase — explicit scope decision).
- A running storage-usage counter on `Organization` (live `SUM` query
  instead — explicit scope decision).
