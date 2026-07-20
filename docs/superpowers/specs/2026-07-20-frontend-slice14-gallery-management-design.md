# Frontend Slice 14 — Gallery Management — Design

**Status:** approved, pending implementation.

## Scope

Second of three Public Club Page sub-slices (Slice 13 shipped the public
page itself; Achievements management is the remaining third). Full
committee-side management UI for the already-shipped
`GalleryController` (`backend/src/gallery/gallery.controller.ts`):
upload, list, remove. No new backend endpoints.

## Placement

A new nav item, **"Public Page"** (segment `public-page`, `minTier:
'committee'` — same tier as Workspace/Analytics), landing on
`/[orgSlug]/public-page`. This is deliberately not a Workspace tab:
Workspace's existing three tabs (Files, Minutes, Assets) are all internal
ops tooling, while Gallery/Achievements curate the content that becomes
the public-facing `/club/[orgSlug]` page shipped in Slice 13 — a
different kind of content, worth its own home.

The page is tabbed: **Gallery** (built this slice) and **Achievements**
(placeholder — "Coming in a later sub-slice" text, same scaffolding
precedent Slice 9 used for Workspace's then-unbuilt Minutes/Assets tabs).

## RBAC

Matches `GalleryController` exactly:
- `list` — any authenticated org member (no `RolesGuard` on this route).
- `upload`/`remove` — `MANAGE_EVENTS` tier (`isCommittee` in this
  frontend's role helpers).

The nav link itself is committee-only, but the page does not hard-redirect
a non-committee visitor who navigates directly to the URL — it renders
the grid read-only (no upload form, no Remove buttons), matching the
established Workspace precedent (nav-gated for discovery, not
route-gated for access, since the backend itself allows any member to
read the list).

## Data layer

`frontend/features/gallery/use-gallery.ts`:
- `useGallery(orgId)` — `GET /organizations/:orgId/gallery`.
- `useUploadPhoto(orgId)` — multipart `POST`, reusing the existing
  `apiUpload` helper (first used in Slice 6, since reused in Slice 12).
- `useRemovePhoto(orgId)` — `DELETE /organizations/:orgId/gallery/:photoId`.

`frontend/features/gallery/validate-gallery-image.ts` — mirrors the
backend's own limits (`ALLOWED_MIME = image/png, image/jpeg`;
`MAX_FILE_BYTES = 10MB`) as a fast-fail client-side check, same pattern as
every prior upload feature (`validateUploadFile`, `validateCertificateFile`,
`validateBrandingImage`).

## Gallery tab UI

- **Upload form** (committee only): inline, above the grid — native
  `<input type="file" accept="image/png,image/jpeg">`, an optional caption
  text input, and an Upload button. No dialog: matches Slice 6's
  `CertificateManager` and Slice 12's `BrandingPanel`, both of which
  chose inline forms over modals for a single simple upload action with
  no dialog-lifecycle state worth managing.
- **Grid** (everyone): responsive grid of photo tiles, each showing the
  image, its caption (or none, rendered blank rather than a placeholder
  string), and — committee only — a Remove button. Remove uses the
  standard confirm-dialog pattern already established for Files/Assets/
  Minutes (Dialog with Cancel/destructive-Remove).
- Empty state: "No photos yet." — upload form still renders for committee
  viewers regardless (they can always add the first one).

## Error handling

- Client-side MIME/size rejection shows inline error text, fires zero
  network requests (consistent with every prior upload feature's
  verified behavior).
- Backend's storage-quota 400 ("Organization storage quota exceeded")
  surfaces via the standard `ApiError` message-extraction pattern, no
  special-cased copy.
- Non-committee visitor: read-only grid, no redirect, no error state —
  this isn't an error condition, just a narrower view.

## Testing

Unit: `validateGalleryImage` (valid PNG, valid JPEG, rejects other MIME,
rejects file over 10MB) — 4 cases, mirroring
`validate-branding-image.test.ts`'s exact shape. No new role-tier helper
needed (reuses `isCommittee`).

Live verification: upload a real photo with a caption, confirm it appears
in the grid immediately; attempt an unsupported file type, confirm
client-side rejection with zero network calls; remove a photo with
confirm; switch to a non-committee test account and confirm the grid is
visible but read-only (no upload form, no Remove buttons); confirm a
freshly uploaded photo actually appears on the real
`/club/[orgSlug]` public page from Slice 13 (closes the loop between
these two sub-slices); both themes screenshotted.

No new backend endpoints. Backend test baseline expected unchanged (101
unit / 327 e2e) unless a real defect is found live.
