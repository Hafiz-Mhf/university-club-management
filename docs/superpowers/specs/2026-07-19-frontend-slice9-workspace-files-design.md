# Frontend Slice 9 (Workspace — File Repository) — Design

## Context

"Workspace" is one of the last three unbuilt nav placeholders (Analytics
shipped in Slice 8). Unlike every prior slice, Workspace bundles three
independent backend subsystems behind a single nav item: File Repository
(`backend/src/files/`), Meeting Minutes (`backend/src/minutes/`), and Asset
Management (`backend/src/assets/`). Combined, these would be 15+ tasks in
one plan — the same shape of problem Slice 2 hit with Events+Registrations,
which was split. Workspace is split the same way: three sub-slices, one at
a time, same brainstorm → spec → plan → execute cycle each.

**This spec covers only the first sub-slice: File Repository.** Meeting
Minutes and Asset Management are future sub-slices, not designed here.

## Scope

Full frontend surface for the already-shipped `FilesController`: upload
(multipart, committee-only), list with category filter (any member),
signed-URL download (any member), remove (committee-only). No new backend
endpoints — verified directly against `files.controller.ts`/`files.service.ts`
during brainstorming:

- `POST /organizations/:orgId/files` — `MANAGE_EVENTS`-gated, multipart
  (`title: string`, `category: FileCategory`, `file`), 20MB limit, MIME
  allowlist (pdf/docx/xlsx/pptx/png/jpeg), enforces the org's shared storage
  quota (`Certificate + OrgFile` size sum vs `storageQuotaMb`).
- `GET /organizations/:orgId/files?category=` — any authenticated org
  member, returns `{id, title, category, originalFilename, mimeType,
  fileSizeBytes, uploadedByUserId, createdAt}[]`, no pagination (bounded
  per-org collection, same reasoning as Asset Management/Events lists).
- `GET /organizations/:orgId/files/:fileId/download` — any authenticated
  org member, returns `{downloadUrl}` (300s TTL signed MinIO URL).
- `DELETE /organizations/:orgId/files/:fileId` — `MANAGE_EVENTS`-gated.

`FileCategory` enum: `SOP | REPORT | FINANCIAL | MEETING | OTHER`.

## Route structure

`/workspace` becomes a real page for the first time: a local-state tab row
(Files / Minutes / Assets), the same lightweight pattern as Slice 3's
event-detail tabs (no new shadcn Tabs component). This sub-slice builds the
**Files** tab's full content; Minutes and Assets tabs render a small
domain-hue "Coming in a later sub-slice" message (reusing the existing
`PlaceholderPage` visual language, inline rather than a route-level
placeholder) — the route is real, the nav is honest, and neither
unbuilt tab pretends to be more than it is.

## Components

- **`frontend/features/files/use-files.ts`** — `useFiles(orgId, category?:
  FileCategory)`, `useUploadFile()`, `useDownloadFile()`, `useDeleteFile()`.
  Thin TanStack Query wrappers, same shape as Slice 6's `use-certificates.ts`.
  Upload uses `apiUpload` (Slice 6's multipart helper, unchanged, reused
  as-is — no new upload primitive needed).
- **`frontend/features/files/resolve-uploader-name.ts`** —
  `resolveUploaderName(uploadedByUserId: string, members: Membership[]):
  string`. One-hop lookup against the already-fetched members list
  (`OrgFile` rows carry `uploadedByUserId` directly, same shape as
  `Certificate.userId`), falls back to the raw id on a miss — mirrors
  Slice 6's `resolveMemberName` exactly.
- **`frontend/components/files/upload-file-dialog.tsx`** — Dialog with
  title text input, category `<select>` (plain native element, same
  precedent as every prior enum-select in this app — no shadcn Select
  added), file input. Client-side `validateUploadFile(file)` pre-checks the
  same MIME allowlist and 20MB limit the backend enforces — UX-only, the
  backend re-validates regardless (same disclaimer as Slice 6's
  `validateCertificateFile`). On success, invalidates the files list query
  and closes.
- **`frontend/components/files/file-category-badge.tsx`** — plain
  `variant="outline"` badge, no color-coding (category isn't a
  success/failure signal — same reasoning as Slice 4's role badge, and the
  Workspace domain hue itself stays on the nav icon only, never a badge).
- **`frontend/components/files/file-list.tsx`** — table (title, category
  badge, uploader name via `resolveUploaderName`, human-readable file size,
  relative upload date) + a category filter dropdown (`ALL` plus the 5
  enum values) driving `useFiles`'s `category` param. Each row has a
  Download button (calls `useDownloadFile`, opens the returned
  `downloadUrl` in a new tab) and, committee-only, a Remove button behind a
  confirm `Dialog` (same confirm-then-mutate pattern as every destructive
  action since Slice 2).
- **`frontend/app/(app)/[orgSlug]/workspace/page.tsx`** — tab row + Files
  tab wiring `FileList` + an "Upload file" button opening
  `UploadFileDialog`, gated by `isCommittee()` (reused from Slice 2, no new
  role tier — `MANAGE_EVENTS` is the only guard on this controller).

## RBAC & data flow

Two tiers only, both already established: `isCommittee()` gates Upload and
Remove (matches backend `MANAGE_EVENTS`); list and download need no role
check beyond being an authenticated org member (matches the backend's bare
`JwtAuthGuard, TenantGuard` on those two routes). No new truth table.

Storage quota enforcement is entirely server-side (the 20MB single-file
check plus the org-wide quota sum) — the frontend never predicts quota
client-side, consistent with the last-active-president guardrail precedent
from Slice 4 (display the backend's error message verbatim on a 400,
don't try to duplicate the check).

## Testing

**Unit (logic only, no component rendering — same bar as every prior
slice's data-layer/helper tests):**
- `resolveUploaderName`: match case, miss-fallback case.
- `validateUploadFile`: valid file passes, wrong MIME rejected, oversized
  file rejected (mirrors `validateCertificateFile`'s three cases from
  Slice 6).

**Live verification (dev server + Playwright, against the real backend):**
upload one file per allowed MIME type, category filter narrows the list
correctly (including `ALL`), download opens a real signed URL, remove with
confirm removes the row, a non-committee account sees the list and
Download but no Upload button/no Remove button, both themes screenshotted
with no domain-hue leakage onto the category badge, Minutes/Assets tabs
show their placeholder content without erroring.

No backend files expected to be touched — verified the full contract
against `files.controller.ts`/`files.service.ts` source before writing this
spec, following the precedent that skipped surprises in every slice except
3 and 6.
