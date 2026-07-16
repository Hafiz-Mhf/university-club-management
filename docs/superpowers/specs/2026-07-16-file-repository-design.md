# File Repository — Design Spec

Roadmap Phase 2, item 2 ("Organization Workspace"). Backend-only (no
frontend exists yet in this project — same posture as every prior phase
item). Org-level document storage: SOPs, reports, and similar files that
aren't tied to a specific event.

## Goal

Give committee members a place to upload and organize club documents (SOPs,
reports, financial records, meeting-related files) that any member of the
org can browse and download — distinct from Certificates (event+user keyed,
one per person per event) and from future Meeting Minutes / Committee
Handover Pack features, which are not being built this phase.

## Scope

One new model (`OrgFile`), one new module (`FilesModule`), reusing the
existing `StorageService` and `AuditService` exactly as Certificates does.
Flat list per org with a category tag — no folder hierarchy, no version
history (re-upload is delete-then-create-new-row).

Not a shared "documents" abstraction for future features. Meeting Minutes
and Committee Handover Pack aren't being built yet; building a generic
abstraction now for hypothetical future consumers is premature (YAGNI). If
a later phase needs file attachments, it can either reuse `OrgFile` as-is
or fork the pattern — that decision is deferred to when that phase is
actually specced.

## Data model

```prisma
enum FileCategory {
  SOP
  REPORT
  FINANCIAL
  MEETING
  OTHER
}

model OrgFile {
  id               String       @id @default(uuid())
  organizationId   String
  organization     Organization @relation(fields: [organizationId], references: [id])
  title            String
  category         FileCategory
  storageKey       String
  originalFilename String
  mimeType         String
  fileSizeBytes    Int
  uploadedByUserId String
  createdAt        DateTime     @default(now())

  @@index([organizationId])
  @@index([organizationId, category])
}
```

`storageKey` is `org-files/{organizationId}/{uuid}.{ext}` — unique per
upload, not deterministic like `Certificate.storageKey`. Certificates
overwrite a shared per-event-per-user key by design (one certificate per
person per event); `OrgFile` has no such natural dedup key — every upload
is its own row, and re-uploading a "new version" of an SOP creates a
brand-new `OrgFile` row with a brand-new id and storage key. The old row
must be explicitly deleted first if the uploader wants only one copy
visible.

`OrgFile` **is** added to `TENANT_SCOPED_MODELS` in
`backend/src/prisma/tenant-scope.middleware.ts` — unlike `CertificateDownload`
(a write-mostly metrics table queried through a relation filter), `OrgFile`
is genuinely listed and filtered by `organizationId` via `findMany` in the
list endpoint, which is exactly the shape the middleware guards.

`Organization` gains one new relation field: `files OrgFile[]`.

## Endpoints

All routes live under a new `FilesModule` (`backend/src/files/`), mirroring
`CertificatesModule`'s file shape (`files.module.ts`, `files.controller.ts`,
`files.service.ts`, `dto/upload-file.dto.ts`).

`@Controller('organizations/:orgId/files')`

1. `POST /organizations/:orgId/files` — upload a file.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - `multipart/form-data`: `file` (the binary) + `title` (string, required)
     + `category` (`FileCategory` enum, required).
   - Validates, in order: MIME type against the allowlist (below), file
     size ≤ 20MB, then org storage quota (below) — all three checked
     *before* any storage write. Any failure → `400 BadRequestException`.
   - Only after validation passes: `storage.putObject(storageKey, ...)`,
     then the `OrgFile` row + `AuditLog` (`file.upload`) are written
     atomically in a `$transaction`. Since `storageKey` is a fresh uuid per
     upload (not a shared deterministic key like Certificates'), a
     transaction rollback after the storage write simply orphans one
     unreferenced MinIO object — nothing else in the org ever collides with
     or points at that key, so there's nothing to self-heal; the orphan is
     just inert.
   - Returns the created `OrgFile` row (no signed URL in the response —
     upload is a write, not a read; the caller re-fetches via list/download
     if they want to view it back).

2. `GET /organizations/:orgId/files` — list files.
   - Guard: `JwtAuthGuard, TenantGuard` only — no `@Roles`, no `RolesGuard`.
     Any user with an ACTIVE membership in the org (including PARTICIPANT,
     VOLUNTEER) can list.
   - Optional `?category=` query param — exact match against `FileCategory`;
     invalid/unrecognized values are ignored (list unfiltered), same silent-
     degrade posture as the `days` param in Analytics.
   - Returns metadata only: `id, title, category, originalFilename,
     mimeType, fileSizeBytes, uploadedByUserId, createdAt` — **no**
     `storageKey`, **no** signed URL. A list call must not mint N signed
     URLs for N files; downloads happen one at a time via the endpoint below.

3. `GET /organizations/:orgId/files/:fileId/download` — get a signed
   download URL for one file.
   - Guard: `JwtAuthGuard, TenantGuard` only. Any ACTIVE member.
   - `404` if `fileId` doesn't belong to this org.
   - Mints a fresh signed URL via `storage.getSignedDownloadUrl(storageKey,
     300)` — same 300-second TTL as Certificates (`SIGNED_URL_TTL_SECONDS`).
     Not tracked (no `OrgFileDownload` table) — Analytics' `CertificateDownload`
     tracking was scoped specifically to certificates in the prior phase;
     extending download-tracking to org files is not in this roadmap item
     and is out of scope here.

4. `DELETE /organizations/:orgId/files/:fileId` — delete a file.
   - Guard: `JwtAuthGuard, TenantGuard, RolesGuard`, `@Roles(...MANAGE_EVENTS)`.
   - `404` if `fileId` doesn't belong to this org.
   - DB-first ordering (delete the `OrgFile` row + write the `file.delete`
     audit row inside one `$transaction`, then delete the storage object) —
     same ordering and same reasoning as `CertificatesService.remove`: if
     the storage delete fails after the DB commit, the result is an
     orphaned MinIO object with no DB pointer, which is harmless. The
     reverse order could leave a dangling DB row pointing at nothing.

## Validation

**Allowed MIME types:**
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx)
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx)
- `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx)
- `image/png`
- `image/jpeg`

Any other MIME type → `400 BadRequestException('Unsupported file type')`.

**Max file size:** 20MB (`MAX_FILE_BYTES = 20 * 1024 * 1024`) — larger than
Certificates' 5MB cap, since office documents and scanned SOPs run bigger
than a single-page certificate PDF. Enforced both at the `FileInterceptor`
level (`limits: { fileSize: ... }`, matching Certificates' pattern of a
slightly higher interceptor ceiling than the service-level check) and
inside `FilesService.upload`.

**Storage quota:** shared with the org's existing `storageQuotaMb` —
the same single quota concept a Certificate upload already checks against.
The check sums usage across **both** tables:

```ts
const [certUsage, fileUsage] = await Promise.all([
  this.prisma.certificate.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
  this.prisma.orgFile.aggregate({ where: { organizationId }, _sum: { fileSizeBytes: true } }),
]);
const usedBytes = (certUsage._sum.fileSizeBytes ?? 0) + (fileUsage._sum.fileSizeBytes ?? 0);
```

Exceeding the quota → `400 BadRequestException('Organization storage quota exceeded')`,
same message Certificates already uses (one quota concept, one error
message, regardless of which table the bytes end up in).

## RBAC

| Action | Roles |
|--------|-------|
| Upload | `MANAGE_EVENTS` (President, Vice President, Secretary, Treasurer, Event Director, Committee) |
| List | Any ACTIVE member of the org (all roles, incl. Participant/Volunteer) |
| Download | Any ACTIVE member of the org |
| Delete | `MANAGE_EVENTS` |

Same guard-chain convention as every other multi-route controller
(`@UseGuards`/`@Roles` repeated per-method, not hoisted to class level).

## Audit

Two new audit actions, matching the `certificate.upload`/`certificate.delete`
shape exactly:

- `file.upload` — `targetType: 'OrgFile'`, `targetId: file.id`, metadata
  `{ fileId, title, category }`.
- `file.delete` — `targetType: 'OrgFile'`, `targetId: fileId`, metadata
  `{ fileId, title, category }`.

Reads (list, download) are unaudited — matches the `GET /dashboard`,
audit-logs-list, and Analytics precedent of unaudited reads.

## Error handling

- Wrong org → `403` (`TenantGuard`, no membership) on upload/delete; list
  and download also `403` for a caller with no membership at all in the org
  (`TenantGuard` still requires *some* membership — "any ACTIVE member can
  view" means any role, not an unauthenticated/non-member request).
- Unsupported MIME / oversized file / quota exceeded → `400`.
- `fileId` not found in this org (download, delete) → `404`.
- Non-committee caller on upload/delete → `403` (`RolesGuard`).

## Testing plan

**E2E only** (`backend/test/files-*.e2e-spec.ts`), no unit-test file — same
precedent as `CertificatesService`, which has no unit tests either (its
logic is simple enough to cover fully at the e2e layer).

- **Upload:** committee member uploads a PDF → `201`, row created with
  correct metadata; a plain participant attempting upload → `403`;
  unsupported MIME (e.g. `text/plain`) → `400`; oversized file → `400`;
  upload that would exceed `storageQuotaMb` → `400`.
- **List:** returns uploaded files with correct metadata, no `storageKey`/
  signed URL in the payload; `?category=SOP` filters correctly; an
  unrecognized category value returns the unfiltered list (silent
  degrade); a plain participant can list (no RBAC restriction).
- **Download:** returns a signed URL that round-trips the original bytes;
  `404` for a `fileId` from a different org.
- **Delete:** committee member deletes a file → `204`/`200`, subsequent
  download → `404`; a plain participant attempting delete → `403`.
- **Isolation:** org B's president cannot list, download, or delete org A's
  files (`403`/`404` as appropriate for each route).
- **Quota interaction:** a certificate upload followed by a file upload
  that together exceed `storageQuotaMb` is rejected — proves the quota
  check sums across both tables, not just `OrgFile`.

## Out of scope

- Folder hierarchy / nested organization — flat list + category tag only.
- Version history — re-upload is delete-then-create-new-row.
- Download tracking/analytics for org files (unlike `CertificateDownload`
  from the Analytics phase) — not in this roadmap item.
- Per-file granular permissions (e.g. "only Treasurer can see FINANCIAL
  files") — category is a display/filter tag, not an access-control
  boundary, this phase.
- Bulk upload/download (zip) — one file per request, one download per
  request.
